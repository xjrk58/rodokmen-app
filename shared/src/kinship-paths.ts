/**
 * Every path of kinship between two Persons (kinship design, "Finding the paths"): the unverified
 * shell around the proved rules of kinship.ts. It lists the paths by birth and by marriage
 * generation by generation, the closest first, adds the named shapes with a partner in the middle
 * and the step and foster pairs, orders them with {@link compareKinshipPaths} and keeps 100.
 *
 * The work is bounded: each step of a chain built and each pair of chains compared counts one
 * unit. A search stops at its bound once the closest degree is listed, and the closest path by
 * birth ({@link closestPath}) is never cut. That `kinshipPaths` finds every path within the limits
 * is not proved; shared/test/kinship-paths.test.ts compares it with a naive search.
 */
import {
  ACROSS,
  ADOPTIVE_LINK,
  BIRTH,
  DOWN,
  MARRIAGE,
  MAX_GENERATIONS,
  SELF,
  UP,
  closestPath,
  compareKinshipPaths,
  isHalf,
  isPossiblePath,
  namesOwnParentOrChild,
} from './kinship.js';
import { ChainSet, chainOf, onChain, otherPartner, type ChainNode, type KinshipGraph } from './kinship-graph.js';
import { SHAPE_BIRTH, SHAPE_KIN_PARTNER, SHAPE_PARTNER_KIN, SHAPE_SELF } from './kinship-terms/shapes.js';
import { connectionOf, coupleOf, finish, otherPaths, pathOut, stepLink, type KinshipPathOut, type KinshipResult, type Path, type Step } from './kinship-steps.js';

/** At most this many paths are listed (kinship spec, "Limits of the kinship search"). */
export const MAX_PATHS = 100;
/** The units a full answer may cost, and one target of a list. */
export const FULL_BOUND = 200_000;
export const SHORT_BOUND = 5_000;
const MAX_DEGREE = 2 * MAX_GENERATIONS;

/** The search for one reader, kept across the targets of a list: the chains up from the reader and the reader's partners. */
export class KinshipSearch {
  private readonly sets = new Map<number, ChainSet>();
  constructor(
    readonly g: KinshipGraph,
    readonly from: number,
  ) {}

  chains(v: number): ChainSet {
    let set = this.sets.get(v);
    if (!set) this.sets.set(v, (set = new ChainSet(this.g, v)));
    return set;
  }
}

// ---------------------------------------------------------------- building paths

/** A path by birth from the reader's chain `a` and the Person's chain `b`, both up to the same top. */
interface BirthPair {
  up: number;
  down: number;
  persons: number[];
  steps: Step[];
  top: number;
  /** The couples the two chains enter the top through (-1 for the direct line). */
  coupleA: number;
  coupleB: number;
  adoptive: boolean;
}

type Chain = { persons: number[]; links: number[] };

function birthPair(g: KinshipGraph, ca: Chain, cb: Chain): BirthPair {
  const steps: Step[] = [];
  for (let k = ca.links.length - 1; k >= 0; k--) steps.push({ dir: UP, to: ca.persons[k]!, parentLink: ca.links[k]!, family: g.parentLinks[ca.links[k]!]!.family });
  for (let k = 0; k < cb.links.length; k++) steps.push({ dir: DOWN, to: cb.persons[k + 1]!, parentLink: cb.links[k]!, family: g.parentLinks[cb.links[k]!]!.family });
  const couple = (links: number[]) => (links.length > 0 ? g.parentLinks[links[0]!]!.couple : -1);
  return {
    up: ca.links.length,
    down: cb.links.length,
    persons: [...ca.persons].reverse().concat(cb.persons.slice(1)),
    steps,
    top: ca.persons[0]!,
    coupleA: couple(ca.links),
    coupleB: couple(cb.links),
    adoptive: steps.some((s) => g.parentLinks[s.parentLink]!.type === ADOPTIVE_LINK),
  };
}

