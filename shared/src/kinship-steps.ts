/**
 * The parts of a kinship path (kinship design, "The Kinship model"): its steps, how a path is
 * finished with the proved rules of kinship.ts (possible, degree, the key that orders it), the
 * paths that are no chain by birth, and the answer by id. Not proved; kinship-paths.ts lists the
 * paths with them.
 */
import {
  ACROSS,
  COLLATERAL,
  CO_PARENT_IN_LAW,
  DIRECT,
  DOWN,
  FOSTER,
  FOSTER_LINK,
  MARRIAGE,
  PARTNER,
  STEP_SIBLING,
  UP,
  connectionChain,
  isPossiblePath,
  kinshipDegree,
  kinshipLine,
  type PathKey,
} from './kinship.js';
import { LINK_TYPE_NAMES, otherPartner, type KinshipGraph } from './kinship-graph.js';
import { termsOf, type KinshipTermText } from './kinship-terms/index.js';
import { SHAPE_CO_PARENT_IN_LAW, SHAPE_FOSTER, SHAPE_KIN_PARTNER, SHAPE_PARTNER, SHAPE_PARTNER_KIN, SHAPE_STEP_SIBLING } from './kinship-terms/shapes.js';
import { isStrongLink, type FamilyLink } from './relation.js';
import type { UiLanguage } from './schemas/common.js';
import type { ChildLinkType } from './schemas/tree.js';

export type KindName = 'self' | 'partner' | 'birth' | 'marriage' | 'stepSibling' | 'coParentInLaw' | 'foster';
const KIND_NAMES: readonly KindName[] = ['self', 'partner', 'birth', 'marriage', 'stepSibling', 'coParentInLaw', 'foster'];

/** One step of a path: to the next Person, through a link to a parent, a child or a partner. */
export interface PathStepOut {
  person: string;
  link: 'parent' | 'child' | 'partner';
  linkType: ChildLinkType | null;
  weak: boolean;
  /** The Family of a partner link, the child link of a parent or child link. */
  recordId: string;
}

export interface KinshipPathOut {
  kind: KindName;
  line: 'direct' | 'collateral' | null;
  degree: number | null;
  up: number;
  down: number;
  half: boolean;
  adoptive: boolean;
  possible: boolean;
  commonAncestors: string[];
  steps: PathStepOut[];
  term: Record<UiLanguage, KinshipTermText>;
}

export interface KinshipResult {
  paths: KinshipPathOut[];
  /** A limit cut the search: there may be more paths. */
  more: boolean;
  /** With no path, the shortest chain of any Family links and its number of partner links. */
  connection: { steps: PathStepOut[]; marriages: number } | null;
  /** The units the search cost. */
  units: number;
}

/** A step while searching: its direction, the Person it leads to, and the parent link or Family it goes through. */
export interface Step {
  dir: number;
  to: number;
  parentLink: number;
  family: number;
}

export interface Path {
  kind: number;
  shape: number;
  up: number;
  down: number;
  half: boolean;
  adoptive: boolean;
  married: boolean;
  persons: number[];
  steps: Step[];
  ancestors: number[];
  possible: boolean;
  key: PathKey;
}

// ---------------------------------------------------------------- finishing a path

export function stepLink(g: KinshipGraph, s: Step): FamilyLink {
  if (s.dir === ACROSS) return { a: 0, b: 0, confidences: g.families[s.family]!.confidences };
  return { a: 0, b: 0, confidences: g.parentLinks[s.parentLink]!.confidences };
}

export function coupleOf(g: KinshipGraph, s: Step): number {
  return s.dir === ACROSS ? g.families[s.family]!.couple : g.parentLinks[s.parentLink]!.couple;
}

export function finish(g: KinshipGraph, p: Omit<Path, 'possible' | 'key'>): Path {
  const possible = isPossiblePath(p.steps.map((s) => stepLink(g, s)));
  const degree = kinshipDegree(p.kind, p.up, p.down);
  return { ...p, possible, key: { kind: p.kind, degree, possible, up: p.up, down: p.down, persons: p.persons } };
}

type AddPath = (kind: number, shape: number, up: number, down: number, steps: Step[], married?: boolean) => void;

/** Partners: one path per couple, married when any of its Families records a marriage. */
function partnerPaths(g: KinshipGraph, from: number, to: number, add: AddPath): void {
  const couples = new Map<number, number[]>();
  for (const f of g.familiesOf[from]!) {
    if (otherPartner(g.families[f]!, from) !== to) continue;
    const couple = g.families[f]!.couple;
    couples.set(couple, [...(couples.get(couple) ?? []), f]);
  }
  for (const fs of couples.values()) {
    const strong = fs.find((f) => isStrongLink({ a: 0, b: 0, confidences: g.families[f]!.confidences })) ?? fs[0]!;
    add(
      PARTNER,
      SHAPE_PARTNER,
      0,
      0,
      [{ dir: ACROSS, to, parentLink: -1, family: strong }],
      fs.some((f) => g.families[f]!.married),
    );
  }
}

const parentsOf = (g: KinshipGraph, v: number) => new Set(g.upOf[v]!.map((i) => g.parentLinks[i]!.parent));
const up = (g: KinshipGraph, i: number): Step => ({ dir: UP, to: g.parentLinks[i]!.parent, parentLink: i, family: g.parentLinks[i]!.family });
const down = (g: KinshipGraph, i: number): Step => ({ dir: DOWN, to: g.parentLinks[i]!.child, parentLink: i, family: g.parentLinks[i]!.family });
const across = (to: number, family: number): Step => ({ dir: ACROSS, to, parentLink: -1, family });

