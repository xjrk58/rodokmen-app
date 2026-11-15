import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildKinshipGraph } from '@rodokmen/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { generatedKinshipTree } from '../src/fixture/kinship-generated.js';
import { gatherKinshipData } from '../src/tree/kinship.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, makeApp, signIn, type TestApp } from './helpers.js';

// Times kinship through the real routes on the generated Trees (add-kinship, "Performance"): the
// rebuild of the link copy, a person page's full answer, a search page of 50 and an hourglass,
// each a whole request with its database queries. Runs only with KINSHIP_TIMINGS set to a file,
// which gets the figures; the measurements of the PR come from it. CI does not run it: timings
// depend on the machine, and the units are what the other tests assert.
const OUT = process.env.KINSHIP_TIMINGS;
const SURNAME = 'Vygenerovaný';

for (const shape of ['sparse', 'dense'] as const) {
  describe.runIf(OUT)(`kinship timings on the ${shape} generated Tree`, () => {
    let t: TestDatabase;
    let a: TestApp;
    let cookie = '';
    let reader: Account;
    const { data, youngest } = generatedKinshipTree(shape);

    beforeAll(async () => {
      t = await createTestDatabase();
      const chunks = <T>(xs: readonly T[]) => Array.from({ length: Math.ceil(xs.length / 1000) }, (_, i) => xs.slice(i * 1000, i * 1000 + 1000));
      for (const part of chunks(data.persons)) {
        await t.db.transaction().execute(async (tx) => {
          await tx
            .insertInto('person')
            .values(part.map((p) => ({ id: p.id, sex: p.sex })))
            .execute();
          await tx
            .insertInto('name')
            .values(
              part.map((p, i) => ({
                person_id: p.id,
                given: `Osoba ${i}`,
                surname: SURNAME,
                type: 'birth' as const,
                as_found: `Osoba ${SURNAME}`,
                is_primary: true,
              })),
            )
            .execute();
        });
      }
      for (const part of chunks(data.families))
        await t.db
          .insertInto('family')
          .values(part.map((f) => ({ id: f.id, partner1_id: f.partner1, partner2_id: f.partner2 })))
          .execute();
      for (const part of chunks(data.childLinks))
        await t.db
          .insertInto('family_child')
          .values(part.map((c) => ({ id: c.id, family_id: c.familyId, child_id: c.childId, link_type: c.type })))
          .execute();
      a = await makeApp(t);
      await ensureOwner(t.db);
      reader = await createMember(t.db, 'contributor');
      await t.db.updateTable('account').set({ person_id: youngest[0]! }).where('id', '=', reader.id).execute();
      cookie = await signIn(t.db, a.clock, reader);
    });
    afterAll(async () => {
      await a?.app.close();
      await t?.drop();
    });

    const time = async (url: string, rounds: number) => {
      const ms: number[] = [];
      for (let i = 0; i < rounds; i++) {
        const start = performance.now();
        const res = await a.app.inject({ method: 'GET', url: url.replace('{i}', youngest[(i * 7) % youngest.length]!), headers: { cookie } });
        ms.push(performance.now() - start);
        expect(res.statusCode, res.body).toBe(200);
      }
      ms.sort((x, y) => x - y);
      return { median: Math.round(ms[Math.floor(ms.length / 2)]! * 10) / 10, max: Math.round(ms[ms.length - 1]! * 10) / 10 };
    };

    it('measures', async () => {
      const rebuild: number[] = [];
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        buildKinshipGraph(await gatherKinshipData(t.db));
        rebuild.push(performance.now() - start);
      }
      const figures = {
        shape,
        persons: data.persons.length,
        families: data.families.length,
        childLinks: data.childLinks.length,
        rebuildMs: Math.round(Math.min(...rebuild)),
        firstRequestMs: (await time('/api/persons/{i}/kinship', 1)).max,
        kinship: await time('/api/persons/{i}/kinship', 20),
        personPage: await time('/api/persons/{i}', 20),
        searchPage: await time(`/api/persons?q=${encodeURIComponent(SURNAME)}&limit=50`, 10),
        hourglass: await time('/api/persons/{i}/hourglass?up=3&down=2', 10),
      };
      const previous: unknown = existsSync(OUT!) ? JSON.parse(readFileSync(OUT!, 'utf8')) : [];
      const earlier: unknown[] = Array.isArray(previous) ? previous : [];
      writeFileSync(OUT!, JSON.stringify([...earlier, figures], null, 2));
    }, 600_000);
  });
}
