import { Pedigree } from '@rodokmen/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateFixture } from '../src/fixture/generate.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, makeApp, signIn, type TestApp } from './helpers.js';

const model = generateFixture();
const L = model.landmarks;

// The known pedigree, computed from the fixture model rather than from the database.
const familyById = new Map(model.families.map((f) => [f.id, f]));
const parentsOf = (id: string) =>
  model.childLinks
    .filter((l) => l.childId === id)
    .flatMap((l) => [familyById.get(l.familyId)!.partner1Id, familyById.get(l.familyId)!.partner2Id])
    .filter((x): x is string => x !== null);
const childrenOf = (id: string) =>
  model.families.filter((f) => f.partner1Id === id || f.partner2Id === id).flatMap((f) => model.childLinks.filter((l) => l.familyId === f.id).map((l) => l.childId));

function expected(rootId: string, generations: number, next: (id: string) => string[]): Map<string, number> {
  const found = new Map<string, number>([[rootId, 1]]);
  let frontier = [rootId];
  for (let g = 2; g <= generations; g++) {
    const nextFrontier: string[] = [];
    for (const id of frontier) {
      for (const p of next(id)) {
        if (found.has(p)) continue;
        found.set(p, g);
        nextFrontier.push(p);
      }
    }
    frontier = nextFrontier;
  }
  return found;
}

describe('ancestors and descendants in one request', () => {
  let t: TestDatabase;
  let a: TestApp;
  let cookie: string;
  const get = async (url: string) => {
    const res = await a.app.inject({ method: 'GET', url, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    return Pedigree.parse(res.json());
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

  it('pedigree: 6 generations of ancestors hold every known ancestor, with the links between them', async () => {
    const p = await get(`/api/persons/${L.proband}/ancestors?generations=6`);
    const known = expected(L.proband, 6, parentsOf);
    expect(new Map(p.persons.map((x) => [x.person.id, x.generation]))).toEqual(known);
    // The pedigree reaches the founding generation: Václav Novák is in generation 6.
    expect(p.persons.find((x) => x.person.id === L.founder)?.generation).toBe(6);
    expect(Math.max(...p.persons.map((x) => x.generation))).toBe(6);
    // Every child link between the returned Persons is there, and every Family it names.
    const ids = new Set(p.persons.map((x) => x.person.id));
    const expectedLinks = model.childLinks.filter((l) => ids.has(l.childId) && known.get(l.childId)! < 6).map((l) => l.id).sort();
    expect(p.childLinks.map((l) => l.id).sort()).toEqual(expectedLinks);
    const familyIds = new Set(p.families.map((f) => f.id));
    for (const l of p.childLinks) expect(familyIds.has(l.familyId)).toBe(true);
    for (const f of p.families) for (const partner of [f.partner1Id, f.partner2Id]) if (partner) expect(ids.has(partner)).toBe(true);
  });

  it('stops at the requested number of generations', async () => {
    const p = await get(`/api/persons/${L.proband}/ancestors?generations=3`);
    expect(new Map(p.persons.map((x) => [x.person.id, x.generation]))).toEqual(expected(L.proband, 3, parentsOf));
    expect(p.persons.filter((x) => x.relation === 'root').map((x) => x.person.id)).toEqual([L.proband]);
  });

  it('follows birth and adoptive links and says which is which', async () => {
    const p = await get(`/api/persons/${L.adoptedChild}/ancestors?generations=2`);
    const links = p.childLinks.filter((l) => l.childId === L.adoptedChild).map((l) => [l.familyId, l.linkType]);
    expect(links.sort()).toEqual(
      [
        [L.adoptedAdoptiveFamily, 'adoptive'],
        [L.adoptedBirthFamily, 'birth'],
      ].sort(),
    );
    expect(p.persons.filter((x) => x.generation === 2)).toHaveLength(4);
  });

  it('6 generations of descendants of the founder hold every known descendant, with partners', async () => {
    const p = await get(`/api/persons/${L.founder}/descendants?generations=6`);
    const known = expected(L.founder, 6, childrenOf);
    const descendants = p.persons.filter((x) => x.relation !== 'partner');
    expect(new Map(descendants.map((x) => [x.person.id, x.generation]))).toEqual(known);
    expect(descendants.map((x) => x.person.id)).toContain(L.proband);
    expect(Math.max(...descendants.map((x) => x.generation))).toBe(6);
    // Partners of descendants (such as the founder's wife and the in-laws) come with relation "partner".
    const partners = p.persons.filter((x) => x.relation === 'partner').map((x) => x.person.id);
    expect(partners.length).toBeGreaterThan(5);
    for (const id of partners) expect(known.has(id)).toBe(false);
  });

  it('answers 404 for an unknown Person', async () => {
    const res = await a.app.inject({ method: 'GET', url: '/api/persons/0192f0c4-7a1e-7c3b-9d2a-00000000ffff/ancestors', headers: { cookie } });
    expect(res.statusCode).toBe(404);
  });
});
