// The Chart routes against the invented fixture Tree with a fixed clock (tree-charts spec):
// golden models of both kinds and both forms, the scenarios the server decides, the errors, who
// may ask, and a bound on the queries per Chart.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DescendantChart, DescendantChartScreen, HouseChart, Kinship } from '@rodokmen/shared';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gatherDescendants, gatherHouse } from '../src/charts/gather.js';
import type { Database } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { recomputeRelations } from '../src/tree/relation.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { bearer, createAgentWithToken, createMember, ensureOwner, errorOf, makeApp, signIn, TestClock, type TestApp } from './helpers.js';

const L = generateFixture().landmarks;
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'charts');

/** Compares with the golden file, or writes it with UPDATE_GOLDEN=1. */
function golden(name: string, value: unknown) {
  const file = join(GOLDEN, `${name}.json`);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(file, text);
    return;
  }
  expect(existsSync(file), `${file} is missing: run with UPDATE_GOLDEN=1`).toBe(true);
  expect(text).toBe(readFileSync(file, 'utf8'));
}

describe('Chart routes on the fixture Tree', () => {
  let t: TestDatabase;
  let a: TestApp;
  let contributor: string;
  let owner: string;
  /** A Member whose own Person is the proband, a descendant of the founders. */
  let linked: string;
  const get = (url: string, cookie = contributor) => a.app.inject({ method: 'GET', url, headers: { cookie } });
  const descendants = async (query: string, cookie = contributor) => {
    const res = await get(`/api/charts/descendants?${query}`, cookie);
    expect(res.statusCode, res.body).toBe(200);
    return DescendantChart.parse(res.json());
  };
  const house = async (query = '', cookie = contributor) => {
    const res = await get(`/api/charts/house/${L.houseA}?${query}`, cookie);
    expect(res.statusCode, res.body).toBe(200);
    return HouseChart.parse(res.json());
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    // The founders of the Novák line are the Family root, so that Relatives and Unrelated people differ.
    await t.db.insertInto('family_root').values({ person_id: L.founder }).execute();
    await t.db.transaction().execute((tx) => recomputeRelations(tx));
    a = await makeApp(t, { clock: new TestClock(new Date('2026-11-14T09:00:00Z')) });
    owner = await signIn(t.db, a.clock, await ensureOwner(t.db));
    contributor = await signIn(t.db, a.clock, await createMember(t.db, 'contributor'));
    const own = await createMember(t.db, 'editor');
    await t.db.updateTable('account').set({ person_id: L.proband }).where('id', '=', own.id).execute();
    linked = await signIn(t.db, a.clock, own);
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  it('matches the golden models: both kinds, both forms, a Family start and a Sheet', async () => {
    golden('jan-tree-4', await descendants(`person=${L.janNovak}`));
    golden('jan-first-family-3', await descendants(`family=${L.janFirstFamily}&generations=3`));
    golden('founder-line', await descendants(`person=${L.founder}&form=line&line=${L.proband}`));
    golden('house-a', await house('unrelated=true'));
    golden('house-a-sheet', await house('sheet=reduced'));
  });

  it('"Renumbered House": Jan Novák\'s card gives čp. 12 for the baptism and čp. 15 for the death', async () => {
    const jan = (await descendants(`person=${L.janNovak}`)).persons.find((p) => p.id === L.janNovak)!;
    expect(jan.born).toMatchObject({ type: 'baptism', date: '1801-03-12', place: 'Kamenná Lhota', houseNumber: '12' });
    expect(jan.died).toMatchObject({ type: 'death', houseNumber: '15' });
  });

  it('"Second marriage": Jan\'s two Families, the earlier first', async () => {
    const model = await descendants(`person=${L.janNovak}&generations=2`);
    expect(model.nodes[0]!.families.map((f) => f.familyId)).toEqual([L.janFirstFamily, L.janSecondFamily]);
  });

  it('"A large family": 6 generations would pass 500 cards, so 5 whole generations are shown and the left-out counted', async () => {
    const model = await descendants(`person=${L.largeFounder}&generations=6`);
    expect(model.shown).toBe(5);
    expect(model.cards).toBeLessThanOrEqual(500);
    expect(model.leftOut).toBe(243);
    const last = model.nodes.filter((n) => n.generation === 5 && !n.pointer);
    expect(last.every((n) => n.leftOut === 3 && n.moreBelow)).toBe(true);
    expect(last.reduce((sum, n) => sum + n.leftOut, 0)).toBe(model.leftOut);
  });

  it('"Line to the Member": the line form from the founder down to the proband, one couple per row', async () => {
    const model = await descendants(`person=${L.founder}&form=line&line=${L.proband}`);
    expect(model.rows[0]!.personId).toBe(L.founder);
    expect(model.rows.at(-1)!.personId).toBe(L.proband);
    expect(model.rows.length).toBe(6);
    for (const [i, row] of model.rows.entries()) if (i + 1 < model.rows.length) expect(row.nextId).toBe(model.rows[i + 1]!.personId);
  });

  it('"Not a descendant": 422 naming line, also for an unknown Person', async () => {
    for (const line of [L.lodgerFamily, '0192f0c4-7a1e-7c3b-9d2a-00000000beef']) {
      const res = await get(`/api/charts/descendants?person=${L.founder}&form=line&line=${line}`);
      expect(res.statusCode).toBe(422);
      expect(errorOf(res)).toMatchObject({ code: 'not_a_descendant' });
      expect(errorOf(res).message).toMatch(/^line: /);
    }
  });

  it('refuses bad options with 400 and an unknown start with 404', async () => {
    for (const q of [
      `person=${L.janNovak}&family=${L.janFirstFamily}`,
      `person=${L.janNovak}&generations=9`,
      `person=${L.janNovak}&generations=1`,
      `person=${L.janNovak}&form=line`,
    ]) {
      expect((await get(`/api/charts/descendants?${q}`)).statusCode, q).toBe(400);
    }
    expect((await get('/api/charts/descendants?person=0192f0c4-7a1e-7c3b-9d2a-00000000beef')).statusCode).toBe(404);
    expect((await get('/api/charts/house/0192f0c4-7a1e-7c3b-9d2a-00000000beef')).statusCode).toBe(404);
  });

  it('follows a merged Person to the kept one', async () => {
    const merged = await t.db.insertInto('person').values({ merged_into_id: L.janNovak }).returning('id').executeTakeFirstOrThrow();
    const model = await descendants(`person=${merged.id}`);
    expect(model.start.personId).toBe(L.janNovak);
    expect(model.nodes[0]!.personId).toBe(L.janNovak);
  });

  it('"Not signed in": 401, revealing nothing about whether the start exists', async () => {
    const known = await a.app.inject({ method: 'GET', url: `/api/charts/descendants?person=${L.janNovak}` });
    const unknown = await a.app.inject({ method: 'GET', url: '/api/charts/descendants?person=0192f0c4-7a1e-7c3b-9d2a-00000000beef' });
    const houseChart = await a.app.inject({ method: 'GET', url: `/api/charts/house/${L.houseA}` });
    for (const res of [known, unknown, houseChart]) expect(res.statusCode).toBe(401);
    expect(known.body).toBe(unknown.body);
  });

  it('"Who may make Charts": a Sheet is reduced the same for a Contributor and the Owner', async () => {
    const q = `person=${L.founder}&generations=8&sheet=reduced`;
    const forContributor = await descendants(q);
    expect(await descendants(q, owner)).toEqual(forContributor);
    const living = forContributor.persons.filter((p) => p.living);
    expect(living.length).toBeGreaterThan(0);
    for (const p of living) expect(p).toMatchObject({ reduced: true, born: null, died: null });
    const screen = await descendants(`person=${L.founder}&generations=8`);
    expect(screen.persons.filter((p) => p.living && p.born !== null).length).toBeGreaterThan(0);
  });

  it("House A: the son takes over, a daughter's Family with a son-in-law who married in, the widow's remarriage, and lodgers", async () => {
    const model = await house();
    const row = (familyId: string) => model.rows.find((r) => r.familyId === familyId);
    expect(row(L.janFirstFamily)?.link.kind).toBe('son');
    expect(row(L.daughterFirstFamily)).toMatchObject({ link: { kind: 'daughter', personId: L.daughter }, marriedIn: L.sonInLaw });
    expect(row(L.daughterSecondFamily)).toMatchObject({ link: { kind: 'remarriage', rowKey: L.daughterFirstFamily, personId: L.daughter } });
    // "Unrelated lodgers": hidden until asked for, then a row of their own with no link.
    expect(row(L.lodgerFamily)).toBeUndefined();
    expect(model.hiddenUnrelated).toBeGreaterThan(0);
    const all = await house('unrelated=true');
    expect(all.rows.find((r) => r.familyId === L.lodgerFamily)).toMatchObject({ unrelated: true, link: { kind: 'none' } });
    // "Renumbered House": both numbers with their years.
    expect(all.house.numbers.map((n) => n.number)).toEqual(expect.arrayContaining(['12', '15']));
  });

  it('gathers a Chart in a fixed number of queries, whatever its size', async () => {
    let queries = 0;
    const counted = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: t.url, max: 2 }) }),
      log: (event) => {
        if (event.level === 'query') queries++;
      },
    });
    const deps = { db: counted, clock: a.clock };
    try {
      const counts: number[] = [];
      for (const [start, depth] of [
        [{ personId: L.janNovak }, 3],
        [{ personId: L.largeFounder }, 7],
        [{ familyId: L.janFirstFamily }, 12],
      ] as const) {
        queries = 0;
        await gatherDescendants(deps, start, depth);
        counts.push(queries);
      }
      queries = 0;
      await gatherHouse(deps, L.houseA);
      counts.push(queries);
      expect(Math.max(...counts), counts.join(', ')).toBeLessThanOrEqual(24);
    } finally {
      await counted.destroy();
    }
  });

  describe('kinship on the cards (add-kinship task 8.1; tree-charts spec, "Kinship on Chart cards")', () => {
    const strip = <T extends { persons: object[] }>(m: T) => ({
      ...m,
      persons: m.persons.map((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'kinship'))),
    });
    const has = (m: { persons: object[] }) => m.persons.filter((p) => 'kinship' in p).length;
    const queries = [`person=${L.founder}&generations=8`, `person=${L.founder}&form=line&line=${L.proband}`, `family=${L.janFirstFamily}&generations=3`];

    it('"Switched on": kinship=1 gives every card its short form and changes nothing else in the model', async () => {
      for (const q of queries) {
        const plain = await descendants(q, linked);
        const kin = await descendants(`${q}&kinship=1`, linked);
        expect(has(plain), q).toBe(0);
        expect(has(kin), q).toBe(kin.persons.length);
        expect(strip(kin), q).toEqual(plain);
      }
      const plainHouse = await house('unrelated=true', linked);
      const kinHouse = await house('unrelated=true&kinship=1', linked);
      expect(has(kinHouse)).toBe(kinHouse.persons.length);
      expect(strip(kinHouse)).toEqual(plainHouse);
    });

    it('"Same everywhere": each card names the first path of the full answer, and the own Person is "self"', async () => {
      const res = await get(`/api/charts/descendants?person=${L.founder}&generations=8&kinship=1`, linked);
      const model = DescendantChartScreen.parse(res.json());
      expect(model.persons.find((p) => p.id === L.proband)?.kinship).toMatchObject({ kind: 'self' });
      const related = model.persons.filter((p) => p.kinship);
      expect(related.length).toBeGreaterThan(20);
      for (const p of related.slice(0, 12)) {
        const res = await get(`/api/persons/${p.id}/kinship`, linked);
        expect(res.statusCode, res.body).toBe(200);
        const full = Kinship.parse(res.json());
        const first = full.paths[0]!;
        expect(p.kinship, p.id).toEqual({
          kind: first.kind,
          term: first.term,
          possible: first.possible,
          line: first.line,
          degree: first.degree,
          others: full.paths.length - 1,
          more: full.more,
        });
      }
      // The founder is an ancestor of the proband in the direct line.
      expect(model.persons.find((p) => p.id === L.founder)?.kinship).toMatchObject({ kind: 'birth', line: 'direct' });
    });

    it('"Printing": kinship=1 with sheet is 400 on both routes, and a Sheet is the same bytes for every Member, with no kinship', async () => {
      for (const sheet of ['reduced', 'nameless']) {
        for (const url of [`/api/charts/descendants?person=${L.founder}&sheet=${sheet}&kinship=1`, `/api/charts/house/${L.houseA}?sheet=${sheet}&kinship=1`]) {
          const res = await get(url, linked);
          expect(res.statusCode, url).toBe(400);
          expect(errorOf(res).message, url).toMatch(/kinship/);
        }
        const forLinked = await get(`/api/charts/descendants?person=${L.founder}&generations=8&sheet=${sheet}`, linked);
        const forUnlinked = await get(`/api/charts/descendants?person=${L.founder}&generations=8&sheet=${sheet}`, contributor);
        expect(forLinked.statusCode).toBe(200);
        expect(forLinked.body).toBe(forUnlinked.body);
        expect(forLinked.body).not.toMatch(/kinship/);
      }
    });

    it('adds nothing for a caller with no own Person', async () => {
      for (const q of queries) {
        const kin = await descendants(`${q}&kinship=1`);
        expect(has(kin), q).toBe(0);
        expect(kin, q).toEqual(await descendants(q));
      }
      expect(await house('kinship=1', owner)).toEqual(await house('', owner));
    });

    it('adds nothing for an Agent, which has no own Person, even when asked for it on the route', async () => {
      const { token } = await createAgentWithToken(t.db, a.clock);
      const url = `/api/charts/descendants?person=${L.founder}&generations=3`;
      const plain = await a.app.inject({ method: 'GET', url, headers: bearer(token) });
      const kin = await a.app.inject({ method: 'GET', url: `${url}&kinship=1`, headers: bearer(token) });
      expect(kin.statusCode, kin.body).toBe(200);
      expect(kin.body).not.toMatch(/kinship/);
      expect(kin.body).toBe(plain.body);
    });
  });
});
