/**
 * The rules of a Descendant chart (tree-charts spec; GLOSSARY "Chart", "Descendant chart",
 * "Direct line"): the order of children and Families, who is in the Chart and at which
 * generation, the Direct line, the cut to 500 cards, and the "died young" mark.
 *
 * Each rule is a pure function on indices and integers, proved with LemmaScript (ADR 0009,
 * docs/verification.md). Ids are compared by code units (`<`), never with `localeCompare`, and
 * names never decide an order, so a Chart is the same on every device. The shell that gathers
 * the rows, turns dates into days and builds the Chart model (shared/src/charts-model.ts) is not
 * proved; the tests cover it.
 */

// ---------------------------------------------------------------- order (tree-charts, "Order within a Chart")

/**
 * A child's place among the children of a Family: the earliest day their birth or baptism could
 * be (`day`, an integer `yyyymmdd`, 0 when the date is open towards the past), whether there is
 * such a date at all, the order the Family records them in, and the Person's id.
 */
export interface ChildKey {
  readonly dated: boolean;
  readonly day: number;
  readonly recorded: number;
  readonly id: string;
}

/** A Family's place among a Person's Families: the earliest day of the marriage, and the Family's id. */
export interface FamilyKey {
  readonly dated: boolean;
  readonly day: number;
  readonly id: string;
}

/**
 * The order of children (tree-charts spec, "Order within a Chart"): by the earliest day their
 * birth or baptism could be, the undated after the dated, then by the order the Family records
 * them in, then by id. A total order: 0 only for the same id.
 */
export function compareChildren(a: ChildKey, b: ChildKey): number {
  //@ verify
  //@ contract tree-charts: Order within a Chart
  //@ ensures \result === -compareChildren(b, a)
  //@ ensures -1 <= \result && \result <= 1
  //@ ensures \result === 0 ==> a.id === b.id
  // Scenario "Undated child": the undated come after the dated.
  //@ ensures a.dated && !b.dated ==> \result === -1
  // Scenario "A range of years": `1803/1805` (from 1 January 1803) before 1 June 1804.
  //@ ensures a.dated && b.dated && a.day < b.day ==> \result === -1
  // Scenario "Twins": born on the same day, in the order the Family records them.
  //@ ensures a.dated === b.dated && (!a.dated || a.day === b.day) && a.recorded < b.recorded ==> \result === -1
  if (a.dated !== b.dated) return a.dated ? -1 : 1;
  if (a.dated && a.day !== b.day) return a.day < b.day ? -1 : 1;
  if (a.recorded !== b.recorded) return a.recorded < b.recorded ? -1 : 1;
  return a.id < b.id ? -1 : b.id < a.id ? 1 : 0;
}

/**
 * The order of a Person's Families (tree-charts spec, "Order within a Chart"): by the earliest
 * day of the marriage, the undated after the dated, then by the Family's id.
 */
export function compareFamilies(a: FamilyKey, b: FamilyKey): number {
  //@ verify
  //@ contract tree-charts: Order within a Chart
  //@ ensures \result === -compareFamilies(b, a)
  //@ ensures -1 <= \result && \result <= 1
  //@ ensures \result === 0 ==> a.id === b.id
  //@ ensures a.dated && !b.dated ==> \result === -1
  // Scenario "Second marriage": the earlier marriage first.
  //@ ensures a.dated && b.dated && a.day < b.day ==> \result === -1
  if (a.dated !== b.dated) return a.dated ? -1 : 1;
  if (a.dated && a.day !== b.day) return a.day < b.day ? -1 : 1;
  return a.id < b.id ? -1 : b.id < a.id ? 1 : 0;
}

// ---------------------------------------------------------------- died young (tree-charts, "Marks on cards")

/** A calendar day as an integer `yyyymmdd`, so that days compare as integers. */
export function dayKey(year: number, month: number, day: number): number {
  //@ verify
  return year * 10000 + month * 100 + day;
}

/**
 * Whether the dates show for certain that a Person died before their 15th birthday: both the
 * earliest day of the birth and the latest day of the death are known, and that death day falls
 * before the day 15 years after that birth day. Born on 29 February, the 15th birthday is 1 March
 * when that year has no 29 February: no day falls between `yyyy0228` and `yyyy0229`.
 */
