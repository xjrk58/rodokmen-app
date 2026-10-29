import { CitationDetail, EventDetail, FamilyDetail, HouseDetail, PersonDetail, PlaceDetail, SourceDetail } from '@rodokmen/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateFixture } from '../src/fixture/generate.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, makeApp, signIn, type TestApp } from './helpers.js';

const model = generateFixture();
const L = model.landmarks;

describe('read API on the fixture Tree', () => {
  let t: TestDatabase;
  let a: TestApp;
  let cookie: string;
  const get = (url: string) => a.app.inject({ method: 'GET', url, headers: { cookie } });

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t);
    await ensureOwner(t.db);
    cookie = await signIn(t.db, a.clock, await createMember(t.db, 'contributor'));
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  it('GET /api/persons/:id returns a Person with all Names, Events in date order, and Families', async () => {
    const res = await get(`/api/persons/${L.janNovak}`);
    expect(res.statusCode).toBe(200);
    const jan = PersonDetail.parse(res.json());
    // Latin and German forms are kept next to the primary Name "Jan Novák".
    expect(jan.names.map((n) => [n.type, n.asFound, n.primary])).toEqual([
      ['birth', 'Jan Novák', true],
      ['latin', 'Joannes Nowak', false],
      ['german', 'Johann Nowak', false],
    ]);
    expect(jan.names[1]!.citations).toHaveLength(1);
    expect(jan.living).toBe(false);
    const earliest = jan.events.map((e) => e.event.earliest ?? '');
    expect(earliest).toEqual([...earliest].sort());
    expect(jan.events[0]).toMatchObject({ role: 'child', event: { id: L.janBaptism, type: 'baptism', house: { id: L.houseA, number: '12' } } });
    // Second marriage: partner in two Families, each with its own children.
    expect(jan.familiesAsPartner.map((f) => f.id).sort()).toEqual([L.janFirstFamily, L.janSecondFamily].sort());
    for (const f of jan.familiesAsPartner) expect(f.children.length).toBeGreaterThan(0);
    expect(jan.familiesAsChild).toHaveLength(1);
    expect(jan.familiesAsChild[0]!.partners).toHaveLength(2);
  });

  it('reports Living as computed from Events', async () => {
    const living = async (id: string) => PersonDetail.parse((await get(`/api/persons/${id}`)).json()).living;
    expect(await living(L.bornIn1920)).toBe(false);
    expect(await living(L.undated)).toBe(true);
  });

  it('GET /api/families/:id returns partners, children with link types, and the marriage', async () => {
    const res = await get(`/api/families/${L.adoptedAdoptiveFamily}`);
    expect(res.statusCode).toBe(200);
    const f = FamilyDetail.parse(res.json());
    expect(f.partners).toHaveLength(2);
    expect(f.children.find((c) => c.person.id === L.adoptedChild)?.linkType).toBe('adoptive');
    expect(f.events.map((e) => e.type)).toContain('marriage');
    const birth = FamilyDetail.parse((await get(`/api/families/${L.adoptedBirthFamily}`)).json());
    expect(birth.children.find((c) => c.person.id === L.adoptedChild)?.linkType).toBe('birth');
  });

  it('GET /api/events/:id returns the baptism with six Roles, its Citation, and the Parish at that date', async () => {
    const res = await get(`/api/events/${L.janBaptism}`);
    expect(res.statusCode).toBe(200);
    const e = EventDetail.parse(res.json());
    expect(e.roles.map((r) => r.role).sort()).toEqual(['child', 'father', 'godparent', 'godparent', 'mother', 'priest']);
    expect(e.citations).toHaveLength(1);
    expect(e.parishes.map((p) => p.id)).toEqual([L.parishDolniKamenec]);
    expect(e.estates.map((x) => x.id)).toEqual([L.estateVrbice]);

    const e1870 = EventDetail.parse((await get(`/api/events/${L.event1870}`)).json());
    expect(e1870.parishes.map((p) => p.id)).toEqual([L.parishVrbice]);
    expect(e1870.estates).toEqual([]);
  });

  it('GET /api/places/:id returns names in three languages, Parish periods and Houses', async () => {
    const res = await get(`/api/places/${L.kamennaLhota}`);
    expect(res.statusCode).toBe(200);
    const p = PlaceDetail.parse(res.json());
    expect(p.name).toBe('Kamenná Lhota');
    expect(p.names.map((n) => n.language).sort()).toEqual(['cs', 'de', 'la']);
    expect(p.municipality).toEqual({ code: '999001', name: 'Kamenná Lhota' });
    expect(p.parishes.map((x) => [x.parish.id, x.period])).toEqual([
      [L.parishDolniKamenec, { from: null, to: '1857' }],
      [L.parishVrbice, { from: '1858', to: null }],
    ]);
    expect(p.houses.find((h) => h.id === L.houseA)?.numbers.map((n) => [n.number, n.period])).toEqual([
      ['12', { from: null, to: '1805' }],
      ['15', { from: '1806', to: null }],
    ]);
    const search = (await get('/api/places?q=lhota')).json();
    expect(search.items.map((x: { id: string }) => x.id)).toContain(L.kamennaLhota);
    expect((await get('/api/places?q=steinlhota')).json().items[0].id).toBe(L.kamennaLhota);
  });

  it('GET /api/places/:id/houses finds the House by its number at a date', async () => {
    const at = async (number: string, date: string) => (await get(`/api/places/${L.kamennaLhota}/houses?number=${number}&at=${date}`)).json().items.map((h: { id: string }) => h.id);
    expect(await at('12', '1801')).toEqual([L.houseA]);
    expect(await at('15', '1850')).toEqual([L.houseA]);
    expect(await at('12', '1850')).toEqual([L.houseB]);
    expect((await get(`/api/places/${L.kamennaLhota}/houses?number=12&at=about-1801`)).statusCode).toBe(400);
  });

  it('GET /api/houses/:id returns the House with the number each Event had', async () => {
    const res = await get(`/api/houses/${L.houseA}`);
    expect(res.statusCode).toBe(200);
    const h = HouseDetail.parse(res.json());
    expect(h.place.id).toBe(L.kamennaLhota);
    expect(h.events.find((e) => e.id === L.janBaptism)?.house?.number).toBe('12');
    expect(h.events.find((e) => e.id === L.janDeath)?.house?.number).toBe('15');
  });

  it('GET /api/parishes/:id and /api/estates/:id list their Places with periods', async () => {
    const parish = (await get(`/api/parishes/${L.parishVrbice}`)).json();
    expect(parish.places.find((p: { place: { id: string } }) => p.place.id === L.kamennaLhota).period).toEqual({ from: '1858', to: null });
    const estate = (await get(`/api/estates/${L.estateVrbice}`)).json();
    expect(estate.places.map((p: { period: unknown }) => p.period)).toContain(estate.places[0].period);
    expect(estate.places).toHaveLength(4);
  });

  it('GET /api/sources/:id and /api/citations/:id return the Family account and its Citation', async () => {
    const res = await get(`/api/sources/${L.familyAccountSource}`);
    expect(res.statusCode).toBe(200);
    const s = SourceDetail.parse(res.json());
    expect(s.type).toBe('family_account');
    expect(s.familyAccount).toMatchObject({ givenOn: '2026-05-01' });
    expect(s.citations).toHaveLength(1);
    const c = CitationDetail.parse((await get(`/api/citations/${s.citations[0]!.id}`)).json());
    expect(c.confidence).toBe('low');
    expect(c.page).toBeNull();
    expect(c.events.map((e) => e.id)).toEqual([L.oralMarriage]);
    const registers = (await get('/api/sources?type=parish_register&q=kamenec')).json();
    expect(registers.items.length).toBeGreaterThan(0);
  });

  it('returns page images only as expiring links', async () => {
    const event = EventDetail.parse((await get(`/api/events/${L.janBaptism}`)).json());
    const c = CitationDetail.parse((await get(`/api/citations/${event.citations[0]!.id}`)).json());
    expect(c.images).toHaveLength(1);
    const image = c.images[0]!;
    const url = new URL(image.url);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(new Date(image.urlExpiresAt).getTime() - a.clock.now().getTime()).toBe(300_000);
    const redirect = await get(`/api/images/${image.id}`);
    expect(redirect.statusCode).toBe(302);
    expect(redirect.headers.location).toContain('X-Amz-Signature=');
  });

  it('answers 404 for an unknown id when signed in, and 400 for a malformed one', async () => {
    expect((await get('/api/persons/0192f0c4-7a1e-7c3b-9d2a-000000000000')).statusCode).toBe(404);
    expect((await get('/api/persons/jan-novak-1801')).statusCode).toBe(400);
  });

  it('version after a change: reading a changed Person returns a different version', async () => {
    const before = PersonDetail.parse((await get(`/api/persons/${L.undated}`)).json());
    await t.db.updateTable('person').set({ sex: 'unknown' }).where('id', '=', L.undated).execute();
    const after = PersonDetail.parse((await get(`/api/persons/${L.undated}`)).json());
    expect(after.version).not.toBe(before.version);
    expect(after.version).toBe(before.version + 1);
    // Names carry their own versions.
    await t.db.updateTable('name').set({ as_found: 'Bedrich Nowak' }).where('person_id', '=', L.undated).execute();
    const renamed = PersonDetail.parse((await get(`/api/persons/${L.undated}`)).json());
    expect(renamed.names[0]!.version).toBe(after.names[0]!.version + 1);
  });
});
