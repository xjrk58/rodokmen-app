/**
 * Kinship (kinship spec): how one Person is related to another, worked out from the Family links
 * of the Tree by fixed rules, with no AI model and nothing that depends on the clock, chance or a
 * locale.
 *
 * This file holds the rules that are proved with LemmaScript (ADR 0009, docs/verification.md):
 *
 * - {@link kinshipDegree} and {@link kinshipLine}: the line and degree as the civil code counts them
 *   (§§ 771 to 773 by birth, § 774 by marriage);
 * - {@link chainsUp}: the generations up from a Person through birth and adoptive child links only;
 * - {@link closestPath}: the closest path by birth, whose two chains meet only at the common ancestor;
 * - {@link compareKinshipPaths}: the total, fixed order of paths;
 * - {@link isPossiblePath}: a path is possible when one of its links has no confirming Citation;
 * - {@link isHalf} and {@link namesOwnParentOrChild}: half kinship, and the paths by marriage that
 *   would name the reader's own parent or child;
 * - {@link connectionChain}: a chain of any Family links when there is no kinship.
 *
 * Persons are indexes 0 … count - 1, in the order of their ids by code units, so that comparing
 * indexes compares ids. kinship-paths.ts is the unverified shell that lists every path with these
 * rules; kinship-terms/ names them.
 */
import { isStrongLink, type FamilyLink } from './relation.js';

// ---------------------------------------------------------------- kinds, lines, link types and limits

/** The kinds of path (Kinship model, `kind`). */
export const SELF = 0;
export const PARTNER = 1;
/** By birth, adoption included. */
export const BIRTH = 2;
/** By marriage: the kin of a partner, the partner of a kin, or a step child link. */
export const MARRIAGE = 3;
export const STEP_SIBLING = 4;
export const CO_PARENT_IN_LAW = 5;
export const FOSTER = 6;

/** The lines of kinship (civil code § 772); none for the kinds with no degree. */
export const NO_LINE = 0;
export const DIRECT = 1;
export const COLLATERAL = 2;

/** The degree of the kinds that have none. */
export const NO_DEGREE = -1;

/** The types of a child link (`family_child.link_type`). */
export const BIRTH_LINK = 0;
export const ADOPTIVE_LINK = 1;
export const FOSTER_LINK = 2;
export const STEP_LINK = 3;

/** The directions of a step along a path: up to a parent, down to a child, across to a partner. */
export const UP = 0;
export const DOWN = 1;
export const ACROSS = 2;

/** How far up from each of the two Persons the search goes. */
export const MAX_GENERATIONS = 12;

/**
 * A parent link by index: a child of a Family, one of its partners, the type of the child link, and
 * the couple of the Family (the same for every Family of the same two partners).
 */
export interface ParentLink {
  readonly child: number;
  readonly parent: number;
  readonly type: number;
  readonly couple: number;
}

/** One step of a path: its direction and the couple of the Family it goes through. */
export interface PathStep {
  readonly dir: number;
  readonly couple: number;
}

/** What orders two paths (see {@link compareKinshipPaths}): the Persons are indexes, from the reader to the Person. */
export interface PathKey {
  readonly kind: number;
  readonly degree: number;
  readonly possible: boolean;
  readonly up: number;
  readonly down: number;
  readonly persons: readonly number[];
}

/** A search up from one Person: each Person's generations above it (-1 for nobody reached) and the link it was reached through. */
export interface Chains {
  readonly dist: number[];
  readonly via: number[];
}

/** A chain down from a common ancestor: its Persons, the ancestor first, and the parent links between them. */
export interface Chain {
  readonly persons: number[];
  readonly links: number[];
}

/** The closest path by birth: its common ancestor and its two chains down from it, to the reader and to the Person. */
export interface Closest {
  readonly found: boolean;
  readonly top: number;
  readonly toFrom: Chain;
  readonly toTo: Chain;
  readonly fromUp: Chains;
  readonly toUp: Chains;
}

/** A chain of any Family links between two Persons, and who a search from the first reached. */
export interface Connection {
  readonly found: boolean;
  readonly persons: number[];
  readonly links: number[];
  readonly reached: boolean[];
}

// ---------------------------------------------------------------- line and degree

/** Whether a kind of path has a line and degree: by birth, or by marriage (the part by birth). */
export function hasDegree(kind: number): boolean {
  //@ verify
  return kind === BIRTH || kind === MARRIAGE;
}

/**
 * The degree of kinship as the civil code counts it: the number of births between the two Persons
 * (§ 773), and for kinship by marriage the degree of the kin married into (§ 774). `up` and `down`
 * are the generations up from the reader to the common ancestors and down from them to the Person,
 * of the part by birth. {@link NO_DEGREE} for the kinds with none.
 */
