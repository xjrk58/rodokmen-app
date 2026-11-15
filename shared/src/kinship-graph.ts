/**
 * The Family links of the Tree as kinship reads them (kinship design, "Computed on the server
 * from a copy of the Family links kept in memory"): Persons by index in the order of their ids by
 * code units, the Families with their couples, every parent link with its child link type and
 * Citations, and lists to walk them. Not proved; kinship-paths.ts lists the paths from it with the
 * proved rules of kinship.ts.
 */
import { ADOPTIVE_LINK, BIRTH_LINK, FOSTER_LINK, MAX_GENERATIONS, STEP_LINK, isFollowed, type ParentLink } from './kinship.js';
import { FEMALE, MALE, UNKNOWN_SEX } from './kinship-terms/shapes.js';
import type { FamilyLink } from './relation.js';
import type { ChildLinkType, Sex } from './schemas/tree.js';

/** The Family links of the Tree by id: what the server gathers (server/src/tree/kinship.ts). */
export interface KinshipData {
  readonly persons: ReadonlyArray<{ readonly id: string; readonly sex: Sex }>;
  /** Each Family: its partners, whether a marriage Event of both is recorded, and the Citations of the partner link. */
  readonly families: ReadonlyArray<{
    readonly id: string;
    readonly partner1: string | null;
    readonly partner2: string | null;
    readonly married: boolean;
    readonly confidences: readonly string[];
  }>;
  /** Each child link: its Family, the child, the link type, and the Citations of the parent link to each partner. */
  readonly childLinks: ReadonlyArray<{
    readonly id: string;
    readonly familyId: string;
    readonly childId: string;
    readonly type: ChildLinkType;
    readonly confidences1: readonly string[];
    readonly confidences2: readonly string[];
  }>;
}

export interface GraphFamily {
  readonly id: string;
  readonly p1: number;
  readonly p2: number;
  readonly married: boolean;
  readonly confidences: readonly string[];
  /** The same for every Family of the same two partners; a Family with one known partner is a couple of its own. */
  readonly couple: number;
}

/** A parent link with what a path needs to show it: its child link, Family and Citations. */
export interface GraphParentLink extends ParentLink {
  readonly childLinkId: string;
  readonly family: number;
  readonly confidences: readonly string[];
}

/** A Family link of any kind, for the connection chain: a partner link (`family` set) or a parent link. */
export interface GraphLink extends FamilyLink {
  readonly partner: boolean;
  /** The Family of a partner link, the parent link of a parent link. */
  readonly ref: number;
}

const LINK_TYPES: Record<ChildLinkType, number> = { birth: BIRTH_LINK, adoptive: ADOPTIVE_LINK, foster: FOSTER_LINK, step: STEP_LINK };
export const LINK_TYPE_NAMES: readonly ChildLinkType[] = ['birth', 'adoptive', 'foster', 'step'];
const SEXES: Record<Sex, number> = { male: MALE, female: FEMALE, unknown: UNKNOWN_SEX };

/** Ids compared by code units, never by locale, so the order is the same everywhere. */
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export interface KinshipGraph {
  readonly ids: readonly string[];
  readonly index: ReadonlyMap<string, number>;
  readonly sex: readonly number[];
  readonly families: readonly GraphFamily[];
  readonly parentLinks: readonly GraphParentLink[];
  readonly links: readonly GraphLink[];
  /** Followed (birth and adoptive) parent links by child, and by parent. */
  readonly upOf: readonly (readonly number[])[];
  readonly downOf: readonly (readonly number[])[];
  /** Step and foster parent links by child, and by parent. */
  readonly otherUpOf: readonly (readonly number[])[];
  readonly otherDownOf: readonly (readonly number[])[];
  /** The Families each Person is a partner in. */
  readonly familiesOf: readonly (readonly number[])[];
}

