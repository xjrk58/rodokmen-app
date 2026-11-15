import {
  buildKinshipGraph,
  DescendantChartScreen,
  FULL_BOUND,
  KinshipSearch,
  kinshipPaths,
  kinshipShort,
  kinshipShortForm,
  PersonSearchResult,
  SHORT_BOUND,
} from '@rodokmen/shared';
import type { KyselyPlugin } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { generatedKinshipTree } from '../src/fixture/kinship-generated.js';
import { gatherKinshipData } from '../src/tree/kinship.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, makeApp, signIn, type TestApp } from './helpers.js';

// add-kinship task 4.4: on the generated Tree of 5,000 invented Persons whose pedigrees collapse,
// a search page of 50 results with kinship costs a fixed number of extra queries and stays within
// the units, and each result's short form names the first path of its full answer. Task 8.1: a
// Descendant chart at the limit of 500 cards with kinship=1 does the same. The generated Tree goes
// into this file's own database, never into the template.
const SURNAME = 'Vygenerovaný';

describe('kinship on a dense generated Tree (kinship spec, "Limits of the kinship search")', () => {
  let t: TestDatabase;
  let a: TestApp;
  let queries = 0;
  let reader: Account;
  let readerCookie = '';
  let unlinkedCookie = '';
  const { data, youngest } = generatedKinshipTree('dense');

  beforeAll(async () => {
    t = await createTestDatabase();
    const db = t.db;
    const chunks = <T>(xs: readonly T[]) => Array.from({ length: Math.ceil(xs.length / 1000) }, (_, i) => xs.slice(i * 1000, i * 1000 + 1000));
    // A Person needs its primary Name when the transaction ends.
    for (const part of chunks(data.persons)) {
      await db.transaction().execute(async (tx) => {
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
      await db
        .insertInto('family')
        .values(part.map((f) => ({ id: f.id, partner1_id: f.partner1, partner2_id: f.partner2 })))
        .execute();
    for (const part of chunks(data.childLinks))
      await db
        .insertInto('family_child')
        .values(part.map((c) => ({ id: c.id, family_id: c.familyId, child_id: c.childId, link_type: c.type })))
        .execute();
    // Every query the app runs is counted.
    const counter: KyselyPlugin = {
      transformQuery: (args) => {
        queries++;
        return args.node;
      },
      transformResult: async (args) => args.result,
    };
    a = await makeApp({ ...t, db: t.db.withPlugin(counter) });
    const owner = await ensureOwner(db);
    reader = await createMember(db, 'contributor');
    await db.updateTable('account').set({ person_id: youngest[0]! }).where('id', '=', reader.id).execute();
    readerCookie = await signIn(db, a.clock, reader);
    unlinkedCookie = await signIn(db, a.clock, await createMember(db, 'contributor'));
    expect(owner.role).toBe('owner');
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  const search = async (cookie: string) => {
    const before = queries;
    const res = await a.app.inject({ method: 'GET', url: `/api/persons?q=${encodeURIComponent(SURNAME)}&limit=50`, headers: { cookie } });
    expect(res.statusCode, res.body).toBe(200);
    return { result: PersonSearchResult.parse(res.json()), queries: queries - before };
  };

  it('the generated Tree is the same for its seed on every run', () => {
    expect(generatedKinshipTree('dense')).toEqual({ data, youngest });
    expect(generatedKinshipTree('sparse')).toEqual(generatedKinshipTree('sparse'));
  });

  it('a page of 50 results costs two more queries than without kinship, however many results', async () => {
    await search(readerCookie); // builds the link copy
    const plain = await search(unlinkedCookie);
    const withKinship = await search(readerCookie);
    expect(withKinship.result.items).toHaveLength(50);
    // The own Person, and the state of the Tree; the link copy is kept.
    expect(withKinship.queries - plain.queries).toBe(2);
    expect(withKinship.result.items.filter((h) => h.person.kinship).length).toBeGreaterThan(30);
  });

  it('the page stays within the units, and each short form names the first path of the full answer', async () => {
    const g = buildKinshipGraph(await gatherKinshipData(t.db));
    const s = new KinshipSearch(g, g.index.get(youngest[0]!)!);
    const { result } = await search(readerCookie);
    let units = 0;
    for (const h of result.items) {
      const to = g.index.get(h.person.id)!;
      const short = kinshipShort(s, to);
      const full = kinshipPaths(new KinshipSearch(g, g.index.get(youngest[0]!)!), to);
      // The closest degree is always listed whole, up to the bound of a full answer.
      expect(short?.units ?? 0).toBeLessThanOrEqual(FULL_BOUND);
      expect(full.units).toBeLessThanOrEqual(FULL_BOUND + 20_000);
      units += short?.units ?? 0;
      expect(short?.first ?? null).toEqual(full.paths[0] ?? null);
      expect(h.person.kinship?.term ?? null).toEqual(full.paths[0]?.term ?? null);
    }
    // Measured on this Tree: about 362,000 units for 50 Persons; the bound leaves room, not more.
    expect(units).toBeLessThanOrEqual(600_000);
  });

  it("a Descendant chart at the limit of 500 cards with kinship: two more queries, each card within the short form's bound", async () => {
    const chart = async (person: string, kinship: boolean) => {
      const before = queries;
      const url = `/api/charts/descendants?person=${person}&generations=8${kinship ? '&kinship=1' : ''}`;
      const res = await a.app.inject({ method: 'GET', url, headers: { cookie: readerCookie } });
      expect(res.statusCode, res.body).toBe(200);
      return { model: DescendantChartScreen.parse(res.json()), queries: queries - before };
    };
    // The founder of the oldest generation whose Chart holds the most cards.
    let start = data.persons[0]!.id;
    let most = 0;
    for (const p of data.persons.slice(0, 12)) {
      const { model } = await chart(p.id, false);
      if (model.cards > most) [start, most] = [p.id, model.cards];
    }
    await chart(start, true); // builds the link copy, unless a test before did
    const plain = await chart(start, false);
    const kin = await chart(start, true);
    expect(kin.model.cards).toBeGreaterThan(400);
    expect(kin.model.cards).toBeLessThanOrEqual(500);
    // The own Person, and the state of the Tree; the link copy is kept.
    expect(kin.queries - plain.queries).toBe(2);
    const g = buildKinshipGraph(await gatherKinshipData(t.db));
    const s = new KinshipSearch(g, g.index.get(youngest[0]!)!);
    expect(kin.model.persons.filter((p) => p.kinship).length).toBeGreaterThan(300);
    let units = 0;
    for (const p of kin.model.persons) {
      const to = g.index.get(p.id)!;
      const short = kinshipShort(s, to);
      const full = kinshipPaths(new KinshipSearch(g, g.index.get(youngest[0]!)!), to);
      // The closest degree is listed whole, up to the bound of a full answer; after it the short
      // form's bound stops the search, so a card never costs more than the full answer.
      expect(short?.units ?? 0).toBeLessThanOrEqual(FULL_BOUND);
      expect(short?.units ?? 0).toBeLessThanOrEqual(Math.max(full.units, SHORT_BOUND));
      units += short?.units ?? 0;
      expect(p.kinship ?? null).toEqual(kinshipShortForm(s, to));
    }
    // Measured on this Tree: 454 cards of 408 Persons, about 3,380,000 units (8,300 a Person, the
    // reader's chains counted for each, though built once); 12,000 a Person, as for a page of search.
    expect(units).toBeLessThanOrEqual(kin.model.persons.length * 12_000);
  });
});
