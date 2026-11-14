import { describe, expect, it } from 'vitest';
import type { KinshipData, KinshipPathOut } from '../src/index.js';
import type { ChildLinkType } from '../src/schemas/tree.js';
import { kin, seeded, Tree } from './kinship-tree.js';

// The test of completeness, which is not proved (kinship design, "Determinism and the tools that
// keep it"): on small invented Trees, a naive search over every chain finds the same paths by
// birth and by marriage as kinshipPaths.

/** A random invented Tree of `size` Persons in generations, with every kind of child link and some couples recorded twice. */
function randomTree(seed: number, size: number): Tree {
  const r = seeded(seed);
  const t = new Tree();
  const generation: string[][] = [[]];
  for (let i = 0; i < size; i++) {
    const g = Math.min(Math.floor(i / 5), 5);
    (generation[g] ??= []).push(t.person(`p${String(i).padStart(2, '0')}`, r() < 0.5 ? 'male' : 'female'));
  }
  const pick = (xs: string[]) => xs[Math.floor(r() * xs.length)]!;
  let families = 0;
  for (let g = 1; g < generation.length; g++) {
    const older = generation[g - 1]!.concat(g >= 2 ? generation[g - 2]! : []);
    for (const child of generation[g]!) {
      const a = pick(older);
      const b = r() < 0.8 ? pick(older) : null;
      const id = t.family(`f${families++}`, a, b === a ? null : b, { married: r() < 0.7, confidences: r() < 0.7 ? ['high'] : ['low'] });
      const type: ChildLinkType = r() < 0.8 ? 'birth' : (['adoptive', 'foster', 'step'] as const)[Math.floor(r() * 3)]!;
      t.child(id, child, { type, confidences1: r() < 0.8 ? ['normal'] : [], confidences2: ['high'] });
      // Sometimes a second child of the same couple, recorded as another Family.
      if (r() < 0.3) {
        const sibling = pick(generation[g]!);
        if (sibling !== child) {
          const again = t.family(`f${families++}`, a, b === a ? null : b);
          t.child(again, sibling);
        }
      }
    }
    // Partners within the generation.
    for (let k = 0; k < 2; k++) t.family(`f${families++}`, pick(generation[g]!), pick(generation[g]!));
  }
  return t;
}

type Family = KinshipData['families'][number];
const coupleOf = (f: Family) => (f.partner1 && f.partner2 ? [f.partner1, f.partner2].sort().join('+') : f.id);

/** Each child's parents by birth or adoption, with the couple of the Family. */
function parentsOf(data: KinshipData): Map<string, Array<{ parent: string; couple: string }>> {
  const familyOf = new Map(data.families.map((f) => [f.id, f]));
  const parents = new Map<string, Array<{ parent: string; couple: string }>>();
  for (const c of data.childLinks) {
    if (c.type !== 'birth' && c.type !== 'adoptive') continue;
    const f = familyOf.get(c.familyId)!;
    for (const p of [f.partner1, f.partner2]) {
      if (p && p !== c.childId) parents.set(c.childId, [...(parents.get(c.childId) ?? []), { parent: p, couple: coupleOf(f) }]);
    }
  }
  return parents;
}

/** The naive search: every chain up through birth and adoptive links, at most 12 generations, no Person twice. */
function naive(data: KinshipData, from: string, to: string): Set<string> {
  const parents = parentsOf(data);
  const chains = (v: string) => {
    const out: Array<{ persons: string[]; couples: string[] }> = [];
    const walk = (persons: string[], couples: string[]) => {
      out.push({ persons, couples });
      if (persons.length > 12) return;
      for (const { parent, couple } of parents.get(persons[persons.length - 1]!) ?? []) if (!persons.includes(parent)) walk([...persons, parent], [...couples, couple]);
    };
    walk([v], []);
    return out;
  };
  /** Paths by birth from a to b: two chains to one top that share no other Person, with the couples next to each end. */
  const birth = (a: string, b: string) =>
    chains(a).flatMap((x) =>
      chains(b).flatMap((y) => {
        const top = x.persons[x.persons.length - 1]!;
        if (top !== y.persons[y.persons.length - 1] || x.persons.slice(0, -1).some((v) => y.persons.includes(v))) return [];
        const persons = [...x.persons, ...y.persons.slice(0, -1).reverse()];
        const steps = [...x.couples, ...[...y.couples].reverse()];
        return persons.length === 1 ? [] : [{ persons, first: steps[0] ?? null, last: steps[steps.length - 1] ?? null }];
      }),
    );
  const found = new Set<string>(birth(from, to).map((p) => `birth|${p.persons.join(',')}`));
  for (const f of data.families) {
    const partners = [f.partner1, f.partner2];
    if (!f.partner1 || !f.partner2) continue;
    // The kin of the reader's partner, not through the reader, not the reader's own child.
    const partner = partners.includes(from) ? partners.find((p) => p !== from) : null;
    if (partner && partner !== to)
      for (const p of birth(partner, to)) if (!p.persons.includes(from) && p.first !== coupleOf(f)) found.add(`marriage|${[from, ...p.persons].join(',')}`);
    // The partner of the reader's kin, not through the Person, not the reader's own parent.
    const other = partners.includes(to) ? partners.find((p) => p !== to) : null;
    if (other && other !== from)
      for (const p of birth(from, other)) if (!p.persons.includes(to) && p.last !== coupleOf(f)) found.add(`marriage|${[...p.persons, to].join(',')}`);
  }
  return found;
}

/** The paths of an answer, both variants of a path through the two partners of a couple. */
function listed(paths: KinshipPathOut[], from: string): Set<string> {
  const out = new Set<string>();
  for (const p of paths) {
    if (p.kind !== 'birth' && p.kind !== 'marriage') continue;
    if (p.steps.length === 1 && p.steps[0]!.linkType === 'step') continue;
    const persons = [from, ...p.steps.map((s) => s.person)];
    out.add(`${p.kind}|${persons.join(',')}`);
    if (p.commonAncestors.length === 2) {
      const [a, b] = p.commonAncestors;
      const other = persons.map((v) => (v === a ? b : v === b ? a : v));
      out.add(`${p.kind}|${other.join(',')}`);
    }
  }
  return out;
}

describe('completeness against a naive search (kinship spec, "Kinship along several paths")', () => {
  for (let seed = 1; seed <= 40; seed++) {
    it(`invented Tree ${seed}`, () => {
      const tree = randomTree(seed, 10 + (seed % 21));
      const ids = tree.data.persons.map((p) => p.id);
      const r = seeded(seed * 7);
      for (let k = 0; k < 6; k++) {
        const from = ids[Math.floor(r() * ids.length)]!;
        const to = ids[Math.floor(r() * ids.length)]!;
        if (from === to) continue;
        const answer = kin(tree.data, from, to);
        if (answer.more) continue;
        expect([...listed(answer.paths, from)].sort(), `${from} to ${to}`).toEqual([...naive(tree.data, from, to)].sort());
      }
    });
  }
});