export function kinshipDegree(kind: number, up: number, down: number): number {
  //@ verify
  //@ contract kinship: Line and degree of kinship by birth
  //@ contract kinship: Line and degree of kinship by marriage
  //@ requires up >= 0 && down >= 0
  //@ ensures hasDegree(kind) ==> \result === up + down
  //@ ensures \result === NO_DEGREE <==> !hasDegree(kind)
  //@ ensures kind === SELF || kind === PARTNER || kind === STEP_SIBLING || kind === CO_PARENT_IN_LAW || kind === FOSTER ==> \result === NO_DEGREE
  // "Great-grandfather" 3, "Sibling" 2, "Uncle" 3, "First cousin and once removed" 4 and 5.
  //@ ensures kind === BIRTH && up === 3 && down === 0 ==> \result === 3
  //@ ensures kind === BIRTH && up === 1 && down === 1 ==> \result === 2
  //@ ensures kind === BIRTH && up === 2 && down === 1 ==> \result === 3
  //@ ensures kind === BIRTH && up === 2 && down === 2 ==> \result === 4
  //@ ensures kind === BIRTH && up === 2 && down === 3 ==> \result === 5
  // "Brother-in-law": the wife's brother, 2; "Daughter-in-law": the son's wife, 1.
  //@ ensures kind === MARRIAGE && up === 1 && down === 1 ==> \result === 2
  //@ ensures kind === MARRIAGE && up === 0 && down === 1 ==> \result === 1
  if (hasDegree(kind)) return up + down;
  return NO_DEGREE;
}

/** The line of kinship: direct when one descends from the other, else collateral; none for the kinds with no degree. */
export function kinshipLine(kind: number, up: number, down: number): number {
  //@ verify
  //@ contract kinship: Line and degree of kinship by birth
  //@ contract kinship: Line and degree of kinship by marriage
  //@ requires up >= 0 && down >= 0
  //@ ensures \result === DIRECT <==> hasDegree(kind) && (up === 0 || down === 0)
  //@ ensures \result === COLLATERAL <==> hasDegree(kind) && up > 0 && down > 0
  //@ ensures \result === NO_LINE <==> !hasDegree(kind)
  // "Great-grandfather" and "Daughter-in-law" direct; "Sibling", "Uncle", "Brother-in-law" collateral; "Wife" none.
  //@ ensures kind === BIRTH && up === 3 && down === 0 ==> \result === DIRECT
  //@ ensures kind === BIRTH && up === 1 && down === 1 ==> \result === COLLATERAL
  //@ ensures kind === MARRIAGE && up === 0 && down === 1 ==> \result === DIRECT
  //@ ensures kind === MARRIAGE && up === 1 && down === 1 ==> \result === COLLATERAL
  //@ ensures kind === PARTNER ==> \result === NO_LINE
  if (!hasDegree(kind)) return NO_LINE;
  if (up === 0 || down === 0) return DIRECT;
  return COLLATERAL;
}

// ---------------------------------------------------------------- chains up

/** Kinship follows birth and adoptive child links only; step and foster links name their own pair and stop there. */
export function isFollowed(link: ParentLink): boolean {
  //@ verify
  //@ ensures \result <==> link.type === BIRTH_LINK || link.type === ADOPTIVE_LINK
  return link.type === BIRTH_LINK || link.type === ADOPTIVE_LINK;
}

/** Whether a Person reached by a search up came there from a child one generation lower, through a followed link. */
export function isStepUp(dist: readonly number[], via: readonly number[], links: readonly ParentLink[], v: number): boolean {
  //@ verify
  //@ requires 0 <= v && v < dist.length && dist.length === via.length
  //@ requires forall(i: nat, i < links.length ==> 0 <= links[i].child && links[i].child < dist.length && 0 <= links[i].parent && links[i].parent < dist.length)
  const i = via[v]!;
  if (i < 0 || i >= links.length) return false;
  const l = links[i]!;
  return isFollowed(l) && l.parent === v && dist[l.child]! === dist[v]! - 1;
}

/**
 * Every Person up from `start`, through birth and adoptive child links, at most
 * {@link MAX_GENERATIONS} generations up, each with the fewest generations it is above `start`
 * and the link it was first reached through. A round per generation goes over the links once.
 */
