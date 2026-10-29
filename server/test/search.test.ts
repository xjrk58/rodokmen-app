import { PersonSearchResult } from '@rodokmen/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateFixture } from '../src/fixture/generate.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, makeApp, signIn, type TestApp } from './helpers.js';

const L = generateFixture().landmarks;

describe('Person search across all Names, ignoring case and diacritics', () => {
  let t: TestDatabase;
  let a: TestApp;
  let cookie: string;
  const search = async (query: string) => {
    const res = await a.app.inject({ method: 'GET', url: `/api/persons?${query}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    return PersonSearchResult.parse(res.json());
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t);
    await ensureOwner(t.db);
    cookie = await signIn(t.db, a.clock, await createMember(t.db));
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  it('"nowak" finds the Person whose primary Name is "Novák" and who has a Name "Nowak"', async () => {
    const result = await search('q=nowak&limit=200');
    const jan = result.items.find((i) => i.person.id === L.janNovak);
    expect(jan).toBeDefined();
    expect(jan!.person.displayName).toBe('Jan Novák');
    expect(jan!.matchedName).toMatch(/Nowak/);
    // Every hit has a Name containing "nowak" once folded.
    for (const hit of result.items) expect(hit.matchedName!.toLowerCase()).toContain('nowak');
  });

  it('ignores diacritics and case in both directions', async () => {
    const plain = await search('q=jan%20novak&limit=200');
    const accented = await search('q=JAN%20NOV%C3%81K&limit=200');
    expect(plain.items.map((i) => i.person.id)).toContain(L.janNovak);
    expect(accented.items.map((i) => i.person.id)).toEqual(plain.items.map((i) => i.person.id));
    expect((await search('q=joannes%20nowak')).items.map((i) => i.person.id)).toContain(L.janNovak);
    expect((await search('q=johann%20nowak')).items.map((i) => i.person.id)).toContain(L.janNovak);
  });

  it('narrows by Place and by year range', async () => {
    const all = await search('q=novak&limit=200');
    const inBukovina = await search(`q=novak&limit=200&placeId=${L.horniBukovina}`);
    expect(inBukovina.items.length).toBeLessThan(all.items.length);
    const inLhota = await search(`q=jan%20novak&limit=200&placeId=${L.kamennaLhota}`);
    expect(inLhota.items.map((i) => i.person.id)).toContain(L.janNovak);
    // Jan's Events run 1801 to 1850.
    expect((await search('q=jan%20novak&limit=200&from=1795&to=1805')).items.map((i) => i.person.id)).toContain(L.janNovak);
    expect((await search('q=jan%20novak&limit=200&from=1700&to=1760')).items.map((i) => i.person.id)).not.toContain(L.janNovak);
  });

  it('uses the trigram index on folded Names', async () => {
    const { rows } = await sql<{ indexdef: string }>`select indexdef from pg_indexes where indexname = 'name_search_trgm_idx'`.execute(t.db);
    expect(rows[0]!.indexdef).toMatch(/gin \(search_text gin_trgm_ops\)/);
    await sql`set enable_seqscan = off`.execute(t.db);
    const plan = await sql<{ 'QUERY PLAN': string }>`explain select person_id from name where search_text like '%nowak%'`.execute(t.db);
    expect(plan.rows.map((r) => r['QUERY PLAN']).join('\n')).toMatch(/name_search_trgm_idx/);
  });

  it('lists Persons by surname without a query, with paging', async () => {
    const first = await search('limit=10');
    const second = await search('limit=10&offset=10');
    expect(first.items).toHaveLength(10);
    expect(second.items[0]!.person.id).not.toBe(first.items[0]!.person.id);
  });
});