/** Indexes the Family links. The same records in any order give the same graph. */
export function buildKinshipGraph(data: KinshipData): KinshipGraph {
  const persons = [...data.persons].sort(byId);
  const ids = persons.map((p) => p.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const at = (id: string | null) => (id === null ? -1 : (index.get(id) ?? -1));
  const empty = () => ids.map((): number[] => []);
  const familiesOf = empty();
  const couples = new Map<string, number>();
  const families: GraphFamily[] = [...data.families].sort(byId).map((f, i) => {
    const p1 = at(f.partner1);
    const p2 = at(f.partner2);
    const key = p1 >= 0 && p2 >= 0 ? `${Math.min(p1, p2)}:${Math.max(p1, p2)}` : `family:${i}`;
    if (!couples.has(key)) couples.set(key, couples.size);
    if (p1 >= 0) familiesOf[p1]!.push(i);
    if (p2 >= 0 && p2 !== p1) familiesOf[p2]!.push(i);
    return { id: f.id, p1, p2, married: f.married, confidences: f.confidences, couple: couples.get(key)! };
  });
  const familyIndex = new Map(families.map((f, i) => [f.id, i]));
  const parentLinks: GraphParentLink[] = [];
  const [upOf, downOf, otherUpOf, otherDownOf] = [empty(), empty(), empty(), empty()];
  for (const c of [...data.childLinks].sort(byId)) {
    const family = familyIndex.get(c.familyId);
    const child = at(c.childId);
    if (family === undefined || child < 0) continue;
    const f = families[family]!;
    for (const [parent, confidences] of [
      [f.p1, c.confidences1],
      [f.p2, c.confidences2],
    ] as const) {
      if (parent < 0 || parent === child) continue;
      const link: GraphParentLink = { child, parent, type: LINK_TYPES[c.type], couple: f.couple, childLinkId: c.id, family, confidences };
      const i = parentLinks.push(link) - 1;
      (isFollowed(link) ? upOf : otherUpOf)[child]!.push(i);
      (isFollowed(link) ? downOf : otherDownOf)[parent]!.push(i);
    }
  }
  const links: GraphLink[] = [
    ...families.flatMap((f, i) => (f.p1 >= 0 && f.p2 >= 0 && f.p1 !== f.p2 ? [{ a: f.p1, b: f.p2, confidences: f.confidences, partner: true, ref: i }] : [])),
    ...parentLinks.map((l, i) => ({ a: l.parent, b: l.child, confidences: l.confidences, partner: false, ref: i })),
  ];
  return { ids, index, sex: persons.map((p) => SEXES[p.sex]), families, parentLinks, links, upOf, downOf, otherUpOf, otherDownOf, familiesOf };
}

/** The other partner of a Family, -1 when not recorded. */
export const otherPartner = (f: GraphFamily, v: number) => (f.p1 === v ? f.p2 : f.p1);

// ---------------------------------------------------------------- chains up

/** One chain up from a Person: its top, its length, the link into the top, and the chain below. */
export interface ChainNode {
  readonly top: number;
  readonly len: number;
  readonly link: number;
  readonly prev: ChainNode | null;
}

/** The Persons of a chain, top first, and its parent links: `links[k]` joins parent `persons[k]` and child `persons[k + 1]`. */
export function chainOf(node: ChainNode): { persons: number[]; links: number[] } {
  const persons: number[] = [];
  const links: number[] = [];
  for (let n: ChainNode | null = node; n; n = n.prev) {
    persons.push(n.top);
    if (n.prev) links.push(n.link);
  }
  return { persons, links };
}

/**
 * Every chain up from one Person through birth and adoptive links, generation by generation, at
 * most {@link MAX_GENERATIONS}, never through the same Person twice. Built only as far as a search
 * asks, and kept for the next target of a list.
 */
export class ChainSet {
  private readonly levels: ChainNode[][];
  /** Chains by top, then by length. */
  readonly byTop = new Map<number, ChainNode[][]>();
  /** Chains built up to each length, the units they cost. */
  private readonly built: number[] = [1];

  constructor(
    private readonly g: KinshipGraph,
    readonly start: number,
  ) {
    const root: ChainNode = { top: start, len: 0, link: -1, prev: null };
    this.levels = [[root]];
    this.byTop.set(start, [[root]]);
  }

  /** Builds the chains up to `len` generations. */
  ensure(len: number): void {
    const target = Math.min(len, MAX_GENERATIONS);
    while (this.levels.length <= target) {
      const next: ChainNode[] = [];
      const depth = this.levels.length;
      for (const node of this.levels[depth - 1]!) {
        for (const i of this.g.upOf[node.top]!) {
          const parent = this.g.parentLinks[i]!.parent;
          if (onChain(node, parent)) continue;
          const added: ChainNode = { top: parent, len: depth, link: i, prev: node };
          next.push(added);
          const byLen = this.byTop.get(parent) ?? [];
          (byLen[depth] ??= []).push(added);
          this.byTop.set(parent, byLen);
        }
      }
      this.levels.push(next);
      this.built.push(this.built[depth - 1]! + next.length);
    }
  }

  /** The units the chains up to `len` cost: one per step of a chain built. */
  unitsUpTo(len: number): number {
    this.ensure(len);
    return this.built[Math.min(len, MAX_GENERATIONS)]!;
  }
}

/** Whether a chain holds Person `v`. */
export function onChain(node: ChainNode, v: number): boolean {
  for (let n: ChainNode | null = node; n; n = n.prev) if (n.top === v) return true;
  return false;
}
