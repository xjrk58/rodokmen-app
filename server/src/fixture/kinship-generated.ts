/**
 * Generated invented Trees for the kinship work bound and its measurements (add-kinship task
 * 4.1). Every Person is made up and has an id only; nothing here is real family data. The same
 * seed always gives the same Tree.
 *
 * - `sparse`: the shape of the production Tree, many Persons with few links: about 4,100 Persons,
 *   255 Families and their children, most Persons in no Family at all.
 * - `dense`: Places whose people intermarried for 14 generations: 5,000 Persons, about 2,000 Families,
 *   every Person after the first generation a child of one, so pedigrees collapse.
 */
import type { KinshipData } from '@rodokmen/shared';

type Mutable = {
  persons: Array<KinshipData['persons'][number]>;
  families: Array<KinshipData['families'][number]>;
  childLinks: Array<KinshipData['childLinks'][number]>;
};

/** A seeded generator of numbers in [0, 1). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const id = (prefix: string, n: number) => `00000000-0000-4000-8000-${prefix}${String(n).padStart(11, '0')}`;
const confidence = (r: () => number) => (r() < 0.75 ? ['normal'] : r() < 0.5 ? ['low'] : []);

/** The generated Tree of a shape, with the Persons of its youngest generation (for the measurements). */
export function generatedKinshipTree(shape: 'sparse' | 'dense', seed = 140): { data: KinshipData; youngest: string[] } {
  return shape === 'sparse' ? sparse(seed) : dense(seed);
}

function dense(seed: number): { data: KinshipData; youngest: string[] } {
  const r = seeded(seed);
  const data: Mutable = { persons: [], families: [], childLinks: [] };
  const GENERATIONS = 14;
  const PER_GENERATION = Math.floor(5000 / GENERATIONS);
  let generation: Array<{ id: string; male: boolean }> = [];
  let persons = 0;
  const person = () => {
    const p = { id: id('1', persons++), male: r() < 0.5 };
    data.persons.push({ id: p.id, sex: p.male ? 'male' : 'female' });
    return p;
  };
  for (let i = 0; i < PER_GENERATION; i++) generation.push(person());
  for (let g = 1; g < GENERATIONS; g++) {
    // Most of a generation marry within their own Place, about 60 Persons.
    const men = generation.filter((p) => p.male && r() < 0.85);
    const women = generation.filter((p) => !p.male && r() < 0.85);
    const couples: string[] = [];
    for (const m of men) {
      const place = Math.floor((generation.indexOf(m) / generation.length) * 6);
      const near = women.filter((w) => Math.floor((generation.indexOf(w) / generation.length) * 6) === place);
      const w = near.length > 0 ? near[Math.floor(r() * near.length)]! : women[Math.floor(r() * women.length)];
      if (!w) continue;
      women.splice(women.indexOf(w), 1);
      const f = id('2', data.families.length);
      data.families.push({ id: f, partner1: m.id, partner2: w.id, married: r() < 0.8, confidences: confidence(r) });
      couples.push(f);
    }
    const next: Array<{ id: string; male: boolean }> = [];
    for (let i = 0; i < PER_GENERATION && couples.length > 0; i++) {
      const child = person();
      const f = couples[Math.floor(r() * couples.length)]!;
      data.childLinks.push({
        id: id('3', data.childLinks.length),
        familyId: f,
        childId: child.id,
        type: r() < 0.97 ? 'birth' : 'adoptive',
        confidences1: confidence(r),
        confidences2: confidence(r),
      });
      next.push(child);
    }
    generation = next;
  }
  while (data.persons.length < 5000) person();
  return { data, youngest: generation.map((p) => p.id) };
}

function sparse(seed: number): { data: KinshipData; youngest: string[] } {
  const r = seeded(seed);
  const data: Mutable = { persons: [], families: [], childLinks: [] };
  for (let i = 0; i < 4100; i++) data.persons.push({ id: id('1', i), sex: r() < 0.5 ? 'male' : r() < 0.95 ? 'female' : 'unknown' });
  // 255 Families in lines of a few generations: the children of one are partners in the next.
  let free = 0;
  const take = () => data.persons[free++]!.id;
  let parents: string[] = [];
  const youngest: string[] = [];
  while (data.families.length < 255) {
    const p1 = parents.length > 0 && r() < 0.6 ? parents.splice(Math.floor(r() * parents.length), 1)[0]! : take();
    const p2 = r() < 0.9 ? take() : null;
    const f = id('2', data.families.length);
    data.families.push({ id: f, partner1: p1, partner2: p2, married: r() < 0.7, confidences: confidence(r) });
    const children = 1 + Math.floor(r() * 5);
    for (let c = 0; c < children; c++) {
      const child = take();
      data.childLinks.push({
        id: id('3', data.childLinks.length),
        familyId: f,
        childId: child,
        type: 'birth',
        confidences1: confidence(r),
        confidences2: confidence(r),
      });
      parents.push(child);
      youngest.push(child);
    }
    if (parents.length > 40) parents = parents.slice(-40);
  }
  return { data, youngest: youngest.slice(-200) };
}
