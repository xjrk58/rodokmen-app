/**
 * The relation to the family (tree-model spec, "Relation to the family is computed" and
 * "Relation follows the evidence"; GLOSSARY "Family root", "Relative", "Possible relative",
 * "Unrelated person").
 *
 * The rule works on Family links only: a partner link between the two partners of a Family, and
 * a parent link between each partner of a Family and each of its children. A Role at an Event
 * never links anyone; Events only carry the Citations that support a link. Each link comes with
 * the confidences of those Citations, and it is strong when one of them is normal or higher.
 *
 * - A Relative is a Family root, or is reached from one through strong links only.
 * - A Possible relative is reached from a Family root only through chains that need a weak link.
 * - Everyone else is an Unrelated person; with no Family root, that is everyone.
 *
 * {@link relationLevels} is proved with LemmaScript (ADR 0009, docs/verification.md): its two
 * searches ({@link reachFrom}) stop, reach every Family root, are closed under the links they may
 * follow, and reach nobody without a link from someone reached earlier. Which links and
 * Citations the server gathers from the Tree, and that it recomputes after every change, are not
 * proved; the tests cover them. {@link relationsOf} is the unverified shell around it.
 */

export const UNRELATED = 0;
export const POSSIBLE = 1;
export const RELATIVE = 2;

/** One Family link between two Persons (by index), with the confidences of the Citations that support it. */
export interface FamilyLink {
  readonly a: number;
  readonly b: number;
  readonly confidences: readonly string[];
}

/** Who a search reached; for each one the link it came through (`via`, -1 for a start) and when (`order`). */
export interface Reach {
  readonly reached: boolean[];
  readonly via: number[];
  readonly order: number[];
}

/** A Citation of normal or higher confidence confirms what it supports; low and very low do not. */
export function isConfirming(confidence: string): boolean {
  //@ verify
  //@ ensures confidence === 'normal' || confidence === 'high' || confidence === 'very_high' ==> \result
  //@ ensures confidence === 'low' || confidence === 'very_low' ==> !\result
  return confidence === 'normal' || confidence === 'high' || confidence === 'very_high';
}

/** A link counts toward being a Relative when at least one of its Citations confirms it. */
export function isStrongLink(link: FamilyLink): boolean {
  //@ verify
  return link.confidences.some((c) => isConfirming(c));
}

/** Whether a search may follow a link: any link, or only strong ones. */
export function mayFollow(link: FamilyLink, strongOnly: boolean): boolean {
  //@ verify
  return !strongOnly || isStrongLink(link);
}

/**
 * Whether a reached Person came through a link the search may follow, from someone it reached earlier.
 * @public Only the proofs use it (docs/verification.md), which knip cannot see.
 */
export function isSupported(r: Reach, links: readonly FamilyLink[], strongOnly: boolean, v: number): boolean {
  //@ verify
  //@ requires 0 <= v && v < r.reached.length && r.reached.length === r.via.length && r.reached.length === r.order.length
  //@ requires forall(i: nat, i < links.length ==> 0 <= links[i].a && links[i].a < r.reached.length && 0 <= links[i].b && links[i].b < r.reached.length)
  const i = r.via[v]!;
  if (i < 0 || i >= links.length) return false;
  const l = links[i]!;
  if (!mayFollow(l, strongOnly)) return false;
  if (l.b === v) return r.reached[l.a]! && r.order[l.a]! < r.order[v]!;
  if (l.a === v) return r.reached[l.b]! && r.order[l.b]! < r.order[v]!;
  return false;
}

/**
 * Everyone reached from the starts (`isStart`) through the links the search may follow, in either
 * direction. It goes over the links again until a round reaches nobody new.
 */
