/**
 * The rules of a House chart (tree-charts spec, "House chart" and "Succession in a House chart";
 * GLOSSARY "House chart"): which Roles place a Person at a House, which of a Person's Families
 * an Event at the House belongs to, the period of each row, the order of the rows, and how a row
 * is linked to an earlier one through Family links.
 *
 * A House chart shows who lived at a House, never who held it: the Tree records no holder, and
 * no rule here has a holder at all (design.md, "What the House chart can and cannot know").
 *
 * Each rule is a pure function on indices and integers, proved with LemmaScript (ADR 0009,
 * docs/verification.md). The shell that gathers the Events at the House, turns dates into days and
 * builds the model (shared/src/house-chart-model.ts) is not proved; the tests cover it.
 */

// ---------------------------------------------------------------- who is placed (tree-charts, "House chart")

/**
 * Whether a Role in an Event at the House places its Person there: the child and the parents of
 * a birth or baptism, the partners of a marriage, and anyone at a residence, census entry, death
 * or burial but a godparent, witness, priest or informant (scenario "Godmother from next door").
 */
export function placesAtHouse(type: string, role: string): boolean {
  //@ verify
  //@ contract tree-charts: House chart
  //@ ensures role === 'godparent' || role === 'witness' || role === 'priest' || role === 'informant' ==> !\result
  //@ ensures (type === 'birth' || type === 'baptism') ==> \result === (role === 'child' || role === 'father' || role === 'mother')
  //@ ensures type === 'marriage' ==> \result === (role === 'partner')
  if (role === 'godparent' || role === 'witness' || role === 'priest' || role === 'informant') return false;
  if (type === 'birth' || type === 'baptism') return role === 'child' || role === 'father' || role === 'mother';
  if (type === 'marriage') return role === 'partner';
  return type === 'residence' || type === 'census' || type === 'death' || type === 'burial';
}

/**
 * Whether a Family's marriage is known to be later than an Event: its earliest day is after the
 * Event's latest day. An undated marriage, or an Event open towards the future, is not.
 */
export function marriedLater(marriageDated: boolean, marriageEarliest: number, eventOpenEnd: boolean, eventLatest: number): boolean {
  //@ verify
  return marriageDated && !eventOpenEnd && marriageEarliest > eventLatest;
}

/**
 * Which of a Person's Families, given in the Chart's order (by marriage), an Event belongs to:
 * the latest whose marriage is not known to be later than the Event; -1 for none.
 */
export function familyAt(marriageDated: readonly boolean[], marriageEarliest: readonly number[], eventOpenEnd: boolean, eventLatest: number): number {
  //@ verify
  //@ contract tree-charts: House chart
  //@ requires marriageDated.length === marriageEarliest.length
  //@ ensures -1 <= \result && \result < marriageDated.length
  //@ ensures \result >= 0 ==> !marriedLater(marriageDated[\result], marriageEarliest[\result], eventOpenEnd, eventLatest)
  //@ ensures forall(j: nat, j < marriageDated.length && j > \result ==> marriedLater(marriageDated[j], marriageEarliest[j], eventOpenEnd, eventLatest))
  let found = -1;
  let i = 0;
  while (i < marriageDated.length) {
    //@ invariant 0 <= i && i <= marriageDated.length && -1 <= found && found < i
    //@ invariant found >= 0 ==> !marriedLater(marriageDated[found], marriageEarliest[found], eventOpenEnd, eventLatest)
    //@ invariant forall(j: nat, j < i && j > found ==> marriedLater(marriageDated[j], marriageEarliest[j], eventOpenEnd, eventLatest))
    //@ decreases marriageDated.length - i
    if (!marriedLater(marriageDated[i]!, marriageEarliest[i]!, eventOpenEnd, eventLatest)) found = i;
    i = i + 1;
  }
  return found;
}

// ---------------------------------------------------------------- rows and their periods

/**
 * One Role at an Event at the House, with the row the shell put it in: the Event's type, the
 * Role, and the Event's days (integers `yyyymmdd`; `openStart` and `openEnd` for an open range,
 * `dated` false for an undated Event).
 */