export function diedYoung(hasBirth: boolean, birthYear: number, birthMonth: number, birthDay: number, hasDeath: boolean, deathKey: number): boolean {
  //@ verify
  //@ contract tree-charts: Marks on cards
  //@ ensures \result === (hasBirth && hasDeath && deathKey < dayKey(birthYear + 15, birthMonth, birthDay))
  // Scenario "Died young": born 2 March 1830, died 10 May 1832.
  //@ ensures hasBirth && hasDeath && birthYear === 1830 && birthMonth === 3 && birthDay === 2 && deathKey === 18320510 ==> \result
  // Scenario "Not certain": born about 1830 (from 1828), died between 1840 and 1850 (until 31 December 1850).
  //@ ensures birthYear === 1828 && birthMonth === 1 && birthDay === 1 && deathKey === 18501231 ==> !\result
  // Without both dates there is no mark.
  //@ ensures !hasBirth || !hasDeath ==> !\result
  return hasBirth && hasDeath && deathKey < dayKey(birthYear + 15, birthMonth, birthDay);
}

// ---------------------------------------------------------------- selection (tree-charts, "Descendant chart")

/**
 * One child link of a Family, by index: the Family, its two partners (-1 for none), the child,
 * and whether the link is followed to the child's own descendants (a birth or adoptive link; a
 * foster or step link is not).
 */
export interface ChildEdge {
  readonly family: number;
  readonly a: number;
  readonly b: number;
  readonly child: number;
  readonly followed: boolean;
}

/**
 * Who a Descendant chart holds: each Person's generation (0 for none, 1 for the start, else the
 * smallest number of followed links from the start plus 1), and for everyone else selected, the
 * link they were reached through (`via`) and the partner of its Family one generation up
 * (`parent`), both -1 otherwise.
 */
export interface Selection {
  readonly gen: number[];
  readonly via: number[];
  readonly parent: number[];
}

/**
 * Whether the Chart goes on from partner `p` of Family `f` to its children: `p` is in the Chart
 * above the last generation, and, when the Chart starts at a Family (`startFamily`), a partner of
 * that Family goes on only through it, not through their other Families.
 */
export function goesOn(gen: readonly number[], isStart: readonly boolean[], startFamily: number, generations: number, f: number, p: number): boolean {
  //@ verify
  //@ requires gen.length === isStart.length
  return p >= 0 && p < gen.length && gen[p]! >= 1 && gen[p]! < generations && (startFamily < 0 || f === startFamily || !isStart[p]!);
}

/**
 * Whether a selected Person who is no start was reached through a followed link from a Person one generation up.
 * @public Only the proofs use it (docs/verification.md), which knip cannot see.
 */
export function isReached(
  s: Selection,
  edges: readonly ChildEdge[],
  isStart: readonly boolean[],
  startFamily: number,
  generations: number,
  v: number,
): boolean {
  //@ verify
  //@ requires 0 <= v && v < s.gen.length && s.gen.length === s.via.length && s.gen.length === s.parent.length && s.gen.length === isStart.length
  const i = s.via[v]!;
  if (i < 0 || i >= edges.length) return false;
  const e = edges[i]!;
  const p = s.parent[v]!;
  return (
    e.followed && e.child === v && (p === e.a || p === e.b) && goesOn(s.gen, isStart, startFamily, generations, e.family, p) && s.gen[p]! + 1 === s.gen[v]!
  );
}

/**
 * Who a Descendant chart of `generations` generations holds (tree-charts spec, "Descendant
 * chart"), generation by generation: the start (`isStart`: a Person, or both partners of the
 * start Family `startFamily`), then everyone reached through followed links. Someone reached in
 * two ways is selected once, at the smaller generation.
 */