export function chainsUp(count: number, start: number, links: readonly ParentLink[]): Chains {
  //@ verify
  //@ contract kinship: Kinship is computed from Family links
  //@ requires 0 <= start && start < count
  //@ requires forall(i: nat, i < links.length ==> 0 <= links[i].child && links[i].child < count && 0 <= links[i].parent && links[i].parent < count)
  //@ ensures \result.dist.length === count && \result.via.length === count
  // The start is at 0, and nobody else is.
  //@ ensures \result.dist[start] === 0
  //@ ensures forall(v: nat, v < count && \result.dist[v] === 0 ==> v === start)
  //@ ensures forall(v: nat, v < count ==> -1 <= \result.dist[v] && \result.dist[v] <= MAX_GENERATIONS)
  // Closed within the limit: a followed parent of a Person d generations up, d below the limit, is at most d + 1 up.
  //@ ensures forall(i: nat, i < links.length && isFollowed(links[i]) && 0 <= \result.dist[links[i].child] && \result.dist[links[i].child] < MAX_GENERATIONS ==> 0 <= \result.dist[links[i].parent] && \result.dist[links[i].parent] <= \result.dist[links[i].child] + 1)
  // Sound: everyone above the start came through a followed link from a child one generation lower, so a chain of
  // followed links leads down to the start ("Godparent": only Family links are given, so no Role relates anyone).
  //@ ensures forall(v: nat, v < count && \result.dist[v] > 0 ==> isStepUp(\result.dist, \result.via, links, v))
  const dist: number[] = [];
  const via: number[] = [];
  let v = 0;
  while (v < count) {
    //@ invariant 0 <= v && v <= count && dist.length === v && via.length === v
    //@ invariant forall(u: nat, u < v ==> via[u] === -1 && (u === start ==> dist[u] === 0) && (u !== start ==> dist[u] === -1))
    //@ decreases count - v
    dist.push(v === start ? 0 : -1);
    via.push(-1);
    v = v + 1;
  }
  let d = 0;
  let grew = true;
  while (d < MAX_GENERATIONS && grew) {
    //@ invariant 0 <= d && d <= MAX_GENERATIONS && dist.length === count && via.length === count
    //@ invariant dist[start] === 0
    //@ invariant forall(u: nat, u < count ==> -1 <= dist[u] && dist[u] <= d)
    //@ invariant forall(u: nat, u < count && dist[u] === 0 ==> u === start)
    //@ invariant forall(u: nat, u < count && dist[u] > 0 ==> isStepUp(dist, via, links, u))
    //@ invariant forall(j: nat, j < links.length && isFollowed(links[j]) && 0 <= dist[links[j].child] && dist[links[j].child] < d ==> 0 <= dist[links[j].parent] && dist[links[j].parent] <= dist[links[j].child] + 1)
    //@ invariant !grew ==> forall(u: nat, u < count ==> dist[u] < d)
    //@ decreases MAX_GENERATIONS - d
    grew = false;
    let i = 0;
    while (i < links.length) {
      //@ invariant 0 <= i && i <= links.length && dist.length === count && via.length === count
      //@ invariant dist[start] === 0
      //@ invariant forall(u: nat, u < count ==> -1 <= dist[u] && dist[u] <= d + 1)
      //@ invariant forall(u: nat, u < count && dist[u] === 0 ==> u === start)
      //@ invariant forall(u: nat, u < count && dist[u] > 0 ==> isStepUp(dist, via, links, u))
      //@ invariant forall(j: nat, j < links.length && isFollowed(links[j]) && 0 <= dist[links[j].child] && dist[links[j].child] < d ==> 0 <= dist[links[j].parent] && dist[links[j].parent] <= dist[links[j].child] + 1)
      //@ invariant forall(j: nat, j < i && isFollowed(links[j]) && dist[links[j].child] === d ==> 0 <= dist[links[j].parent] && dist[links[j].parent] <= d + 1)
      //@ invariant !grew ==> forall(u: nat, u < count ==> dist[u] <= d)
      //@ decreases links.length - i
      const l = links[i]!;
      if (isFollowed(l) && dist[l.child]! === d && dist[l.parent]! === -1) {
        dist[l.parent] = d + 1;
        via[l.parent] = i;
        grew = true;
      }
      i = i + 1;
    }
    d = d + 1;
  }
  return { dist, via };
}

/** Whether step `k` of a chain goes from its Person `k` down to Person `k + 1` through a followed link. */
export function linkedAt(links: readonly ParentLink[], used: readonly number[], persons: readonly number[], k: number): boolean {
  //@ verify
  //@ requires 0 <= k && k < used.length && used.length < persons.length
  const i = used[k]!;
  if (i < 0 || i >= links.length) return false;
  return isFollowed(links[i]!) && links[i]!.parent === persons[k]! && links[i]!.child === persons[k + 1]!;
}

/**
 * The chain down from `top` to the start of a search up, following the links it was reached
 * through: `top` first, the start last, one generation lower at each step.
 */