/** Where a search keeps its count: the units of the pairs compared so far, and how many it may compare. */
interface Budget {
  units: number;
  stopAt: number;
  mark: Int32Array;
  stamp: number;
}

/**
 * The pairs of chains from `A` and `B` of `degree` generations together that meet only at their
 * top; through both partners of one couple they are one path. False when the budget ran out first.
 */
function birthPairsAt(g: KinshipGraph, A: ChainSet, B: ChainSet, degree: number, budget: Budget, groups: Map<string, BirthPair[]>, exclude: number): boolean {
  const [small, large] = A.byTop.size <= B.byTop.size ? [A, B] : [B, A];
  for (const top of small.byTop.keys()) {
    const aByLen = A.byTop.get(top);
    const bByLen = B.byTop.get(top);
    if (!aByLen || !bByLen || !large.byTop.has(top)) continue;
    for (let up = Math.max(0, degree - MAX_GENERATIONS); up <= Math.min(degree, MAX_GENERATIONS); up++) {
      for (const a of aByLen[up] ?? []) {
        if (budget.units > budget.stopAt) return false;
        if (exclude < 0 || !onChain(a, exclude)) pairWith(g, a, bByLen[degree - up] ?? [], groups, budget, exclude);
      }
    }
  }
  return true;
}

/** Pairs chain `a` with each chain of `bs` that meets it only at the top, grouped as one path per couple. */
function pairWith(g: KinshipGraph, a: ChainNode, bs: readonly ChainNode[], groups: Map<string, BirthPair[]>, budget: Budget, exclude: number): void {
  const n = ++budget.stamp;
  for (let x = a.prev; x; x = x.prev) budget.mark[x.top] = n;
  budget.units += bs.length;
  const ca = chainOf(a);
  for (const b of bs) {
    if (meets(b, budget.mark, n) || (exclude >= 0 && onChain(b, exclude))) continue;
    const pair = birthPair(g, ca, chainOf(b));
    const full = pair.coupleA >= 0 && pair.coupleA === pair.coupleB;
    // Through both partners of a couple one path; otherwise each pair of chains is its own, links and all.
    const key = full ? `${pair.coupleA}|${pair.persons.filter((v) => v !== a.top).join(',')}` : `top:${a.top}|${pair.steps.map((s) => s.parentLink).join(',')}`;
    const group = groups.get(key) ?? [];
    group.push(pair);
    groups.set(key, group);
  }
}

/** Whether chain `b` below its top holds a marked Person. */
function meets(b: ChainNode, mark: Int32Array, n: number): boolean {
  for (let x = b.prev; x; x = x.prev) if (mark[x.top] === n) return true;
  return false;
}

/** One path by birth from a group of pairs: the confirmed one shown, both partners of the couple as common ancestors. */
function birthPath(g: KinshipGraph, group: BirthPair[]): Omit<Path, 'possible' | 'key'> {
  const variants = group
    .map((p) => ({ p, possible: isPossiblePath(p.steps.map((s) => stepLink(g, s))) }))
    .sort((x, y) => (x.possible === y.possible ? x.p.top - y.p.top : x.possible ? 1 : -1));
  const shown = variants[0]!.p;
  return {
    kind: BIRTH,
    shape: SHAPE_BIRTH,
    up: shown.up,
    down: shown.down,
    half: isHalf(shown.up, shown.down, shown.coupleA, shown.coupleB),
    adoptive: shown.adoptive,
    married: false,
    persons: shown.persons,
    steps: shown.steps,
    ancestors: [...new Set(group.map((p) => p.top))].sort((x, y) => x - y),
  };
}

// ---------------------------------------------------------------- the paths

type Draft = Omit<Path, 'possible' | 'key'>;