export function selectDescendants(
  count: number,
  isStart: readonly boolean[],
  startFamily: number,
  edges: readonly ChildEdge[],
  generations: number,
): Selection {
  //@ verify
  //@ contract tree-charts: Descendant chart
  //@ requires isStart.length === count && generations >= 1
  //@ requires forall(i: nat, i < edges.length ==> 0 <= edges[i].child && edges[i].child < count && -1 <= edges[i].a && edges[i].a < count && -1 <= edges[i].b && edges[i].b < count)
  //@ ensures \result.gen.length === count && \result.via.length === count && \result.parent.length === count
  // The start is generation 1, and nobody else is; nobody is beyond the generations asked for.
  //@ ensures forall(v: nat, v < count ==> (\result.gen[v] === 1) === isStart[v])
  //@ ensures forall(v: nat, v < count ==> 0 <= \result.gen[v] && \result.gen[v] <= generations)
  // Closed: a followed link from a partner the Chart goes on from leads to a Person in the Chart, at most one generation further.
  //@ ensures forall(i: nat, i < edges.length && edges[i].followed && goesOn(\result.gen, isStart, startFamily, generations, edges[i].family, edges[i].a) ==> \result.gen[edges[i].child] >= 1 && \result.gen[edges[i].child] <= \result.gen[edges[i].a] + 1)
  //@ ensures forall(i: nat, i < edges.length && edges[i].followed && goesOn(\result.gen, isStart, startFamily, generations, edges[i].family, edges[i].b) ==> \result.gen[edges[i].child] >= 1 && \result.gen[edges[i].child] <= \result.gen[edges[i].b] + 1)
  // Sound: everyone else in the Chart came through a followed link (never a foster or step link) from a Person one generation up.
  //@ ensures forall(v: nat, v < count && \result.gen[v] >= 2 ==> isReached(\result, edges, isStart, startFamily, generations, v))
  const gen: number[] = [];
  const via: number[] = [];
  const parent: number[] = [];
  for (const start of isStart) {
    //@ invariant gen.length === _start_idx && via.length === _start_idx && parent.length === _start_idx
    //@ invariant forall(v: nat, v < _start_idx ==> gen[v] === (isStart[v] ? 1 : 0) && via[v] === -1 && parent[v] === -1)
    gen.push(start ? 1 : 0);
    via.push(-1);
    parent.push(-1);
  }
  let level = 1;
  while (level < generations) {
    //@ invariant 1 <= level && level <= generations
    //@ invariant gen.length === count && via.length === count && parent.length === count
    //@ invariant forall(v: nat, v < count ==> (gen[v] === 1) === isStart[v])
    //@ invariant forall(v: nat, v < count ==> 0 <= gen[v] && gen[v] <= level)
    //@ invariant forall(i: nat, i < edges.length && edges[i].followed && goesOn(gen, isStart, startFamily, generations, edges[i].family, edges[i].a) && gen[edges[i].a] < level ==> gen[edges[i].child] >= 1 && gen[edges[i].child] <= gen[edges[i].a] + 1)
    //@ invariant forall(i: nat, i < edges.length && edges[i].followed && goesOn(gen, isStart, startFamily, generations, edges[i].family, edges[i].b) && gen[edges[i].b] < level ==> gen[edges[i].child] >= 1 && gen[edges[i].child] <= gen[edges[i].b] + 1)
    //@ invariant forall(v: nat, v < count && gen[v] >= 2 ==> isReached({ gen: gen, via: via, parent: parent }, edges, isStart, startFamily, generations, v))
    //@ decreases generations - level
    let i = 0;
    while (i < edges.length) {
      //@ invariant 0 <= i && i <= edges.length
      //@ invariant gen.length === count && via.length === count && parent.length === count
      //@ invariant forall(v: nat, v < count ==> (gen[v] === 1) === isStart[v])
      //@ invariant forall(v: nat, v < count ==> 0 <= gen[v] && gen[v] <= level + 1)
      //@ invariant forall(j: nat, j < edges.length && edges[j].followed && goesOn(gen, isStart, startFamily, generations, edges[j].family, edges[j].a) && gen[edges[j].a] < level ==> gen[edges[j].child] >= 1 && gen[edges[j].child] <= gen[edges[j].a] + 1)
      //@ invariant forall(j: nat, j < edges.length && edges[j].followed && goesOn(gen, isStart, startFamily, generations, edges[j].family, edges[j].b) && gen[edges[j].b] < level ==> gen[edges[j].child] >= 1 && gen[edges[j].child] <= gen[edges[j].b] + 1)
      //@ invariant forall(j: nat, j < i && edges[j].followed && goesOn(gen, isStart, startFamily, generations, edges[j].family, edges[j].a) && gen[edges[j].a] === level ==> gen[edges[j].child] >= 1 && gen[edges[j].child] <= level + 1)
      //@ invariant forall(j: nat, j < i && edges[j].followed && goesOn(gen, isStart, startFamily, generations, edges[j].family, edges[j].b) && gen[edges[j].b] === level ==> gen[edges[j].child] >= 1 && gen[edges[j].child] <= level + 1)
      //@ invariant forall(v: nat, v < count && gen[v] >= 2 ==> isReached({ gen: gen, via: via, parent: parent }, edges, isStart, startFamily, generations, v))
      //@ decreases edges.length - i
      const e = edges[i]!;
      if (e.followed && gen[e.child]! === 0) {
        if (goesOn(gen, isStart, startFamily, generations, e.family, e.a) && gen[e.a]! === level) {
          gen[e.child] = level + 1;
          via[e.child] = i;
          parent[e.child] = e.a;
        } else if (goesOn(gen, isStart, startFamily, generations, e.family, e.b) && gen[e.b]! === level) {
          gen[e.child] = level + 1;
          via[e.child] = i;
          parent[e.child] = e.b;
        }
      }
      i = i + 1;
    }
    level = level + 1;
  }
  return { gen, via, parent };
}