export function reachFrom(count: number, isStart: readonly boolean[], links: readonly FamilyLink[], strongOnly: boolean): Reach {
  //@ verify
  //@ requires isStart.length === count
  //@ requires forall(i: nat, i < links.length ==> 0 <= links[i].a && links[i].a < count && 0 <= links[i].b && links[i].b < count)
  //@ ensures \result.reached.length === count && \result.via.length === count && \result.order.length === count
  // Every start is reached.
  //@ ensures forall(v: nat, v < count && isStart[v] ==> \result.reached[v])
  // Closed: a link the search may follow never leads from someone reached to someone not reached.
  //@ ensures forall(i: nat, i < links.length && mayFollow(links[i], strongOnly) && \result.reached[links[i].a] ==> \result.reached[links[i].b])
  //@ ensures forall(i: nat, i < links.length && mayFollow(links[i], strongOnly) && \result.reached[links[i].b] ==> \result.reached[links[i].a])
  // Sound: everyone reached who is not a start came through such a link from someone reached earlier,
  // so following `via` back, `order` falls at each step until a start: a chain of links from a start.
  //@ ensures forall(v: nat, v < count && \result.reached[v] && !isStart[v] ==> isSupported(\result, links, strongOnly, v))
  //@ ensures forall(v: nat, v < count ==> \result.order[v] >= 0)
  // With no start, nobody is reached.
  //@ ensures forall(v: nat, v < count ==> !isStart[v]) ==> forall(v: nat, v < count ==> !\result.reached[v])
  const reached: boolean[] = [];
  const via: number[] = [];
  const order: number[] = [];
  for (const start of isStart) {
    //@ invariant reached.length === _start_idx && via.length === _start_idx && order.length === _start_idx
    //@ invariant forall(v: nat, v < _start_idx ==> reached[v] === isStart[v] && via[v] === -1 && order[v] === 0)
    reached.push(start);
    via.push(-1);
    order.push(0);
  }
  let step = 1;
  let changed = true;
  while (changed) {
    //@ invariant reached.length === count && via.length === count && order.length === count
    //@ invariant step >= 1
    //@ invariant forall(v: nat, v < count && isStart[v] ==> reached[v])
    //@ invariant forall(v: nat, v < count ==> 0 <= order[v] && order[v] < step)
    //@ invariant forall(v: nat, v < count && reached[v] && !isStart[v] ==> isSupported({ reached: reached, via: via, order: order }, links, strongOnly, v))
    //@ invariant forall(v: nat, v < count ==> !isStart[v]) ==> forall(v: nat, v < count ==> !reached[v])
    //@ invariant !changed ==> forall(i: nat, i < links.length && mayFollow(links[i], strongOnly) && reached[links[i].a] ==> reached[links[i].b])
    //@ invariant !changed ==> forall(i: nat, i < links.length && mayFollow(links[i], strongOnly) && reached[links[i].b] ==> reached[links[i].a])
    changed = false;
    let i = 0;
    while (i < links.length) {
      //@ invariant 0 <= i && i <= links.length
      //@ invariant reached.length === count && via.length === count && order.length === count
      //@ invariant step >= 1
      //@ invariant forall(v: nat, v < count && isStart[v] ==> reached[v])
      //@ invariant forall(v: nat, v < count ==> 0 <= order[v] && order[v] < step)
      //@ invariant forall(v: nat, v < count && reached[v] && !isStart[v] ==> isSupported({ reached: reached, via: via, order: order }, links, strongOnly, v))
      //@ invariant forall(v: nat, v < count ==> !isStart[v]) ==> forall(v: nat, v < count ==> !reached[v])
      //@ invariant !changed ==> forall(j: nat, j < i && mayFollow(links[j], strongOnly) && reached[links[j].a] ==> reached[links[j].b])
      //@ invariant !changed ==> forall(j: nat, j < i && mayFollow(links[j], strongOnly) && reached[links[j].b] ==> reached[links[j].a])
      //@ decreases links.length - i
      const l = links[i]!;
      if (mayFollow(l, strongOnly)) {
        if (reached[l.a]! && !reached[l.b]!) {
          reached[l.b] = true;
          via[l.b] = i;
          order[l.b] = step;
          step = step + 1;
          changed = true;
        } else if (reached[l.b]! && !reached[l.a]!) {
          reached[l.a] = true;
          via[l.a] = i;
          order[l.a] = step;
          step = step + 1;
          changed = true;
        }
      }
      i = i + 1;
    }
  }
  return { reached, via, order };
}

/**
 * Each Person's relation to the family as a level: {@link RELATIVE}, {@link POSSIBLE} or
 * {@link UNRELATED}. Persons are 0 … count - 1; `isRoot` marks the Family roots.
 */