export function chainDown(c: Chains, count: number, start: number, links: readonly ParentLink[], top: number): Chain {
  //@ verify
  //@ requires c.dist.length === count && c.via.length === count && 0 <= start && start < count && 0 <= top && top < count
  //@ requires forall(i: nat, i < links.length ==> 0 <= links[i].child && links[i].child < count && 0 <= links[i].parent && links[i].parent < count)
  //@ requires c.dist[top] >= 0
  //@ requires forall(v: nat, v < count && c.dist[v] === 0 ==> v === start)
  //@ requires forall(v: nat, v < count && c.dist[v] > 0 ==> isStepUp(c.dist, c.via, links, v))
  //@ ensures \result.persons.length === c.dist[top] + 1 && \result.links.length === c.dist[top]
  //@ ensures \result.persons[0] === top && \result.persons[c.dist[top]] === start
  //@ ensures forall(k: nat, k < \result.persons.length ==> 0 <= \result.persons[k] && \result.persons[k] < count && c.dist[\result.persons[k]] === c.dist[top] - k)
  //@ ensures forall(k: nat, k < \result.links.length ==> linkedAt(links, \result.links, \result.persons, k))
  const persons: number[] = [top];
  const used: number[] = [];
  let v = top;
  while (c.dist[v]! > 0) {
    //@ invariant 0 <= v && v < count && c.dist[v] >= 0
    //@ invariant persons.length === c.dist[top] - c.dist[v] + 1 && used.length === persons.length - 1
    //@ invariant persons[0] === top && persons[persons.length - 1] === v
    //@ invariant forall(k: nat, k < persons.length ==> 0 <= persons[k] && persons[k] < count && c.dist[persons[k]] === c.dist[top] - k)
    //@ invariant forall(k: nat, k < used.length ==> linkedAt(links, used, persons, k))
    //@ decreases c.dist[v]
    //@ assert isStepUp(c.dist, c.via, links, v)
    const i = c.via[v]!;
    const l = links[i]!;
    used.push(i);
    persons.push(l.child);
    v = l.child;
  }
  return { persons, links: used };
}

/**
 * The closest path by birth between `from` and `to`: the common ancestor with the fewest
 * generations up from both together (the lowest index when several have as few), and the chains
 * down from it to each. When one is the other's ancestor, that one is the common ancestor.
 */
export function closestPath(count: number, from: number, to: number, links: readonly ParentLink[]): Closest {
  //@ verify
  //@ contract kinship: Paths in a fixed order
  //@ requires 0 <= from && from < count && 0 <= to && to < count
  //@ requires forall(i: nat, i < links.length ==> 0 <= links[i].child && links[i].child < count && 0 <= links[i].parent && links[i].parent < count)
  //@ ensures \result.fromUp.dist.length === count && \result.toUp.dist.length === count
  //@ ensures \result.fromUp.dist[from] === 0 && \result.toUp.dist[to] === 0
  // The searches up are those of chainsUp: closed within the limit, so each distance is the fewest generations.
  //@ ensures forall(i: nat, i < links.length && isFollowed(links[i]) && 0 <= \result.fromUp.dist[links[i].child] && \result.fromUp.dist[links[i].child] < MAX_GENERATIONS ==> 0 <= \result.fromUp.dist[links[i].parent] && \result.fromUp.dist[links[i].parent] <= \result.fromUp.dist[links[i].child] + 1)
  //@ ensures forall(i: nat, i < links.length && isFollowed(links[i]) && 0 <= \result.toUp.dist[links[i].child] && \result.toUp.dist[links[i].child] < MAX_GENERATIONS ==> 0 <= \result.toUp.dist[links[i].parent] && \result.toUp.dist[links[i].parent] <= \result.toUp.dist[links[i].child] + 1)
  // Found exactly when the two have a common ancestor within the limits ...
  //@ ensures \result.found <==> exists(v: nat, v < count && \result.fromUp.dist[v] >= 0 && \result.toUp.dist[v] >= 0)
  // ... and then its degree is at most the generations to every common ancestor within the limits ("Two cousinships").
  //@ ensures \result.found ==> 0 <= \result.top && \result.top < count && \result.fromUp.dist[\result.top] >= 0 && \result.toUp.dist[\result.top] >= 0
  //@ ensures \result.found ==> forall(v: nat, v < count && \result.fromUp.dist[v] >= 0 && \result.toUp.dist[v] >= 0 ==> \result.toFrom.links.length + \result.toTo.links.length <= \result.fromUp.dist[v] + \result.toUp.dist[v])
  // Its chains are chains of followed links from the common ancestor down to each of the two ...
  //@ ensures \result.found ==> \result.toFrom.persons.length === \result.toFrom.links.length + 1 && \result.toFrom.persons[0] === \result.top && \result.toFrom.persons[\result.toFrom.links.length] === from
  //@ ensures \result.found ==> \result.toTo.persons.length === \result.toTo.links.length + 1 && \result.toTo.persons[0] === \result.top && \result.toTo.persons[\result.toTo.links.length] === to
  //@ ensures \result.found ==> forall(k: nat, k < \result.toFrom.links.length ==> linkedAt(links, \result.toFrom.links, \result.toFrom.persons, k))
  //@ ensures \result.found ==> forall(k: nat, k < \result.toTo.links.length ==> linkedAt(links, \result.toTo.links, \result.toTo.persons, k))
  // ... that meet only at it.
  //@ ensures \result.found ==> forall(i: nat, forall(j: nat, i < \result.toFrom.persons.length && j < \result.toTo.persons.length && \result.toFrom.persons[i] === \result.toTo.persons[j] ==> i === 0 && j === 0))
  const fromUp = chainsUp(count, from, links);
  const toUp = chainsUp(count, to, links);
  const top = nearestCommon(count, fromUp.dist, toUp.dist);
  if (top === -1) return { found: false, top: -1, toFrom: { persons: [], links: [] }, toTo: { persons: [], links: [] }, fromUp, toUp };
  const toFrom = chainDown(fromUp, count, from, links, top);
  const toTo = chainDown(toUp, count, to, links, top);
  return { found: true, top, toFrom, toTo, fromUp, toUp };
}