// ---------------------------------------------------------------- the Direct line (tree-charts, "Direct line")

/**
 * The Direct line from the start down to its end: the Persons (`persons`, the start first) and
 * the links between them (`via`). `toEnd` holds each Person's smallest number of followed links
 * down to the end (-1: none within the line's length), and `down` the link that starts such a
 * shortest way (-1 for none).
 */
export interface Line {
  readonly persons: number[];
  readonly via: number[];
  readonly toEnd: number[];
  readonly down: number[];
}

/** Whether the line may leave `p` through Family `f`: from a start Family, only through it. */
export function mayLeave(start: number, startFamily: number, f: number, p: number): boolean {
  //@ verify
  return startFamily < 0 || p !== start || f === startFamily;
}

/** Whether link `j` goes down from `from` by a followed link of a Family the line may leave it through. */
export function leaves(edges: readonly ChildEdge[], start: number, startFamily: number, from: number, j: number): boolean {
  //@ verify
  //@ requires 0 <= j && j < edges.length
  const e = edges[j]!;
  return e.followed && (e.a === from || e.b === from) && mayLeave(start, startFamily, e.family, from);
}

/**
 * Whether link `j` may be the step after the `k`-th Person of a line of at most `maxGen`
 * Persons: it leaves `from`, and its child still reaches the end within the Persons left.
 */
export function stepFits(
  edges: readonly ChildEdge[],
  toEnd: readonly number[],
  start: number,
  startFamily: number,
  maxGen: number,
  k: number,
  from: number,
  j: number,
): boolean {
  //@ verify
  //@ requires 0 <= j && j < edges.length
  //@ requires forall(i: nat, i < edges.length ==> 0 <= edges[i].child && edges[i].child < toEnd.length)
  const c = edges[j]!.child;
  return leaves(edges, start, startFamily, from, j) && toEnd[c]! >= 0 && toEnd[c]! <= maxGen - 2 - k;
}

/**
 * The Direct line from `start` to `end` (tree-charts spec, "Direct line"): the chain of followed
 * links, at most `maxGen` Persons long, that comes first in the Chart's order. `edges` are in the
 * Chart's order (a Person's Families by marriage, each Family's children by birth), so at each
 * step the line takes the first link whose child still reaches the end in time. Empty when the
 * end does not descend from the start within `maxGen` generations.
 */