export interface Placement {
  readonly row: number;
  readonly type: string;
  readonly role: string;
  readonly dated: boolean;
  readonly openStart: boolean;
  readonly openEnd: boolean;
  readonly earliest: number;
  readonly latest: number;
}

/**
 * The rows of a House chart: whether anything places each row (`by`: one placement that does,
 * -1 for none), and its period, from the earliest to the latest day of its dated placing Events
 * (`first` and `last`: the placements with those days, -1 for none).
 */
export interface HouseRows {
  readonly by: number[];
  readonly dated: boolean[];
  readonly openStart: boolean[];
  readonly openEnd: boolean[];
  readonly earliest: number[];
  readonly latest: number[];
  readonly first: number[];
  readonly last: number[];
}

/**
 * Whether placement `i` places its Person, with a date that bounds its row's period.
 * @public Only the proofs use it (docs/verification.md), which knip cannot see.
 */
export function bounds(placements: readonly Placement[], i: number): boolean {
  //@ verify
  //@ requires 0 <= i && i < placements.length
  const p = placements[i]!;
  return placesAtHouse(p.type, p.role) && p.dated;
}

/**
 * The rows of a House chart and their periods (tree-charts spec, "House chart"): a row is there
 * only when an Event at the House places someone in it, and its period runs from the earliest to
 * the latest day of those Events; open dates widen it, and undated Events do not count.
 */