/**
 * The common ancestor with the fewest generations up from both together, the lowest index when
 * several have as few; -1 when there is none.
 */
export function nearestCommon(count: number, a: readonly number[], b: readonly number[]): number {
  //@ verify
  //@ requires a.length === count && b.length === count
  //@ ensures -1 <= \result && \result < count
  //@ ensures \result === -1 <==> forall(v: nat, v < count ==> !(a[v] >= 0 && b[v] >= 0))
  //@ ensures \result >= 0 ==> a[\result] >= 0 && b[\result] >= 0
  //@ ensures \result >= 0 ==> forall(v: nat, v < count && a[v] >= 0 && b[v] >= 0 ==> a[\result] + b[\result] <= a[v] + b[v])
  let top = -1;
  let best = 0;
  let v = 0;
  while (v < count) {
    //@ invariant 0 <= v && v <= count && -1 <= top && top < v
    //@ invariant top === -1 ==> forall(u: nat, u < v ==> !(a[u] >= 0 && b[u] >= 0))
    //@ invariant top >= 0 ==> a[top] >= 0 && b[top] >= 0 && best === a[top] + b[top]
    //@ invariant top >= 0 ==> forall(u: nat, u < v && a[u] >= 0 && b[u] >= 0 ==> best <= a[u] + b[u])
    //@ decreases count - v
    const x = a[v]!;
    const y = b[v]!;
    if (x >= 0 && y >= 0 && (top === -1 || x + y < best)) {
      top = v;
      best = x + y;
    }
    v = v + 1;
  }
  return top;
}

// ---------------------------------------------------------------- order

/** The rank of a kind of path: the reader first, then partners, then the kinds with a degree, then the others. */
export function kindRank(kind: number): number {
  //@ verify
  //@ ensures 0 <= \result && \result <= 6
  //@ ensures \result === 2 <==> hasDegree(kind)
  if (kind === SELF) return 0;
  if (kind === PARTNER) return 1;
  if (hasDegree(kind)) return 2;
  if (kind === STEP_SIBLING) return 3;
  if (kind === CO_PARENT_IN_LAW) return 4;
  if (kind === FOSTER) return 5;
  return 6;
}