export function directLine(count: number, edges: readonly ChildEdge[], start: number, startFamily: number, end: number, maxGen: number): Line {
  //@ verify
  //@ contract tree-charts: Direct line
  //@ requires 0 <= start && start < count && 0 <= end && end < count && maxGen >= 1
  //@ requires forall(i: nat, i < edges.length ==> 0 <= edges[i].child && edges[i].child < count && -1 <= edges[i].a && edges[i].a < count && -1 <= edges[i].b && edges[i].b < count)
  //@ ensures \result.toEnd.length === count && \result.down.length === count
  // toEnd is the smallest number of followed links down to the end: 0 for the end alone ...
  //@ ensures \result.toEnd[end] === 0
  //@ ensures forall(v: nat, v < count ==> -1 <= \result.toEnd[v] && \result.toEnd[v] <= maxGen - 1 && (v !== end ==> \result.toEnd[v] !== 0))
  // ... closed: a Person with a link down to a child that reaches the end in time reaches it too, at most one link later ...
  //@ ensures forall(i: nat, i < edges.length && edges[i].followed && edges[i].a >= 0 && mayLeave(start, startFamily, edges[i].family, edges[i].a) && \result.toEnd[edges[i].child] >= 0 && \result.toEnd[edges[i].child] < maxGen - 1 ==> \result.toEnd[edges[i].a] >= 0 && \result.toEnd[edges[i].a] <= \result.toEnd[edges[i].child] + 1)
  //@ ensures forall(i: nat, i < edges.length && edges[i].followed && edges[i].b >= 0 && mayLeave(start, startFamily, edges[i].family, edges[i].b) && \result.toEnd[edges[i].child] >= 0 && \result.toEnd[edges[i].child] < maxGen - 1 ==> \result.toEnd[edges[i].b] >= 0 && \result.toEnd[edges[i].b] <= \result.toEnd[edges[i].child] + 1)
  // ... and sound: every other Person that reaches it has a link down to a child one link nearer.
  //@ ensures forall(v: nat, v < count && \result.toEnd[v] >= 1 ==> 0 <= \result.down[v] && \result.down[v] < edges.length && leaves(edges, start, startFamily, v, \result.down[v]) && \result.toEnd[edges[\result.down[v]].child] === \result.toEnd[v] - 1)
  // Scenario "Not a descendant": no line exactly when the end does not descend from the start within maxGen generations.
  //@ ensures (\result.persons.length === 0) === (\result.toEnd[start] < 0)
  // Scenario "Line to the Member": from the start down to the end, one link per generation ...
  //@ ensures \result.persons.length > 0 ==> \result.persons[0] === start && \result.persons[\result.persons.length - 1] === end && \result.via.length === \result.persons.length - 1 && \result.persons.length <= maxGen
  //@ ensures \result.persons.length === 0 ==> \result.via.length === 0
  //@ ensures forall(k: nat, k < \result.via.length ==> 0 <= \result.via[k] && \result.via[k] < edges.length)
  //@ ensures forall(k: nat, k < \result.via.length && 0 <= \result.via[k] && \result.via[k] < edges.length ==> edges[\result.via[k]].child === \result.persons[k + 1])
  //@ ensures forall(k: nat, k < \result.via.length && 0 <= \result.via[k] && \result.via[k] < edges.length ==> stepFits(edges, \result.toEnd, start, startFamily, maxGen, k, \result.persons[k], \result.via[k]))
  // ... and scenario "Two ways down": at each step, no earlier link in the Chart's order could still reach the end in time.
  //@ ensures forall(k: nat, k < \result.via.length ==> forall(j: nat, j < \result.via[k] && j < edges.length ==> !stepFits(edges, \result.toEnd, start, startFamily, maxGen, k, \result.persons[k], j)))
  const toEnd: number[] = [];
  const down: number[] = [];
  let v = 0;
  while (v < count) {
    //@ invariant 0 <= v && v <= count && toEnd.length === v && down.length === v
    //@ invariant forall(u: nat, u < v ==> toEnd[u] === (u === end ? 0 : -1) && down[u] === -1)
    //@ decreases count - v
    toEnd.push(v === end ? 0 : -1);
    down.push(-1);
    v = v + 1;
  }
  let d = 0;
  while (d < maxGen - 1) {
    //@ invariant 0 <= d && d <= maxGen - 1 && toEnd.length === count && down.length === count
    //@ invariant toEnd[end] === 0
    //@ invariant forall(u: nat, u < count ==> -1 <= toEnd[u] && toEnd[u] <= d && (u !== end ==> toEnd[u] !== 0))
    //@ invariant forall(i: nat, i < edges.length && edges[i].followed && edges[i].a >= 0 && mayLeave(start, startFamily, edges[i].family, edges[i].a) && toEnd[edges[i].child] >= 0 && toEnd[edges[i].child] < d ==> toEnd[edges[i].a] >= 0 && toEnd[edges[i].a] <= toEnd[edges[i].child] + 1)
    //@ invariant forall(i: nat, i < edges.length && edges[i].followed && edges[i].b >= 0 && mayLeave(start, startFamily, edges[i].family, edges[i].b) && toEnd[edges[i].child] >= 0 && toEnd[edges[i].child] < d ==> toEnd[edges[i].b] >= 0 && toEnd[edges[i].b] <= toEnd[edges[i].child] + 1)
    //@ invariant forall(u: nat, u < count && toEnd[u] >= 1 ==> 0 <= down[u] && down[u] < edges.length && leaves(edges, start, startFamily, u, down[u]) && toEnd[edges[down[u]].child] === toEnd[u] - 1)
    //@ decreases maxGen - 1 - d
    let i = 0;
    while (i < edges.length) {
      //@ invariant 0 <= i && i <= edges.length && toEnd.length === count && down.length === count
      //@ invariant toEnd[end] === 0
      //@ invariant forall(u: nat, u < count ==> -1 <= toEnd[u] && toEnd[u] <= d + 1 && (u !== end ==> toEnd[u] !== 0))
      //@ invariant forall(j: nat, j < edges.length && edges[j].followed && edges[j].a >= 0 && mayLeave(start, startFamily, edges[j].family, edges[j].a) && toEnd[edges[j].child] >= 0 && toEnd[edges[j].child] < d ==> toEnd[edges[j].a] >= 0 && toEnd[edges[j].a] <= toEnd[edges[j].child] + 1)
      //@ invariant forall(j: nat, j < edges.length && edges[j].followed && edges[j].b >= 0 && mayLeave(start, startFamily, edges[j].family, edges[j].b) && toEnd[edges[j].child] >= 0 && toEnd[edges[j].child] < d ==> toEnd[edges[j].b] >= 0 && toEnd[edges[j].b] <= toEnd[edges[j].child] + 1)
      //@ invariant forall(j: nat, j < i && edges[j].followed && edges[j].a >= 0 && mayLeave(start, startFamily, edges[j].family, edges[j].a) && toEnd[edges[j].child] === d ==> toEnd[edges[j].a] >= 0 && toEnd[edges[j].a] <= d + 1)
      //@ invariant forall(j: nat, j < i && edges[j].followed && edges[j].b >= 0 && mayLeave(start, startFamily, edges[j].family, edges[j].b) && toEnd[edges[j].child] === d ==> toEnd[edges[j].b] >= 0 && toEnd[edges[j].b] <= d + 1)
      //@ invariant forall(u: nat, u < count && toEnd[u] >= 1 ==> 0 <= down[u] && down[u] < edges.length && leaves(edges, start, startFamily, u, down[u]) && toEnd[edges[down[u]].child] === toEnd[u] - 1)
      //@ decreases edges.length - i
      const e = edges[i]!;
      if (e.followed && toEnd[e.child]! === d) {
        if (e.a >= 0 && toEnd[e.a]! === -1 && mayLeave(start, startFamily, e.family, e.a)) {
          toEnd[e.a] = d + 1;
          down[e.a] = i;
        }
        if (e.b >= 0 && toEnd[e.b]! === -1 && mayLeave(start, startFamily, e.family, e.b)) {
          toEnd[e.b] = d + 1;
          down[e.b] = i;
        }
      }
      i = i + 1;
    }
    d = d + 1;
  }
  const persons: number[] = [];
  const via: number[] = [];
  if (toEnd[start]! < 0) return { persons, via, toEnd, down };
  persons.push(start);
  let cur = start;
  let k = 0;
  while (cur !== end) {
    //@ invariant 0 <= cur && cur < count && persons.length === k + 1 && via.length === k
    //@ invariant persons[0] === start && persons[k] === cur
    //@ invariant 0 <= toEnd[cur] && toEnd[cur] <= maxGen - 1 - k
    //@ invariant forall(m: nat, m < k ==> 0 <= via[m] && via[m] < edges.length)
    //@ invariant forall(m: nat, m < k && 0 <= via[m] && via[m] < edges.length ==> edges[via[m]].child === persons[m + 1])
    //@ invariant forall(m: nat, m < k && 0 <= via[m] && via[m] < edges.length ==> stepFits(edges, toEnd, start, startFamily, maxGen, m, persons[m], via[m]))
    //@ invariant forall(m: nat, m < k ==> forall(j: nat, j < via[m] && j < edges.length ==> !stepFits(edges, toEnd, start, startFamily, maxGen, m, persons[m], j)))
    //@ decreases maxGen - 1 - k
    // The shortest way down from here fits, so the search below finds a link.
    //@ assert toEnd[cur] >= 1
    //@ assert stepFits(edges, toEnd, start, startFamily, maxGen, k, cur, down[cur])
    let found = -1;
    let i = 0;
    while (i < edges.length && found < 0) {
      //@ invariant 0 <= i && i <= edges.length
      //@ invariant found < 0 ==> forall(j: nat, j < i ==> !stepFits(edges, toEnd, start, startFamily, maxGen, k, cur, j))
      //@ invariant found >= 0 ==> found < edges.length && stepFits(edges, toEnd, start, startFamily, maxGen, k, cur, found) && forall(j: nat, j < found ==> !stepFits(edges, toEnd, start, startFamily, maxGen, k, cur, j))
      //@ decreases edges.length - i
      if (stepFits(edges, toEnd, start, startFamily, maxGen, k, cur, i)) found = i;
      i = i + 1;
    }
    //@ assert found >= 0
    const next = edges[found]!.child;
    //@ ghost let before = persons
    //@ ghost let viaBefore = via
    persons.push(next);
    via.push(found);
    //@ assert forall(m: nat, m < before.length ==> persons[m] === before[m])
    //@ assert forall(m: nat, m < viaBefore.length ==> via[m] === viaBefore[m])
    //@ assert persons[k + 1] === next && via[k] === found && persons[k] === cur
    cur = next;
    k = k + 1;
  }
  return { persons, via, toEnd, down };
}