/** The kin of the reader's partner `P` (Family `f`): across to the partner, then by birth. */
function partnerKin(g: KinshipGraph, from: number, P: number, f: number) {
  return (b: Draft): Draft | null => {
    if (b.persons.includes(from)) return null;
    const steps: Step[] = [{ dir: ACROSS, to: P, parentLink: -1, family: f }, ...b.steps];
    if (namesOwnParentOrChild(steps.map((x) => ({ dir: x.dir, couple: coupleOf(g, x) })))) return null;
    return { ...b, kind: MARRIAGE, shape: SHAPE_PARTNER_KIN, persons: [from, ...b.persons], steps };
  };
}

/** The partner `to` (Family `f`) of the reader's kin: by birth, then across to the partner. */
function kinPartner(g: KinshipGraph, to: number, f: number) {
  return (b: Draft): Draft | null => {
    if (b.persons.includes(to)) return null;
    const steps: Step[] = [...b.steps, { dir: ACROSS, to, parentLink: -1, family: f }];
    if (namesOwnParentOrChild(steps.map((x) => ({ dir: x.dir, couple: coupleOf(g, x) })))) return null;
    return { ...b, kind: MARRIAGE, shape: SHAPE_KIN_PARTNER, persons: [...b.persons, to], steps };
  };
}

/** Each start of a search with what makes its paths: the reader to the Person by birth, and through each partner of either. */
function searches(s: KinshipSearch, to: number): Array<{ a: number; b: number; exclude: number; wrap: (d: Draft) => Draft | null }> {
  const g = s.g;
  const from = s.from;
  const out = [{ a: from, b: to, exclude: -1, wrap: (d: Draft): Draft | null => d }];
  for (const f of g.familiesOf[from]!) {
    const P = otherPartner(g.families[f]!, from);
    if (P >= 0 && P !== to) out.push({ a: P, b: to, exclude: from, wrap: partnerKin(g, from, P, f) });
  }
  for (const f of g.familiesOf[to]!) {
    const Q = otherPartner(g.families[f]!, to);
    if (Q >= 0 && Q !== from) out.push({ a: from, b: Q, exclude: to, wrap: kinPartner(g, to, f) });
  }
  return out;
}

/** Paths by birth and by marriage of one degree; false when the budget ran out before the degree was listed. */
function pathsAt(s: KinshipSearch, to: number, degree: number, out: Path[], budget: Budget): boolean {
  const g = s.g;
  for (const { a, b, exclude, wrap } of searches(s, to)) {
    const A = s.chains(a);
    const B = s.chains(b);
    A.ensure(degree);
    B.ensure(degree);
    const groups = new Map<string, BirthPair[]>();
    const complete = birthPairsAt(g, A, B, degree, budget, groups, exclude);
    for (const group of groups.values()) {
      const p = wrap(birthPath(g, group));
      if (p) out.push(finish(g, p));
    }
    if (!complete) return false;
  }
  return true;
}

// ---------------------------------------------------------------- the search

/** The closest paths by birth (proved, closestPath), from the reader and the reader's partners to the Person and the Person's partners: never cut. */
function closestPaths(s: KinshipSearch, to: number): Path[] {
  const g = s.g;
  const out: Path[] = [];
  for (const { a, b, wrap } of searches(s, to)) {
    const c = closestPath(g.ids.length, a, b, g.parentLinks);
    if (!c.found || c.toFrom.links.length + c.toTo.links.length === 0) continue;
    const p = wrap(birthPath(g, [birthPair(g, c.toFrom, c.toTo)]));
    if (p) out.push(finish(g, p));
  }
  return out;
}

/** The units of the chains a search built up to `len` generations: the same however many targets shared them. */
function chainUnits(s: KinshipSearch, to: number, len: number): number {
  const g = s.g;
  const starts = new Set([s.from, to]);
  for (const f of g.familiesOf[s.from]!) starts.add(otherPartner(g.families[f]!, s.from));
  for (const f of g.familiesOf[to]!) starts.add(otherPartner(g.families[f]!, to));
  let units = 0;
  for (const v of starts) if (v >= 0) units += s.chains(v).unitsUpTo(len);
  return units;
}

