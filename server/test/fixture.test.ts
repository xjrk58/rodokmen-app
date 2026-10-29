import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateFixture } from '../src/fixture/generate.js';
import { estatesAt, findHousesByNumber, parishesAt } from '../src/tree/places.js';
import { eventSummaries } from '../src/tree/summaries.js';
import { createTestDatabase, type TestDatabase } from './db.js';

const model = generateFixture();
const L = model.landmarks;

describe('invented fixture Tree', () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => t?.drop());

  it('holds about 200 Persons over 6 generations, all loaded', async () => {
    const { count } = await t.db.selectFrom('person').select((eb) => eb.fn.countAll<number>().as('count')).executeTakeFirstOrThrow();
    expect(count).toBe(model.persons.length);
    expect(count).toBeGreaterThanOrEqual(180);
    expect(count).toBeLessThanOrEqual(230);

    // Generation depth along child links: the longest line of descent has exactly 6 generations.
    const parents = new Map<string, string[]>();
    for (const l of model.childLinks) {
      const f = model.families.find((x) => x.id === l.familyId)!;
      parents.set(l.childId, [...(parents.get(l.childId) ?? []), ...[f.partner1Id, f.partner2Id].filter((x): x is string => x !== null)]);
    }
    const memo = new Map<string, number>();
    const depth = (id: string): number => memo.get(id) ?? (memo.set(id, 1 + Math.max(0, ...(parents.get(id) ?? []).map(depth))), memo.get(id)!);
    expect(Math.max(...model.persons.map((p) => depth(p.id)))).toBe(6);
    expect(depth(L.proband)).toBe(6);
  });

  it('is deterministic', () => {
    expect(generateFixture()).toEqual(model);
  });

  it('renumbered House: an 1801 Event at čp. 12 and an 1850 Event at čp. 15 refer to the same House', async () => {
    const [baptism, death] = await eventSummaries(t.db, [L.janBaptism, L.janDeath]);
    expect(baptism!.date).toBe('1801-03-12');
    expect(death!.date).toBe('1850-11-03');
    expect(baptism!.house).toMatchObject({ id: L.houseA, number: '12' });
    expect(death!.house).toMatchObject({ id: L.houseA, number: '15' });

    // Looking a House up by its number needs the date: after 1805, čp. 12 is another House.
    expect((await findHousesByNumber(t.db, L.kamennaLhota, '12', '1801')).map((h) => h.id)).toEqual([L.houseA]);
    expect((await findHousesByNumber(t.db, L.kamennaLhota, '15', '1850')).map((h) => h.id)).toEqual([L.houseA]);
    expect((await findHousesByNumber(t.db, L.kamennaLhota, '12', '1850')).map((h) => h.id)).toEqual([L.houseB]);
    expect(await findHousesByNumber(t.db, L.kamennaLhota, '15', '1801')).toEqual([]);
  });

  it('village changes parish: an 1840 Event is attributed to the first Parish and an 1870 Event to the second', async () => {
    const [e1840, e1870] = await eventSummaries(t.db, [L.event1840, L.event1870]);
    expect(e1840!.place?.id).toBe(L.kamennaLhota);
    expect(e1870!.place?.id).toBe(L.kamennaLhota);
    expect((await parishesAt(t.db, L.kamennaLhota, e1840!.earliest, e1840!.latest)).map((p) => p.id)).toEqual([L.parishDolniKamenec]);
    expect((await parishesAt(t.db, L.kamennaLhota, e1870!.earliest, e1870!.latest)).map((p) => p.id)).toEqual([L.parishVrbice]);
    // Estates end in 1848.
    expect((await estatesAt(t.db, L.kamennaLhota, e1840!.earliest, e1840!.latest)).map((e) => e.id)).toEqual([L.estateVrbice]);
    expect(await estatesAt(t.db, L.kamennaLhota, e1870!.earliest, e1870!.latest)).toEqual([]);
  });

  it('adopted child: linked to the birth Family as "birth" and to the adoptive Family as "adoptive"', async () => {
    const links = await t.db.selectFrom('family_child').select(['family_id', 'link_type']).where('child_id', '=', L.adoptedChild).orderBy('link_type').execute();
    expect(links).toEqual([
      { family_id: L.adoptedAdoptiveFamily, link_type: 'adoptive' },
      { family_id: L.adoptedBirthFamily, link_type: 'birth' },
    ]);
  });

  it('second marriage: the widower is a partner in two Families, each with its own children', async () => {
    const families = await t.db.selectFrom('family').select('id').where((eb) => eb.or([eb('partner1_id', '=', L.janNovak), eb('partner2_id', '=', L.janNovak)])).execute();
    expect(families.map((f) => f.id).sort()).toEqual([L.janFirstFamily, L.janSecondFamily].sort());
    const children = await t.db.selectFrom('family_child').select(['family_id', 'child_id']).where('family_id', 'in', [L.janFirstFamily, L.janSecondFamily]).execute();
    const first = children.filter((c) => c.family_id === L.janFirstFamily).map((c) => c.child_id);
    const second = children.filter((c) => c.family_id === L.janSecondFamily).map((c) => c.child_id);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    expect(first.filter((c) => second.includes(c))).toEqual([]);
  });

  it('baptism with godparents: one Event links the child, both parents, two godparents and the priest', async () => {
    const roles = await t.db.selectFrom('event_role').select(['role']).where('event_id', '=', L.janBaptism).execute();
    expect(roles.map((r) => r.role).sort()).toEqual(['child', 'father', 'godparent', 'godparent', 'mother', 'priest']);
  });

  it('oral history: the only evidence for a marriage is a Family account naming who gave it and when', async () => {
    const rows = await t.db
      .selectFrom('event_citation as ec')
      .innerJoin('citation as c', 'c.id', 'ec.citation_id')
      .innerJoin('source as s', 's.id', 'c.source_id')
      .select(['s.type', 's.account_given_by', 's.account_given_on', 'c.confidence'])
      .where('ec.event_id', '=', L.oralMarriage)
      .execute();
    expect(rows).toEqual([{ type: 'family_account', account_given_by: expect.stringContaining('Ludmila'), account_given_on: '2026-05-01', confidence: 'low' }]);
  });

  it('stores dates as written with derived earliest and latest days', async () => {
    const rows = await t.db.selectFrom('event').select(['date', 'date_earliest', 'date_latest']).where('date', 'in', ['1745~', '../1805', '1931~', '1749/1751']).orderBy('date_earliest').execute();
    expect(rows).toEqual([
      { date: '../1805', date_earliest: '-infinity', date_latest: '1805-12-31' },
      { date: '1745~', date_earliest: '1743-01-01', date_latest: '1747-12-31' },
      { date: '1749/1751', date_earliest: '1749-01-01', date_latest: '1751-12-31' },
      { date: '1931~', date_earliest: '1929-01-01', date_latest: '1933-12-31' },
    ]);
  });
});