// ---------------------------------------------------------------- the size (tree-charts, "Size of a Chart")

/** The cards of the first `n` generations. */
export function cardsUpTo(cardsAt: readonly number[], n: number): number {
  //@ verify
  //@ requires 0 <= n && n <= cardsAt.length
  //@ decreases n
  return n === 0 ? 0 : cardsUpTo(cardsAt, n - 1) + cardsAt[n - 1]!;
}

/** The sum of the first `n` numbers. */
export function sumUpTo(xs: readonly number[], n: number): number {
  //@ verify
  //@ requires 0 <= n && n <= xs.length
  //@ decreases n
  return n === 0 ? 0 : sumUpTo(xs, n - 1) + xs[n - 1]!;
}

/**
 * The ancestor of `v` in generation `kept`, following each Person's `parent` (the Person one
 * generation up they were reached from); `v` itself when it is in generation `kept` or above.
 */
export function ancestorIn(gen: readonly number[], parent: readonly number[], kept: number, v: number): number {
  //@ verify
  //@ requires gen.length === parent.length && 0 <= v && v < gen.length && kept >= 1
  //@ requires forall(u: nat, u < gen.length && gen[u] >= 2 ==> 0 <= parent[u] && parent[u] < gen.length && gen[parent[u]] === gen[u] - 1)
  //@ ensures 0 <= \result && \result < gen.length
  //@ ensures gen[v] > kept ==> gen[\result] === kept
  //@ ensures gen[v] <= kept ==> \result === v
  //@ decreases gen[v]
  return gen[v]! <= kept ? v : ancestorIn(gen, parent, kept, parent[v]!);
}

