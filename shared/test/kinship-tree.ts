// Invented Trees for the kinship tests: Persons, Families and child links by readable ids. Nobody
// here is real (the repo is public).
import { buildKinshipGraph, KinshipSearch, kinshipPaths, kinshipShort, type KinshipData } from '../src/index.js';
import type { ChildLinkType, Sex } from '../src/schemas/tree.js';

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends ReadonlyArray<infer U> ? Array<{ -readonly [P in keyof U]: U[P] }> : T[K] };

export class Tree {
  readonly data: Mutable<KinshipData> = { persons: [], families: [], childLinks: [] };

  person(id: string, sex: Sex = 'male'): string {
    this.data.persons.push({ id, sex });
    return id;
  }

  people(...entries: Array<[string, Sex]>): void {
    for (const [id, sex] of entries) this.person(id, sex);
  }

  /** A Family; `married` records a marriage Event of both, `confidences` the Citations of the partner link. */
  family(id: string, partner1: string | null, partner2: string | null, opts: { married?: boolean; confidences?: string[] } = {}): string {
    this.data.families.push({ id, partner1, partner2, married: opts.married ?? true, confidences: opts.confidences ?? ['high'] });
    return id;
  }

  /** A child of a Family, with the Citations of the link to each partner. */
  child(familyId: string, childId: string, opts: { type?: ChildLinkType; confidences1?: string[]; confidences2?: string[]; id?: string } = {}): void {
    this.data.childLinks.push({
      id: opts.id ?? `cl-${familyId}-${childId}`,
      familyId,
      childId,
      type: opts.type ?? 'birth',
      confidences1: opts.confidences1 ?? ['high'],
      confidences2: opts.confidences2 ?? ['high'],
    });
  }

  /** A couple and their children by birth, every link confirmed. */
  couple(id: string, father: string | null, mother: string | null, ...children: string[]): string {
    this.family(id, father, mother);
    for (const c of children) this.child(id, c);
    return id;
  }
}

/** Every path from `from` to `to`, as the server would answer. */
export function kin(data: KinshipData, from: string, to: string, bound?: number) {
  const g = buildKinshipGraph(data);
  return kinshipPaths(new KinshipSearch(g, g.index.get(from)!), g.index.get(to)!, bound);
}

export function short(data: KinshipData, from: string, to: string) {
  const g = buildKinshipGraph(data);
  return kinshipShort(new KinshipSearch(g, g.index.get(from)!), g.index.get(to)!);
}

/** A seeded generator of numbers in [0, 1), so that a generated Tree is the same on every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A pedigree that collapses: each generation four Persons in two couples, whose son and daughter
 * marry the other couple's children. Everyone in the last generation descends from the first
 * along many paths.
 */
export function lattice(generations: number): { tree: Tree; last: [string, string] } {
  const tree = new Tree();
  let men = ['g0-m0', 'g0-m1'];
  let women = ['g0-f0', 'g0-f1'];
  for (const id of [...men, ...women]) tree.person(id, id.includes('-m') ? 'male' : 'female');
  for (let g = 1; g <= generations; g++) {
    const nextMen: string[] = [];
    const nextWomen: string[] = [];
    for (let c = 0; c < 2; c++) {
      const family = tree.family(`fam-${g}-${c}`, men[c]!, women[1 - c]!);
      const son = tree.person(`g${g}-m${c}`, 'male');
      const daughter = tree.person(`g${g}-f${c}`, 'female');
      tree.child(family, son);
      tree.child(family, daughter);
      nextMen.push(son);
      nextWomen.push(daughter);
    }
    men = nextMen;
    women = nextWomen;
  }
  return { tree, last: [men[0]!, women[1]!] };
}