export function houseRows(rowCount: number, placements: readonly Placement[]): HouseRows {
  //@ verify
  //@ contract tree-charts: House chart
  //@ requires rowCount >= 0
  //@ requires forall(i: nat, i < placements.length ==> 0 <= placements[i].row && placements[i].row < rowCount)
  //@ ensures \result.by.length === rowCount && \result.dated.length === rowCount && \result.openStart.length === rowCount && \result.openEnd.length === rowCount
  //@ ensures \result.earliest.length === rowCount && \result.latest.length === rowCount && \result.first.length === rowCount && \result.last.length === rowCount
  // Every row shown has an Event at the House that places it, and a godparent, witness, priest or informant places nobody.
  //@ ensures forall(r: nat, r < rowCount && \result.by[r] >= 0 ==> \result.by[r] < placements.length && placements[\result.by[r]].row === r && placesAtHouse(placements[\result.by[r]].type, placements[\result.by[r]].role))
  //@ ensures forall(i: nat, i < placements.length && placesAtHouse(placements[i].type, placements[i].role) ==> \result.by[placements[i].row] >= 0)
  // The period: every dated placing Event of a row lies within it ...
  //@ ensures forall(i: nat, i < placements.length && bounds(placements, i) ==> \result.dated[placements[i].row])
  //@ ensures forall(i: nat, i < placements.length && bounds(placements, i) && placements[i].openStart ==> \result.openStart[placements[i].row])
  //@ ensures forall(i: nat, i < placements.length && bounds(placements, i) && placements[i].openEnd ==> \result.openEnd[placements[i].row])
  //@ ensures forall(i: nat, i < placements.length && bounds(placements, i) && !placements[i].openStart ==> \result.earliest[placements[i].row] <= placements[i].earliest)
  //@ ensures forall(i: nat, i < placements.length && bounds(placements, i) && !placements[i].openEnd ==> placements[i].latest <= \result.latest[placements[i].row])
  // ... and its ends are the days of such Events; a row with no dated placing Event is undated.
  //@ ensures forall(r: nat, r < rowCount && \result.first[r] >= 0 ==> \result.first[r] < placements.length && placements[\result.first[r]].row === r && bounds(placements, \result.first[r]) && !placements[\result.first[r]].openStart && placements[\result.first[r]].earliest === \result.earliest[r])
  //@ ensures forall(r: nat, r < rowCount && \result.last[r] >= 0 ==> \result.last[r] < placements.length && placements[\result.last[r]].row === r && bounds(placements, \result.last[r]) && !placements[\result.last[r]].openEnd && placements[\result.last[r]].latest === \result.latest[r])
  //@ ensures forall(r: nat, r < rowCount && \result.dated[r] && !\result.openStart[r] ==> \result.first[r] >= 0)
  //@ ensures forall(r: nat, r < rowCount && \result.dated[r] && !\result.openEnd[r] ==> \result.last[r] >= 0)
  //@ ensures forall(r: nat, r < rowCount && \result.dated[r] ==> \result.by[r] >= 0)
  const by: number[] = [];
  const dated: boolean[] = [];
  const openStart: boolean[] = [];
  const openEnd: boolean[] = [];
  const earliest: number[] = [];
  const latest: number[] = [];
  const first: number[] = [];
  const last: number[] = [];
  let r = 0;
  while (r < rowCount) {
    //@ invariant 0 <= r && r <= rowCount && by.length === r && dated.length === r && openStart.length === r && openEnd.length === r
    //@ invariant earliest.length === r && latest.length === r && first.length === r && last.length === r
    //@ invariant forall(s: nat, s < r ==> by[s] === -1 && !dated[s] && !openStart[s] && !openEnd[s] && first[s] === -1 && last[s] === -1)
    //@ decreases rowCount - r
    by.push(-1);
    dated.push(false);
    openStart.push(false);
    openEnd.push(false);
    earliest.push(0);
    latest.push(0);
    first.push(-1);
    last.push(-1);
    r = r + 1;
  }
  let i = 0;
  while (i < placements.length) {
    //@ invariant 0 <= i && i <= placements.length
    //@ invariant by.length === rowCount && dated.length === rowCount && openStart.length === rowCount && openEnd.length === rowCount
    //@ invariant earliest.length === rowCount && latest.length === rowCount && first.length === rowCount && last.length === rowCount
    //@ invariant forall(s: nat, s < rowCount && by[s] >= 0 ==> by[s] < placements.length && placements[by[s]].row === s && placesAtHouse(placements[by[s]].type, placements[by[s]].role))
    //@ invariant forall(j: nat, j < i && placesAtHouse(placements[j].type, placements[j].role) ==> by[placements[j].row] >= 0)
    //@ invariant forall(j: nat, j < i && bounds(placements, j) ==> dated[placements[j].row])
    //@ invariant forall(j: nat, j < i && bounds(placements, j) && placements[j].openStart ==> openStart[placements[j].row])
    //@ invariant forall(j: nat, j < i && bounds(placements, j) && placements[j].openEnd ==> openEnd[placements[j].row])
    //@ invariant forall(j: nat, j < i && bounds(placements, j) && !placements[j].openStart ==> first[placements[j].row] >= 0 && earliest[placements[j].row] <= placements[j].earliest)
    //@ invariant forall(j: nat, j < i && bounds(placements, j) && !placements[j].openEnd ==> last[placements[j].row] >= 0 && placements[j].latest <= latest[placements[j].row])
    //@ invariant forall(s: nat, s < rowCount && first[s] >= 0 ==> first[s] < placements.length && placements[first[s]].row === s && bounds(placements, first[s]) && !placements[first[s]].openStart && placements[first[s]].earliest === earliest[s])
    //@ invariant forall(s: nat, s < rowCount && last[s] >= 0 ==> last[s] < placements.length && placements[last[s]].row === s && bounds(placements, last[s]) && !placements[last[s]].openEnd && placements[last[s]].latest === latest[s])
    //@ invariant forall(s: nat, s < rowCount && dated[s] && !openStart[s] ==> first[s] >= 0)
    //@ invariant forall(s: nat, s < rowCount && dated[s] && !openEnd[s] ==> last[s] >= 0)
    //@ invariant forall(s: nat, s < rowCount && dated[s] ==> by[s] >= 0)
    //@ decreases placements.length - i
    const p = placements[i]!;
    if (placesAtHouse(p.type, p.role)) {
      const row = p.row;
      if (by[row]! < 0) by[row] = i;
      if (p.dated) {
        dated[row] = true;
        if (p.openStart) openStart[row] = true;
        else if (first[row]! < 0 || p.earliest < earliest[row]!) {
          earliest[row] = p.earliest;
          first[row] = i;
        }
        if (p.openEnd) openEnd[row] = true;
        else if (last[row]! < 0 || p.latest > latest[row]!) {
          latest[row] = p.latest;
          last[row] = i;
        }
      }
    }
    i = i + 1;
  }
  return { by, dated, openStart, openEnd, earliest, latest, first, last };
}