export function relationLevels(count: number, isRoot: readonly boolean[], links: readonly FamilyLink[]): number[] {
  //@ verify
  //@ contract tree-model: Relation to the family is computed
  //@ contract tree-model: Relation follows the evidence
  //@ requires isRoot.length === count
  //@ requires forall(i: nat, i < links.length ==> 0 <= links[i].a && links[i].a < count && 0 <= links[i].b && links[i].b < count)
  //@ ensures \result.length === count
  //@ ensures forall(v: nat, v < count ==> \result[v] === RELATIVE || \result[v] === POSSIBLE || \result[v] === UNRELATED)
  // Scenario "First Family roots": a Family root is a Relative ...
  //@ ensures forall(v: nat, v < count && isRoot[v] ==> \result[v] === RELATIVE)
  // ... and before the first one, everyone is an Unrelated person.
  //@ ensures forall(v: nat, v < count ==> !isRoot[v]) ==> forall(v: nat, v < count ==> \result[v] === UNRELATED)
  // Scenario "Linked through a confirmed marriage", and "Evidence improves" once a weak link gets a second Citation:
  // a link with a Citation of normal or higher confidence to a Relative makes a Relative, whatever its other Citations.
  //@ ensures forall(i: nat, i < links.length && exists(j: nat, j < links[i].confidences.length && (links[i].confidences[j] === 'normal' || links[i].confidences[j] === 'high' || links[i].confidences[j] === 'very_high')) && \result[links[i].a] === RELATIVE ==> \result[links[i].b] === RELATIVE)
  //@ ensures forall(i: nat, i < links.length && exists(j: nat, j < links[i].confidences.length && (links[i].confidences[j] === 'normal' || links[i].confidences[j] === 'high' || links[i].confidences[j] === 'very_high')) && \result[links[i].b] === RELATIVE ==> \result[links[i].a] === RELATIVE)
  // Scenario "Only a weak link": any link to a Relative or a Possible relative makes at least a Possible relative ...
  //@ ensures forall(i: nat, i < links.length && \result[links[i].a] !== UNRELATED ==> \result[links[i].b] !== UNRELATED)
  //@ ensures forall(i: nat, i < links.length && \result[links[i].b] !== UNRELATED ==> \result[links[i].a] !== UNRELATED)
  // ... and whoever is not a Family root and has only links whose Citations are all of low or very low confidence (or
  // that have none) is never a Relative.
  //@ ensures forall(v: nat, v < count && !isRoot[v] && forall(i: nat, i < links.length && (links[i].a === v || links[i].b === v) ==> forall(j: nat, j < links[i].confidences.length ==> links[i].confidences[j] === 'low' || links[i].confidences[j] === 'very_low')) ==> \result[v] !== RELATIVE)
  // Scenario "Godparent from the same village": with no Family link (a Role at an Event is none), whoever is not a
  // Family root is an Unrelated person.
  //@ ensures forall(v: nat, v < count && !isRoot[v] && forall(i: nat, i < links.length ==> links[i].a !== v && links[i].b !== v) ==> \result[v] === UNRELATED)
  const strong = reachFrom(count, isRoot, links, true);
  const any = reachFrom(count, strong.reached, links, false);
  const levels: number[] = [];
  let v = 0;
  while (v < count) {
    //@ invariant 0 <= v && v <= count && levels.length === v
    //@ invariant forall(u: nat, u < v ==> levels[u] === (strong.reached[u] ? RELATIVE : any.reached[u] ? POSSIBLE : UNRELATED))
    //@ decreases count - v
    levels.push(strong.reached[v]! ? RELATIVE : any.reached[v]! ? POSSIBLE : UNRELATED);
    v = v + 1;
  }
  return levels;
}

// ---------------------------------------------------------------- the shell

export const RELATIONS = ['relative', 'possible', 'unrelated'] as const;
export type Relation = (typeof RELATIONS)[number];

/** A Family link between two Persons by id, with the confidences of the Citations that support it. */
export interface FamilyLinkById {
  readonly a: string;
  readonly b: string;
  readonly confidences: readonly string[];
}

const NAMES: readonly Relation[] = ['unrelated', 'possible', 'relative'];

/**
 * The relation of each Person from the Family links and the Family roots, by id. Links and roots
 * naming a Person that is not listed are left out.
 */
export function relationsOf(personIds: readonly string[], roots: readonly string[], links: readonly FamilyLinkById[]): Map<string, Relation> {
  const index = new Map(personIds.map((id, i) => [id, i]));
  const rootSet = new Set(roots);
  const graph: FamilyLink[] = [];
  for (const l of links) {
    const a = index.get(l.a);
    const b = index.get(l.b);
    if (a !== undefined && b !== undefined && a !== b) graph.push({ a, b, confidences: l.confidences });
  }
  const levels = relationLevels(
    personIds.length,
    personIds.map((id) => rootSet.has(id)),
    graph,
  );
  return new Map(personIds.map((id, i) => [id, NAMES[levels[i]!]!]));
}

/**
 * The relation filter of search and the map Events query: `relative,possible` and the like, in any
 * combination. Null for no filter.
 */
export function parseRelationFilter(value: string | undefined): Relation[] | null {
  if (value === undefined) return null;
  const parts = value.split(',').filter((p): p is Relation => (RELATIONS as readonly string[]).includes(p));
  return [...new Set(parts)];
}