/** How many of the Persons 0 … n - 1 are left out below `a`: beyond generation `kept`, with `a` as their ancestor in it. */
export function leftOutBelow(gen: readonly number[], parent: readonly number[], kept: number, a: number, n: number): number {
  //@ verify
  //@ requires gen.length === parent.length && 0 <= n && n <= gen.length && kept >= 1
  //@ requires forall(u: nat, u < gen.length && gen[u] >= 2 ==> 0 <= parent[u] && parent[u] < gen.length && gen[parent[u]] === gen[u] - 1)
  //@ decreases n
  if (n === 0) return 0;
  return leftOutBelow(gen, parent, kept, a, n - 1) + (gen[n - 1]! > kept && ancestorIn(gen, parent, kept, n - 1) === a ? 1 : 0);
}

/** How many of the Persons 0 … n - 1 are beyond generation `kept`. */
export function leftOutUpTo(gen: readonly number[], kept: number, n: number): number {
  //@ verify
  //@ requires 0 <= n && n <= gen.length
  //@ decreases n
  if (n === 0) return 0;
  return leftOutUpTo(gen, kept, n - 1) + (gen[n - 1]! > kept ? 1 : 0);
}

/** The generations a Descendant chart keeps (`kept`), and how many descendants each Person of the last one has left out. */
export interface Cut {
  readonly kept: number;
  readonly leftOut: number[];
  readonly total: number;
}