/** A row's place in a House chart: the earliest day of its period (0 when open), whether it has one, and its key. */
export interface RowKey {
  readonly dated: boolean;
  readonly day: number;
  readonly key: string;
}

/**
 * The order of a House chart's rows (tree-charts spec, "House chart"): by the earliest day of
 * their Events at the House, undated rows last, then by key. A total order: 0 only for the same key.
 */
export function compareRows(a: RowKey, b: RowKey): number {
  //@ verify
  //@ contract tree-charts: House chart
  //@ ensures \result === -compareRows(b, a)
  //@ ensures -1 <= \result && \result <= 1
  //@ ensures \result === 0 ==> a.key === b.key
  // Scenario "Two generations": the parents' row, from 1795, before Jan's, from 1825.
  //@ ensures a.dated && b.dated && a.day < b.day ==> \result === -1
  //@ ensures a.dated && !b.dated ==> \result === -1
  if (a.dated !== b.dated) return a.dated ? -1 : 1;
  if (a.dated && a.day !== b.day) return a.day < b.day ? -1 : 1;
  return a.key < b.key ? -1 : b.key < a.key ? 1 : 0;
}

// ---------------------------------------------------------------- succession (tree-charts, "Succession in a House chart")

export const NO_LINK = 0;
export const SON = 1;
export const DAUGHTER = 2;
export const CHILD = 3;
export const REMARRIAGE = 4;

/** A child of a row's Family (any link type), by index. */
export interface RowChild {
  readonly child: number;
  readonly row: number;
}

/** How each row is linked to an earlier one: the kind, the earlier row (-1), the partner through whom (-1), and a partner who married in (-1). */
export interface Succession {
  readonly kind: number[];
  readonly from: number[];
  readonly through: number[];
  readonly marriedIn: number[];
}

/** Whether Person `p` is a child of row `r`'s Family. */
export function isChildOf(children: readonly RowChild[], p: number, r: number): boolean {
  //@ verify
  return p >= 0 && children.some((c) => c.child === p && c.row === r);
}

/** Whether Person `p` is a child of any row before row `r`. */
export function isChildBefore(children: readonly RowChild[], p: number, r: number): boolean {
  //@ verify
  return p >= 0 && children.some((c) => c.child === p && c.row < r);
}

/** Whether rows `r` and `j` share a partner. */
export function sharePartner(a: readonly number[], b: readonly number[], r: number, j: number): boolean {
  //@ verify
  //@ requires a.length === b.length && 0 <= r && r < a.length && 0 <= j && j < a.length
  return (a[r]! >= 0 && (a[r] === a[j] || a[r] === b[j])) || (b[r]! >= 0 && (b[r] === a[j] || b[r] === b[j]));
}

/** Whether a Family link connects row `r` to row `j`: a partner of `r` is a child of `j`'s Family, or the rows share a partner. */
export function linked(a: readonly number[], b: readonly number[], children: readonly RowChild[], r: number, j: number): boolean {
  //@ verify
  //@ requires a.length === b.length && 0 <= r && r < a.length && 0 <= j && j < a.length
  return isChildOf(children, a[r]!, j) || isChildOf(children, b[r]!, j) || sharePartner(a, b, r, j);
}

/**
 * How each row of a House chart is linked to an earlier one (tree-charts spec, "Succession in a
 * House chart"), rows in the Chart's order with their partners `a` and `b` (-1 for none): to the
 * latest earlier row a Family link connects it to. Through a partner who is a child of that row's
 * Family, as a son, daughter or child (by `sex`), the other partner then marked as having married
 * in when they are a child of no earlier row; else, through a partner the rows share, as a
 * remarriage; with no such row, no link is recorded. Nothing here says who held the House.
 */