/** Step-siblings: a child of a parent's partner, with no parent in common. */
function stepSiblingPaths(g: KinshipGraph, from: number, to: number, add: AddPath): void {
  const toParents = parentsOf(g, to);
  if ([...parentsOf(g, from)].some((p) => toParents.has(p))) return;
  for (const u of g.upOf[from]!) {
    const X = g.parentLinks[u]!.parent;
    for (const f of g.familiesOf[X]!) {
      const Y = otherPartner(g.families[f]!, X);
      if (Y < 0 || Y === from || !toParents.has(Y)) continue;
      const d = g.downOf[Y]!.find((i) => g.parentLinks[i]!.child === to)!;
      add(STEP_SIBLING, SHAPE_STEP_SIBLING, 1, 1, [up(g, u), across(Y, f), down(g, d)]);
    }
  }
}

/** Co-parents-in-law: a parent of a child's partner who is no parent of the child. */
function coParentPaths(g: KinshipGraph, from: number, to: number, add: AddPath): void {
  for (const d of g.downOf[from]!) {
    const C = g.parentLinks[d]!.child;
    if (parentsOf(g, C).has(to)) continue;
    for (const f of g.familiesOf[C]!) {
      const D = otherPartner(g.families[f]!, C);
      if (D < 0 || D === from) continue;
      const u = g.upOf[D]!.find((i) => g.parentLinks[i]!.parent === to);
      if (u !== undefined) add(CO_PARENT_IN_LAW, SHAPE_CO_PARENT_IN_LAW, 1, 1, [down(g, d), across(D, f), up(g, u)]);
    }
  }
}

/** Step and foster child links name their own pair, never followed further, unless the pair is parent and child by birth or adoption. */
function stepAndFosterPaths(g: KinshipGraph, from: number, to: number, add: AddPath): void {
  for (const i of g.otherDownOf[from]!) {
    const l = g.parentLinks[i]!;
    if (l.child !== to || parentsOf(g, to).has(from)) continue;
    if (l.type === FOSTER_LINK) add(FOSTER, SHAPE_FOSTER, 0, 1, [down(g, i)]);
    else add(MARRIAGE, SHAPE_PARTNER_KIN, 0, 1, [down(g, i)]);
  }
  for (const i of g.otherUpOf[from]!) {
    const l = g.parentLinks[i]!;
    if (l.parent !== to || parentsOf(g, from).has(to)) continue;
    if (l.type === FOSTER_LINK) add(FOSTER, SHAPE_FOSTER, 1, 0, [up(g, i)]);
    else add(MARRIAGE, SHAPE_KIN_PARTNER, 1, 0, [up(g, i)]);
  }
}

/** Partners, step-siblings, co-parents-in-law, and step and foster pairs: the paths that are no chain by birth. */
export function otherPaths(g: KinshipGraph, from: number, to: number): Path[] {
  const out: Path[] = [];
  const add: AddPath = (kind, shape, up, down, steps, married = false) =>
    out.push(finish(g, { kind, shape, up, down, half: false, adoptive: false, married, persons: [from, ...steps.map((x) => x.to)], steps, ancestors: [] }));
  partnerPaths(g, from, to, add);
  stepSiblingPaths(g, from, to, add);
  coParentPaths(g, from, to, add);
  stepAndFosterPaths(g, from, to, add);
  return out;
}

// ---------------------------------------------------------------- answers by id

function stepOut(g: KinshipGraph, s: Step): PathStepOut {
  const weak = !isStrongLink(stepLink(g, s));
  if (s.dir === ACROSS) return { person: g.ids[s.to]!, link: 'partner', linkType: null, weak, recordId: g.families[s.family]!.id };
  const l = g.parentLinks[s.parentLink]!;
  return { person: g.ids[s.to]!, link: s.dir === UP ? 'parent' : 'child', linkType: LINK_TYPE_NAMES[l.type]!, weak, recordId: l.childLinkId };
}

export function pathOut(g: KinshipGraph, to: number, p: Path): KinshipPathOut {
  const line = kinshipLine(p.kind, p.up, p.down);
  return {
    kind: KIND_NAMES[p.kind]!,
    line: line === DIRECT ? 'direct' : line === COLLATERAL ? 'collateral' : null,
    degree: p.key.degree >= 0 ? p.key.degree : null,
    up: p.up,
    down: p.down,
    half: p.half,
    adoptive: p.adoptive,
    possible: p.possible,
    commonAncestors: p.ancestors.map((v) => g.ids[v]!),
    steps: p.steps.map((s) => stepOut(g, s)),
    term: termsOf({ shape: p.shape, up: p.up, down: p.down, sex: g.sex[to]!, half: p.half, adoptive: p.adoptive, married: p.married }),
  };
}

/** With no kinship, the shortest chain of any Family links, and its number of partner links. */
export function connectionOf(g: KinshipGraph, from: number, to: number): KinshipResult['connection'] {
  const c = connectionChain(g.ids.length, from, to, g.links);
  if (!c.found) return null;
  const steps = c.links.map((i, k): PathStepOut => {
    const l = g.links[i]!;
    const next = c.persons[k + 1]!;
    if (l.partner) return { person: g.ids[next]!, link: 'partner', linkType: null, weak: !isStrongLink(l), recordId: g.families[l.ref]!.id };
    const pl = g.parentLinks[l.ref]!;
    return {
      person: g.ids[next]!,
      link: pl.parent === next ? 'parent' : 'child',
      linkType: LINK_TYPE_NAMES[pl.type]!,
      weak: !isStrongLink(l),
      recordId: pl.childLinkId,
    };
  });
  return { steps, marriages: c.links.filter((i) => g.links[i]!.partner).length };
}