/**
 * The cut of a Descendant chart to at most `limit` cards (tree-charts spec, "Size of a Chart"):
 * as many whole generations as fit, never fewer than 2, given the cards of each generation
 * (`cardsAt`, one per generation asked for). Each Person of the last generation kept is marked
 * with the number of descendants left out below them; one reached in two ways counts once, below
 * the ancestor it was selected through.
 */
export function cutToSize(count: number, gen: readonly number[], parent: readonly number[], cardsAt: readonly number[], limit: number): Cut {
  //@ verify
  //@ contract tree-charts: Size of a Chart
  //@ requires gen.length === count && parent.length === count && cardsAt.length >= 2
  //@ requires forall(u: nat, u < count ==> 0 <= gen[u] && gen[u] <= cardsAt.length)
  //@ requires forall(u: nat, u < count && gen[u] >= 2 ==> 0 <= parent[u] && parent[u] < count && gen[parent[u]] === gen[u] - 1)
  // Whole generations, at least 2, within the limit unless 2 already exceed it, and as many as fit.
  //@ ensures 2 <= \result.kept && \result.kept <= cardsAt.length
  //@ ensures \result.kept === 2 || cardsUpTo(cardsAt, \result.kept) <= limit
  //@ ensures \result.kept === cardsAt.length || cardsUpTo(cardsAt, \result.kept + 1) > limit
  // Scenario "A large family": every Person of the last generation kept carries exactly the number left out below them ...
  //@ ensures \result.leftOut.length === count
  //@ ensures forall(a: nat, a < count ==> \result.leftOut[a] === leftOutBelow(gen, parent, \result.kept, a, count))
  //@ ensures forall(a: nat, a < count && \result.leftOut[a] > 0 ==> gen[a] === \result.kept)
  // ... and the counts add up to the number left out in all.
  //@ ensures \result.total === leftOutUpTo(gen, \result.kept, count)
  //@ ensures sumUpTo(\result.leftOut, count) === \result.total
  let kept = 2;
  while (kept < cardsAt.length && cardsUpTo(cardsAt, kept + 1) <= limit) {
    //@ invariant 2 <= kept && kept <= cardsAt.length
    //@ invariant kept === 2 || cardsUpTo(cardsAt, kept) <= limit
    //@ decreases cardsAt.length - kept
    kept = kept + 1;
  }
  const leftOut: number[] = [];
  let a = 0;
  while (a < count) {
    //@ invariant 0 <= a && a <= count && leftOut.length === a
    //@ invariant forall(u: nat, u < a ==> leftOut[u] === 0)
    //@ decreases count - a
    leftOut.push(0);
    a = a + 1;
  }
  //@ assert forall(u: nat, u < count ==> leftOut[u] === leftOutBelow(gen, parent, kept, u, 0))
  let total = 0;
  let v = 0;
  while (v < count) {
    //@ invariant 0 <= v && v <= count && leftOut.length === count
    //@ invariant forall(u: nat, u < count ==> leftOut[u] === leftOutBelow(gen, parent, kept, u, v))
    //@ invariant total === leftOutUpTo(gen, kept, v)
    //@ invariant sumUpTo(leftOut, count) === total
    //@ invariant forall(u: nat, u < count && leftOut[u] > 0 ==> gen[u] === kept)
    //@ decreases count - v
    if (gen[v]! > kept) {
      const top = ancestorIn(gen, parent, kept, v);
      //@ ghost let before = leftOut
      leftOut[top] = leftOut[top]! + 1;
      total = total + 1;
    }
    v = v + 1;
  }
  return { kept, leftOut, total };
}
