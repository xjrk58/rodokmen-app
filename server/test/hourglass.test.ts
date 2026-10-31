import { ApiError, Hourglass, PersonDetail, PlaceEvents } from '@rodokmen/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateFixture } from '../src/fixture/generate.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, makeApp, signIn, type TestApp } from './helpers.js';

// add-family-view task 2a.1: the hourglass in one request, against the fixture's known families.
const model = generateFixture();
const L = model.landmarks;
const familyById = new Map(model.families.map((f) => [f.id, f]));
const parentsOf = (id: string) =>
  model.childLinks
    .filter((l) => l.childId === id)
    .flatMap((l) => [familyById.get(l.familyId)!.partner1Id, familyById.get(l.familyId)!.partner2Id])
    .filter((x): x is string => x !== null);
const familiesOf = (id: string) => model.families.filter((f) => f.partner1Id === id || f.partner2Id === id);
const childrenOf = (familyId: string) => model.childLinks.filter((l) => l.familyId === familyId).map((l) => l.childId);
const otherPartner = (f: { partner1Id: string | null; partner2Id: string | null }, id: string) => (f.partner1Id === id ? f.partner2Id : f.partner1Id);

/** Ancestors of `id` exactly `n` generations up, by the fixture model. */
function ancestorsAt(id: string, n: number): Set<string> {
  let row = new Set([id]);
  for (let i = 0; i < n; i++) row = new Set([...row].flatMap(parentsOf));
  return row;
}

describe('the hourglass around one Person', () => {
  let t: TestDatabase;
  let a: TestApp;
  let cookie: string;
  const get = async (url: string) => {
    const res = await a.app.inject({ method: 'GET', url, headers: { cookie } });
    expect(res.statusCode, res.body).toBe(200);
    return Hourglass.parse(res.json());
  };
  const byId = (h: Hourglass) => new Map(h.persons.map((p) => [p.person.id, p]));

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

  it('defaults to 3 generations up and 2 down, with the focus at generation 0', async () => {
    const h = await get(`/api/persons/${L.janNovak}/hourglass`);
    expect(h).toMatchObject({ focusId: L.janNovak, up: 3, down: 2 });
    const persons = byId(h);
    expect(persons.get(L.janNovak)).toMatchObject({ generation: 0, relation: 'focus' });
    for (let n = 1; n <= 3; n++) {
      for (const id of ancestorsAt(L.janNovak, n)) expect(persons.get(id), `ancestor ${n} up`).toMatchObject({ generation: n, relation: 'ancestor' });
    }
    expect(Math.max(...h.persons.map((p) => p.generation))).toBeLessThanOrEqual(3);
    expect(Math.min(...h.persons.map((p) => p.generation))).toBe(-2);
  });

  it('second marriage: both partners beside the focus, each Family with its own children', async () => {
    const h = await get(`/api/persons/${L.janNovak}/hourglass?up=1&down=1`);
    const persons = byId(h);
    const families = familiesOf(L.janNovak);
    expect(families.map((f) => f.id).sort()).toEqual([L.janFirstFamily, L.janSecondFamily].sort());
    for (const f of families) {
      const partner = otherPartner(f, L.janNovak)!;
      expect(persons.get(partner)).toMatchObject({ generation: 0, relation: 'partner' });
      expect(h.families.map((x) => x.id)).toContain(f.id);
      const children = childrenOf(f.id);
      expect(children.length).toBeGreaterThan(0);
      for (const child of children) {
        expect(persons.get(child)).toMatchObject({ generation: -1, relation: 'descendant' });
        expect(h.childLinks).toContainEqual(expect.objectContaining({ familyId: f.id, childId: child }));
      }
    }
  });

  it('partners appear beside descendants in the bottom row too, without their children', async () => {
    const h = await get(`/api/persons/${L.janNovak}/hourglass?up=1&down=1`);
    const persons = byId(h);
    const marriedChild = childrenOf(L.janSecondFamily).find((c) => familiesOf(c).some((f) => otherPartner(f, c)));
    expect(marriedChild).toBeDefined();
    for (const f of familiesOf(marriedChild!)) {
      const partner = otherPartner(f, marriedChild!);
      if (partner) expect(persons.get(partner)).toMatchObject({ generation: -1, relation: 'partner' });
      // Their children are one generation further down than asked for.
      for (const grandchild of childrenOf(f.id)) expect(persons.has(grandchild)).toBe(false);
    }
    expect(persons.get(marriedChild!)!.moreBelow).toBe(familiesOf(marriedChild!).some((f) => childrenOf(f.id).length > 0));
  });

  it('deeper ancestry: 5 generations up reach the founders, and the top row says when more is known', async () => {
    const h = await get(`/api/persons/${L.proband}/hourglass?up=5&down=1`);
    const persons = byId(h);
    const fifth = ancestorsAt(L.proband, 5);
    expect(fifth.has(L.founder)).toBe(true);
    for (const id of fifth) expect(persons.get(id)).toMatchObject({ generation: 5, relation: 'ancestor' });

    const three = byId(await get(`/api/persons/${L.proband}/hourglass?up=3&down=1`));
    for (const id of ancestorsAt(L.proband, 3)) expect(three.get(id)!.moreAbove, id).toBe(parentsOf(id).length > 0);
    // The founders have no known parents.
    const founders = byId(await get(`/api/persons/${L.founder}/hourglass?up=1&down=1`));
    expect([...founders.values()].filter((p) => p.relation === 'ancestor')).toEqual([]);
  });

  it('adoption: both the birth Family and the adoptive Family are there, with their link types', async () => {
    const h = await get(`/api/persons/${L.adoptedChild}/hourglass?up=1&down=1`);
    const persons = byId(h);
    expect(h.childLinks).toContainEqual(expect.objectContaining({ familyId: L.adoptedBirthFamily, childId: L.adoptedChild, linkType: 'birth' }));
    expect(h.childLinks).toContainEqual(expect.objectContaining({ familyId: L.adoptedAdoptiveFamily, childId: L.adoptedChild, linkType: 'adoptive' }));
    for (const familyId of [L.adoptedBirthFamily, L.adoptedAdoptiveFamily]) {
      const f = familyById.get(familyId)!;
      for (const parent of [f.partner1Id, f.partner2Id]) if (parent) expect(persons.get(parent)).toMatchObject({ generation: 1, relation: 'ancestor' });
    }
  });

  it('allows 1 to 6 generations each way and refuses others', async () => {
    expect((await get(`/api/persons/${L.proband}/hourglass?up=6&down=6`)).up).toBe(6);
    for (const q of ['up=0', 'up=7', 'down=0', 'down=7', 'up=x']) {
      const res = await a.app.inject({ method: 'GET', url: `/api/persons/${L.proband}/hourglass?${q}`, headers: { cookie } });
      expect(res.statusCode, q).toBe(400);
    }
  });

  it('is for Members only, and an unknown Person is a 404', async () => {
    expect((await a.app.inject({ method: 'GET', url: `/api/persons/${L.proband}/hourglass` })).statusCode).toBe(401);
    const res = await a.app.inject({ method: 'GET', url: '/api/persons/0192f0c4-7a1e-7c3b-9d2a-000000000000/hourglass', headers: { cookie } });
    expect(res.statusCode).toBe(404);
    expect(ApiError.parse(res.json()).code).toBe('not_found');
  });
});