/**
 * Every path between the reader and the Person `to`, in order, the closest first, at most
 * {@link MAX_PATHS}. Degree by degree, the paths of the closest degree are always listed; after
 * that the search stops once its units pass `bound` and says there may be more.
 */
export function kinshipPaths(s: KinshipSearch, to: number, bound = FULL_BOUND): KinshipResult {
  const g = s.g;
  const from = s.from;
  if (from === to) {
    const self = finish(g, { kind: SELF, shape: SHAPE_SELF, up: 0, down: 0, half: false, adoptive: false, married: false, persons: [from], steps: [], ancestors: [] });
    return { paths: [pathOut(g, to, self)], more: false, connection: null, units: 0 };
  }
  const closest = closestPaths(s, to);
  const first = Math.min(...closest.map((p) => p.up + p.down));
  const found: Path[] = [];
  const budget: Budget = { units: 0, stopAt: 0, mark: new Int32Array(g.ids.length), stamp: 0 };
  let more = false;
  let listedFirst = false;
  let chains = 0;
  // With no closest path there is no path by birth or marriage at all.
  for (let d = 1; d <= MAX_DEGREE && closest.length > 0; d++) {
    // Up to the closest degree, only the hard bound of a full answer stops the search.
    const limit = d > first ? bound : FULL_BOUND;
    chains = chainUnits(s, to, d);
    budget.stopAt = limit - chains;
    const complete = pathsAt(s, to, d, found, budget);
    if (d === first && complete) listedFirst = true;
    // Paths come by degree first, so once a whole degree is listed with 100 paths up to it, no later one is shown.
    if (!complete || (d < MAX_DEGREE && (budget.units + chains > limit || (complete && d >= first && distinct(found) >= MAX_PATHS)))) {
      more = true;
      break;
    }
  }
  // The closest paths are never cut: if the search stopped before it listed their degree, they are added as they are.
  // Paths through the same Persons are one path (a Family recorded twice gives the same Persons through other
  // links): the one kept is confirmed if any is, then through both partners of a couple if any is.
  const byPersons = new Map<string, Path>();
  for (const p of [...found, ...(listedFirst ? [] : closest), ...otherPaths(g, from, to)]) {
    const key = `${p.kind}|${p.persons.join(',')}`;
    const kept = byPersons.get(key);
    if (!kept || betterOf(p, kept)) byPersons.set(key, p);
  }
  const paths = [...byPersons.values()].sort((a, b) => compareKinshipPaths(a.key, b.key));
  if (paths.length > MAX_PATHS) more = true;
  return {
    paths: paths.slice(0, MAX_PATHS).map((p) => pathOut(g, to, p)),
    more,
    connection: paths.length === 0 ? connectionOf(g, from, to) : null,
    units: budget.units + chains,
  };
}

/** How many paths through different Persons a list holds. */
function distinct(paths: readonly Path[]): number {
  return new Set(paths.map((p) => `${p.kind}|${p.persons.join(',')}`)).size;
}

/** Of two paths through the same Persons, whether `a` says more: confirmed, then both partners of a couple, then full. */
function betterOf(a: Path, b: Path): boolean {
  if (a.possible !== b.possible) return !a.possible;
  if (a.ancestors.length !== b.ancestors.length) return a.ancestors.length > b.ancestors.length;
  return !a.half && b.half;
}

/** The short form of a list: the first path, how many others, and whether there may be more; null with no kinship. */
export function kinshipShort(s: KinshipSearch, to: number): { first: KinshipPathOut; others: number; more: boolean; units: number } | null {
  const r = kinshipPaths(s, to, SHORT_BOUND);
  if (r.paths.length === 0) return null;
  return { first: r.paths[0]!, others: r.paths.length - 1, more: r.more, units: r.units };
}