/** -1, 0 or 1 as `a` is below, equal to or above `b`. */
export function compareInts(a: number, b: number): number {
  //@ verify
  //@ ensures (\result === -1 <==> a < b) && (\result === 0 <==> a === b) && (\result === 1 <==> a > b)
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Two lists of Persons of the same length, Person by Person from `i`. */
export function compareFrom(a: readonly number[], b: readonly number[], i: number): number {
  //@ verify
  //@ requires a.length === b.length && 0 <= i && i <= a.length
  //@ ensures \result === -1 || \result === 0 || \result === 1
  //@ ensures \result === 0 <==> forall(k: nat, i <= k && k < a.length ==> a[k] === b[k])
  //@ decreases a.length - i
  if (i >= a.length) return 0;
  if (a[i]! !== b[i]!) return compareInts(a[i]!, b[i]!);
  return compareFrom(a, b, i + 1);
}

/** Two lists of Persons: the shorter first, then Person by Person. Indexes follow the ids by code units. */
export function comparePersons(a: readonly number[], b: readonly number[]): number {
  //@ verify
  //@ ensures \result === -1 || \result === 0 || \result === 1
  //@ ensures \result === 0 <==> a === b
  if (a.length !== b.length) return compareInts(a.length, b.length);
  return compareFrom(a, b, 0);
}

/** Kinship by birth before kinship by marriage at the same degree. */
export function marriageRank(kind: number): number {
  //@ verify
  return kind === MARRIAGE ? 1 : 0;
}

/**
 * The fixed order of paths (kinship spec, "Paths in a fixed order"): the reader, then partners;
 * then by degree, lowest first, kinship by birth before kinship by marriage at the same degree;
 * then confirmed before possible; then the kinds with no degree; then by the generations up from the
 * reader and down to the Person; then by the Persons along the path, the shorter first. Names
 * never decide. Negative when `a` comes first.
 */
export function compareKinshipPaths(a: PathKey, b: PathKey): number {
  //@ verify
  //@ contract kinship: Paths in a fixed order
  //@ ensures \result === -1 || \result === 0 || \result === 1
  // Antisymmetric, and 0 only for the same path ("Equal paths": the Persons decide every tie).
  //@ ensures compareKinshipPaths(b, a) === -\result
  //@ ensures \result === 0 ==> kindRank(a.kind) === kindRank(b.kind) && a.possible === b.possible && a.up === b.up && a.down === b.down && a.persons === b.persons
  // The reader and partners first, then a lower degree ("Brother-in-law and cousin": the 2nd degree before the 8th).
  //@ ensures kindRank(a.kind) < kindRank(b.kind) ==> \result === -1
  //@ ensures hasDegree(a.kind) && hasDegree(b.kind) && a.degree < b.degree ==> \result === -1
  //@ ensures hasDegree(a.kind) && hasDegree(b.kind) && a.degree === b.degree && a.kind === BIRTH && b.kind === MARRIAGE ==> \result === -1
  //@ ensures kindRank(a.kind) === kindRank(b.kind) && (!hasDegree(a.kind) || (a.degree === b.degree && marriageRank(a.kind) === marriageRank(b.kind))) && !a.possible && b.possible ==> \result === -1
  const rank = compareInts(kindRank(a.kind), kindRank(b.kind));
  if (rank !== 0) return rank;
  if (hasDegree(a.kind)) {
    const degree = compareInts(a.degree, b.degree);
    if (degree !== 0) return degree;
    const marriage = compareInts(marriageRank(a.kind), marriageRank(b.kind));
    if (marriage !== 0) return marriage;
  }
  if (a.possible !== b.possible) return a.possible ? 1 : -1;
  const up = compareInts(a.up, b.up);
  if (up !== 0) return up;
  const down = compareInts(a.down, b.down);
  if (down !== 0) return down;
  return comparePersons(a.persons, b.persons);
}

// ---------------------------------------------------------------- evidence

/**
 * A path is possible when one of its links, the partner step of kinship by marriage included, has
 * no Citation of normal or higher confidence: the rule of the Possible relative ({@link isStrongLink}),
 * applied to one path.
 */
export function isPossiblePath(links: readonly FamilyLink[]): boolean {
  //@ verify
  //@ contract kinship: Kinship follows the evidence
  // "Weak father link": a link that is not strong (its Citations all below normal confidence, or none) makes the
  // path possible; the lemma WeakLinkMakesPossible in kinship.dfy says so in those words.
  //@ ensures \result === exists(i: nat, i < links.length && !isStrongLink(links[i]))
  // "Evidence improves": a Citation of normal or higher confidence on every link, and the path is confirmed.
  //@ ensures forall(i: nat, i < links.length ==> exists(j: nat, j < links[i].confidences.length && (links[i].confidences[j] === 'normal' || links[i].confidences[j] === 'high' || links[i].confidences[j] === 'very_high'))) ==> !\result
  return links.some((l) => !isStrongLink(l));
}

// ---------------------------------------------------------------- half, step, adoptive and foster

/**
 * Half kinship: the two chains reach their one common ancestor through children of two different
 * couples. The couple of a Family is the same for every Family of the same two partners, so one
 * couple recorded as two Families counts once.
 */
export function isHalf(up: number, down: number, fromCouple: number, toCouple: number): boolean {
  //@ verify
  //@ contract kinship: Half, step, adoptive and foster kinship
  //@ ensures \result <==> up >= 1 && down >= 1 && fromCouple !== toCouple
  // "Half-brother": the father's child with his second wife; the direct line is never half.
  //@ ensures up === 1 && down === 1 && fromCouple !== toCouple ==> \result
  //@ ensures up === 0 || down === 0 ==> !\result
  return up >= 1 && down >= 1 && fromCouple !== toCouple;
}

/** Whether a partner step at `k` sits next to a step up or down through the same couple. */
export function besideOwnCouple(steps: readonly PathStep[], k: number): boolean {
  //@ verify
  //@ requires 0 <= k && k < steps.length
  //@ ensures steps[k].dir !== ACROSS ==> !\result
  // "Own child, not a stepchild": across to the partner, then down through their own couple.
  //@ ensures k === 0 && steps.length >= 2 && steps[0].dir === ACROSS && steps[1].dir === DOWN && steps[0].couple === steps[1].couple ==> \result
  // "Stepmother": up to the father through the reader's own couple, across to his second wife through another.
  //@ ensures steps.length === 2 && steps[0].dir === UP && steps[1].dir === ACROSS && steps[0].couple !== steps[1].couple ==> !\result
  if (steps[k]!.dir !== ACROSS) return false;
  const c = steps[k]!.couple;
  if (k + 1 < steps.length && steps[k + 1]!.dir !== ACROSS && steps[k + 1]!.couple === c) return true;
  return k > 0 && steps[k - 1]!.dir !== ACROSS && steps[k - 1]!.couple === c;
}

/**
 * Whether a path by marriage would name the reader's own parent or child as a step-parent or a
 * stepchild: a partner step next to a step up or down through a child of the same couple ("Own
 * child, not a stepchild"). Such paths are dropped; the path by birth names them.
 */
export function namesOwnParentOrChild(steps: readonly PathStep[]): boolean {
  //@ verify
  //@ contract kinship: Half, step, adoptive and foster kinship
  //@ ensures \result <==> !forall(k: nat, k < steps.length ==> !besideOwnCouple(steps, k))
  let i = 0;
  while (i < steps.length) {
    //@ invariant 0 <= i && i <= steps.length
    //@ invariant forall(k: nat, k < i ==> !besideOwnCouple(steps, k))
    //@ decreases steps.length - i
    if (besideOwnCouple(steps, i)) return true;
    i = i + 1;
  }
  return false;
}

// ---------------------------------------------------------------- connection

/** Whether link `i` joins `u` and `w`, in either direction. */
export function joins(links: readonly FamilyLink[], i: number, u: number, w: number): boolean {
  //@ verify
  //@ requires 0 <= i && i < links.length
  return (links[i]!.a === u && links[i]!.b === w) || (links[i]!.a === w && links[i]!.b === u);
}

/** Whether step `k` of a chain joins its Person `k` and Person `k + 1` through a Family link. */
export function joinsAt(links: readonly FamilyLink[], used: readonly number[], persons: readonly number[], k: number): boolean {
  //@ verify
  //@ requires 0 <= k && k < used.length && used.length < persons.length
  const i = used[k]!;
  if (i < 0 || i >= links.length) return false;
  return joins(links, i, persons[k]!, persons[k + 1]!);
}

/** Whether a Person a search reached came there through a link from a Person one step nearer its start. */
export function isStepNearer(dist: readonly number[], via: readonly number[], links: readonly FamilyLink[], v: number): boolean {
  //@ verify
  //@ requires 0 <= v && v < dist.length && dist.length === via.length
  //@ requires forall(i: nat, i < links.length ==> 0 <= links[i].a && links[i].a < dist.length && 0 <= links[i].b && links[i].b < dist.length)
  const i = via[v]!;
  if (i < 0 || i >= links.length) return false;
  const l = links[i]!;
  if (l.a === v) return dist[l.b]! === dist[v]! - 1;
  return l.b === v && dist[l.a]! === dist[v]! - 1;
}

/**
 * With no kinship, the shortest chain of any Family links (parent, child or partner, of any link
 * type, in either direction) from `from` to `to`, and who a search from `to` reached. When there
 * is none, that reach is closed under every link and leaves `from` out: no chain exists.
 */
export function connectionChain(count: number, from: number, to: number, links: readonly FamilyLink[]): Connection {
  //@ verify
  //@ contract kinship: Limits of the kinship search
  //@ requires 0 <= from && from < count && 0 <= to && to < count
  //@ requires forall(i: nat, i < links.length ==> 0 <= links[i].a && links[i].a < count && 0 <= links[i].b && links[i].b < count)
  //@ ensures \result.reached.length === count && \result.reached[to]
  //@ ensures \result.found <==> \result.reached[from]
  // "Through two marriages": a chain of real Family links from the reader to the Person.
  //@ ensures \result.found ==> \result.persons.length === \result.links.length + 1 && \result.persons[0] === from && \result.persons[\result.links.length] === to
  //@ ensures \result.found ==> forall(k: nat, k < \result.persons.length ==> 0 <= \result.persons[k] && \result.persons[k] < count)
  //@ ensures \result.found ==> forall(k: nat, k < \result.links.length ==> joinsAt(links, \result.links, \result.persons, k))
  // "No chain": nothing is listed, and the reach is closed under every link, so no chain leads from the reader to the Person.
  //@ ensures !\result.found ==> \result.persons.length === 0 && \result.links.length === 0
  //@ ensures forall(i: nat, i < links.length ==> (\result.reached[links[i].a] <==> \result.reached[links[i].b]))
  const dist: number[] = [];
  const via: number[] = [];
  let v = 0;
  while (v < count) {
    //@ invariant 0 <= v && v <= count && dist.length === v && via.length === v
    //@ invariant forall(u: nat, u < v ==> via[u] === -1 && (u === to ==> dist[u] === 0) && (u !== to ==> dist[u] === -1))
    //@ decreases count - v
    dist.push(v === to ? 0 : -1);
    via.push(-1);
    v = v + 1;
  }
  let d = 0;
  let grew = true;
  while (grew) {
    //@ invariant d >= 0 && dist.length === count && via.length === count && dist[to] === 0
    //@ invariant forall(u: nat, u < count ==> -1 <= dist[u] && dist[u] <= d)
    //@ invariant forall(u: nat, u < count && dist[u] === 0 ==> u === to)
    //@ invariant forall(u: nat, u < count && dist[u] > 0 ==> isStepNearer(dist, via, links, u))
    //@ invariant forall(j: nat, j < links.length && 0 <= dist[links[j].a] && dist[links[j].a] < d ==> dist[links[j].b] >= 0)
    //@ invariant forall(j: nat, j < links.length && 0 <= dist[links[j].b] && dist[links[j].b] < d ==> dist[links[j].a] >= 0)
    //@ invariant !grew ==> forall(u: nat, u < count ==> dist[u] < d)
    grew = false;
    let i = 0;
    while (i < links.length) {
      //@ invariant 0 <= i && i <= links.length && dist.length === count && via.length === count && dist[to] === 0
      //@ invariant forall(u: nat, u < count ==> -1 <= dist[u] && dist[u] <= d + 1)
      //@ invariant forall(u: nat, u < count && dist[u] === 0 ==> u === to)
      //@ invariant forall(u: nat, u < count && dist[u] > 0 ==> isStepNearer(dist, via, links, u))
      //@ invariant forall(j: nat, j < links.length && 0 <= dist[links[j].a] && dist[links[j].a] < d ==> dist[links[j].b] >= 0)
      //@ invariant forall(j: nat, j < links.length && 0 <= dist[links[j].b] && dist[links[j].b] < d ==> dist[links[j].a] >= 0)
      //@ invariant forall(j: nat, j < i && dist[links[j].a] === d ==> dist[links[j].b] >= 0)
      //@ invariant forall(j: nat, j < i && dist[links[j].b] === d ==> dist[links[j].a] >= 0)
      //@ invariant !grew ==> forall(u: nat, u < count ==> dist[u] <= d)
      //@ decreases links.length - i
      const l = links[i]!;
      if (dist[l.a]! === d && dist[l.b]! === -1) {
        dist[l.b] = d + 1;
        via[l.b] = i;
        grew = true;
      } else if (dist[l.b]! === d && dist[l.a]! === -1) {
        dist[l.a] = d + 1;
        via[l.a] = i;
        grew = true;
      }
      i = i + 1;
    }
    d = d + 1;
  }
  const reached: boolean[] = [];
  let u = 0;
  while (u < count) {
    //@ invariant 0 <= u && u <= count && reached.length === u
    //@ invariant forall(x: nat, x < u ==> (reached[x] <==> dist[x] >= 0))
    //@ decreases count - u
    reached.push(dist[u]! >= 0);
    u = u + 1;
  }
  if (dist[from]! < 0) return { found: false, persons: [], links: [], reached };
  // From the reader to the Person, one step nearer each time.
  const persons: number[] = [from];
  const used: number[] = [];
  let w = from;
  while (dist[w]! > 0) {
    //@ invariant 0 <= w && w < count && dist[w] >= 0
    //@ invariant persons.length === dist[from] - dist[w] + 1 && used.length === persons.length - 1
    //@ invariant persons[0] === from && persons[persons.length - 1] === w
    //@ invariant forall(k: nat, k < persons.length ==> 0 <= persons[k] && persons[k] < count)
    //@ invariant forall(k: nat, k < used.length ==> joinsAt(links, used, persons, k))
    //@ decreases dist[w]
    const i = via[w]!;
    const l = links[i]!;
    const next = l.a === w ? l.b : l.a;
    used.push(i);
    persons.push(next);
    w = next;
  }
  return { found: true, persons, links: used, reached };
}