describe('what the person page and the place sheet read', () => {
  let t: TestDatabase;
  let a: TestApp;
  let cookie: string;

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

  it("each of a Person's Events carries its Citations with their confidence", async () => {
    const res = await a.app.inject({ method: 'GET', url: `/api/persons/${L.janNovak}`, headers: { cookie } });
    const person = PersonDetail.parse(res.json());
    const baptism = person.events.find((e) => e.event.id === L.janBaptism)!;
    expect(baptism.role).toBe('child');
    expect(baptism.citations.length).toBeGreaterThan(0);
    const citation = baptism.citations[0]!;
    expect(citation.sourceTitle).not.toBe('');
    expect(['very_low', 'low', 'normal', 'high', 'very_high']).toContain(citation.confidence);
  });

  it('godparent role: the godmother of a baptism has it among her Events', async () => {
    const godparentRole = model.roles.find((r) => r.eventId === L.janBaptism && r.role === 'godparent')!;
    const res = await a.app.inject({ method: 'GET', url: `/api/persons/${godparentRole.personId}`, headers: { cookie } });
    const person = PersonDetail.parse(res.json());
    expect(person.events.find((e) => e.event.id === L.janBaptism)).toMatchObject({ role: 'godparent' });
  });

  it('Family here: the Events of a Place and its Houses, with who took part, earliest first', async () => {
    const res = await a.app.inject({ method: 'GET', url: `/api/places/${L.kamennaLhota}/events`, headers: { cookie } });
    expect(res.statusCode, res.body).toBe(200);
    const here = PlaceEvents.parse(res.json());
    expect(here.place.id).toBe(L.kamennaLhota);
    const baptism = here.events.find((e) => e.id === L.janBaptism)!;
    expect(baptism.house?.id).toBe(L.houseA);
    expect(baptism.persons.find((p) => p.role === 'child')?.person.id).toBe(L.janNovak);
    expect(baptism.persons.filter((p) => p.role === 'godparent')).toHaveLength(2);
    const days = here.events.map((e) => e.earliest).filter((d): d is string => d !== null && d !== '-infinity');
    expect(days).toEqual([...days].sort());
    // Every Event at a House of the Place is there.
    const houses = new Set(model.houses.filter((h) => h.placeId === L.kamennaLhota).map((h) => h.id));
    const expected = model.events.filter((e) => e.placeId === L.kamennaLhota || (e.houseId !== null && houses.has(e.houseId))).length;
    expect(here.events).toHaveLength(Math.min(expected, 1000));
    expect(here.truncated).toBe(expected > 1000);
  });

  it('Family here is limited, for Members only, and an unknown Place is a 404', async () => {
    const two = PlaceEvents.parse((await a.app.inject({ method: 'GET', url: `/api/places/${L.kamennaLhota}/events?limit=2`, headers: { cookie } })).json());
    expect(two.events).toHaveLength(2);
    expect(two.truncated).toBe(true);
    expect((await a.app.inject({ method: 'GET', url: `/api/places/${L.kamennaLhota}/events` })).statusCode).toBe(401);
    expect((await a.app.inject({ method: 'GET', url: '/api/places/0192f0c4-7a1e-7c3b-9d2a-000000000000/events', headers: { cookie } })).statusCode).toBe(404);
  });
});