export function succession(a: readonly number[], b: readonly number[], sex: readonly string[], children: readonly RowChild[]): Succession {
  //@ verify
  //@ contract tree-charts: Succession in a House chart
  //@ requires a.length === b.length
  //@ requires forall(r: nat, r < a.length ==> -1 <= a[r] && a[r] < sex.length && -1 <= b[r] && b[r] < sex.length)
  //@ ensures \result.kind.length === a.length && \result.from.length === a.length && \result.through.length === a.length && \result.marriedIn.length === a.length
  // The link goes to the latest earlier row a Family link connects the row to, and to none when there is none ("A new family").
  //@ ensures forall(r: nat, r < a.length ==> -1 <= \result.from[r] && \result.from[r] < r)
  //@ ensures forall(r: nat, r < a.length && \result.from[r] >= 0 ==> linked(a, b, children, r, \result.from[r]))
  //@ ensures forall(r: nat, r < a.length ==> forall(j: nat, j < r && j > \result.from[r] ==> !linked(a, b, children, r, j)))
  //@ ensures forall(r: nat, r < a.length ==> (\result.from[r] < 0) === (\result.kind[r] === NO_LINK))
  // "Son takes over" and "Son-in-law marries in": son, daughter or child exactly when a partner is a child of that row's Family ...
  //@ ensures forall(r: nat, r < a.length && \result.from[r] >= 0 ==> (\result.kind[r] === SON || \result.kind[r] === DAUGHTER || \result.kind[r] === CHILD) === (isChildOf(children, a[r], \result.from[r]) || isChildOf(children, b[r], \result.from[r])))
  //@ ensures forall(r: nat, r < a.length && (\result.kind[r] === SON || \result.kind[r] === DAUGHTER || \result.kind[r] === CHILD) ==> 0 <= \result.through[r] && \result.through[r] < sex.length && (\result.through[r] === a[r] || \result.through[r] === b[r]) && isChildOf(children, \result.through[r], \result.from[r]))
  //@ ensures forall(r: nat, r < a.length && \result.kind[r] === SON ==> sex[\result.through[r]] === 'male')
  //@ ensures forall(r: nat, r < a.length && \result.kind[r] === DAUGHTER ==> sex[\result.through[r]] === 'female')
  // ... the other partner married in exactly when they are a child of no earlier row ...
  //@ ensures forall(r: nat, r < a.length && \result.marriedIn[r] >= 0 ==> (\result.kind[r] === SON || \result.kind[r] === DAUGHTER || \result.kind[r] === CHILD) && (\result.marriedIn[r] === a[r] || \result.marriedIn[r] === b[r]) && \result.marriedIn[r] !== \result.through[r] && !isChildBefore(children, \result.marriedIn[r], r))
  //@ ensures forall(r: nat, r < a.length && (\result.kind[r] === SON || \result.kind[r] === DAUGHTER || \result.kind[r] === CHILD) && \result.through[r] === a[r] && b[r] >= 0 && b[r] !== a[r] && !isChildBefore(children, b[r], r) ==> \result.marriedIn[r] === b[r])
  //@ ensures forall(r: nat, r < a.length && (\result.kind[r] === SON || \result.kind[r] === DAUGHTER || \result.kind[r] === CHILD) && \result.through[r] === b[r] && a[r] >= 0 && a[r] !== b[r] && !isChildBefore(children, a[r], r) ==> \result.marriedIn[r] === a[r])
  // ... and "Widow remarries": a remarriage exactly when no partner is a child of that row's Family and the rows share a partner.
  //@ ensures forall(r: nat, r < a.length && \result.from[r] >= 0 ==> (\result.kind[r] === REMARRIAGE) === (!isChildOf(children, a[r], \result.from[r]) && !isChildOf(children, b[r], \result.from[r]) && sharePartner(a, b, r, \result.from[r])))
  //@ ensures forall(r: nat, r < a.length && \result.kind[r] === REMARRIAGE ==> 0 <= \result.through[r] && (\result.through[r] === a[r] || \result.through[r] === b[r]))
  const kind: number[] = [];
  const from: number[] = [];
  const through: number[] = [];
  const marriedIn: number[] = [];
  let r = 0;
  while (r < a.length) {
    //@ invariant 0 <= r && r <= a.length && kind.length === r && from.length === r && through.length === r && marriedIn.length === r
    //@ invariant forall(s: nat, s < r ==> -1 <= from[s] && from[s] < s)
    //@ invariant forall(s: nat, s < r && from[s] >= 0 ==> linked(a, b, children, s, from[s]))
    //@ invariant forall(s: nat, s < r ==> forall(j: nat, j < s && j > from[s] ==> !linked(a, b, children, s, j)))
    //@ invariant forall(s: nat, s < r ==> (from[s] < 0) === (kind[s] === NO_LINK))
    //@ invariant forall(s: nat, s < r && from[s] >= 0 ==> (kind[s] === SON || kind[s] === DAUGHTER || kind[s] === CHILD) === (isChildOf(children, a[s], from[s]) || isChildOf(children, b[s], from[s])))
    //@ invariant forall(s: nat, s < r && (kind[s] === SON || kind[s] === DAUGHTER || kind[s] === CHILD) ==> 0 <= through[s] && through[s] < sex.length && (through[s] === a[s] || through[s] === b[s]) && isChildOf(children, through[s], from[s]))
    //@ invariant forall(s: nat, s < r && kind[s] === SON ==> sex[through[s]] === 'male')
    //@ invariant forall(s: nat, s < r && kind[s] === DAUGHTER ==> sex[through[s]] === 'female')
    //@ invariant forall(s: nat, s < r && marriedIn[s] >= 0 ==> (kind[s] === SON || kind[s] === DAUGHTER || kind[s] === CHILD) && (marriedIn[s] === a[s] || marriedIn[s] === b[s]) && marriedIn[s] !== through[s] && !isChildBefore(children, marriedIn[s], s))
    //@ invariant forall(s: nat, s < r && (kind[s] === SON || kind[s] === DAUGHTER || kind[s] === CHILD) && through[s] === a[s] && b[s] >= 0 && b[s] !== a[s] && !isChildBefore(children, b[s], s) ==> marriedIn[s] === b[s])
    //@ invariant forall(s: nat, s < r && (kind[s] === SON || kind[s] === DAUGHTER || kind[s] === CHILD) && through[s] === b[s] && a[s] >= 0 && a[s] !== b[s] && !isChildBefore(children, a[s], s) ==> marriedIn[s] === a[s])
    //@ invariant forall(s: nat, s < r && from[s] >= 0 ==> (kind[s] === REMARRIAGE) === (!isChildOf(children, a[s], from[s]) && !isChildOf(children, b[s], from[s]) && sharePartner(a, b, s, from[s])))
    //@ invariant forall(s: nat, s < r && kind[s] === REMARRIAGE ==> 0 <= through[s] && (through[s] === a[s] || through[s] === b[s]))
    //@ decreases a.length - r
    // The latest earlier row a Family link connects this one to.
    let j = r - 1;
    while (j >= 0 && !linked(a, b, children, r, j)) {
      //@ invariant -1 <= j && j < r
      //@ invariant forall(k: nat, k < r && k > j ==> !linked(a, b, children, r, k))
      //@ decreases j + 1
      j = j - 1;
    }
    const pa = a[r]!;
    const pb = b[r]!;
    let k = NO_LINK;
    let via = -1;
    let other = -1;
    if (j >= 0) {
      if (isChildOf(children, pa, j)) {
        via = pa;
        other = pb;
      } else if (isChildOf(children, pb, j)) {
        via = pb;
        other = pa;
      }
      if (via >= 0) k = sex[via] === 'male' ? SON : sex[via] === 'female' ? DAUGHTER : CHILD;
      else {
        k = REMARRIAGE;
        via = pa >= 0 && (pa === a[j] || pa === b[j]) ? pa : pb;
      }
    }
    const married = (k === SON || k === DAUGHTER || k === CHILD) && other >= 0 && other !== via && !isChildBefore(children, other, r) ? other : -1;
    kind.push(k);
    from.push(j);
    through.push(via);
    marriedIn.push(married);
    r = r + 1;
  }
  return { kind, from, through, marriedIn };
}
