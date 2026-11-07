/**
 * Presumed death (vault-import spec, "Presumed death when birth is provably long ago"; #132): a
 * Person with no death or burial and no birth date of their own is presumed dead, date unknown,
 * when a chain of fixed bounds proves they were born more than {@link PRESUMED_DEATH_YEARS} years
 * before the day of the run. The bounds are ones no real life crosses:
 *
 * - born at least {@link MIN_AGE_AT_MARRIAGE} years before their own marriage;
 * - a parent born at least {@link MIN_PARENT_AGE} years before their child;
 * - a child born at most {@link MAX_AFTER_PARENT_DEATH} year after a parent's death;
 * - a child born at most {@link MAX_MOTHER_AGE} years after their mother's latest possible birth.
 *
 * Nothing else counts: no typical ages, no spouse age gaps, no reading of note text. The Living rule
 * (living.ts, 100 years) is unchanged; this bound only adds an undated death Event.
 *
 * Days are integers, year * 10000 + month * 100 + day, as the Living rule compares them: a bound of
 * so many years moves a day by that many times {@link YEAR}, keeping month and day. A 29 February
 * moved to a common year is no day, but as a bound it admits exactly the days up to 28 February.
 *
 * {@link presumedDead} is proved with LemmaScript (ADR 0009, docs/verification.md): it presumes a
 * death only for a Person with no death and no birth date of their own, from a chain that starts at
 * a fact and takes each further step by one of the bounds, and whose bound on the birth is before
 * the cutoff. {@link presumeDeaths} is the unverified shell: it finds the tightest bounds (repeated
 * until nothing changes) and the chain behind each, which the proved check then accepts or refuses.
 */

/** One year in the integer days of this file. */
export const YEAR = 10000;
export const MIN_AGE_AT_MARRIAGE = 12;
export const MIN_PARENT_AGE = 12;
export const MAX_AFTER_PARENT_DEATH = 1;
export const MAX_MOTHER_AGE = 60;
/** Born more than this many years before the run, by the bounds: presumed dead. */
export const PRESUMED_DEATH_YEARS = 125;

/** Kinds of fact that bound a Person's birth. */
export const OWN_BIRTH = 0;
export const MARRIAGE = 1;
export const PARENT_DEATH = 2;

/**
 * A fact that bounds a Person's birth from above: their own birth or baptism ({@link OWN_BIRTH}),
 * their own marriage ({@link MARRIAGE}), or the death or burial of a parent ({@link PARENT_DEATH}),
 * with the latest day the fact's date allows.
 */
export interface BirthAnchor {
  readonly person: number;
  readonly kind: number;
  readonly day: number;
}

/** A parent and a child, by index; `mother` when the parent is the child's mother. */
export interface ParentLink {
  readonly parent: number;
  readonly child: number;
  readonly mother: boolean;
}

/**
 * A chain of bounds: for each step a Person, the latest day they can have been born, and the rule
 * the step follows. Step 0 starts at a fact: its rule is the index of an anchor. Each later step
 * moves along a parent link: rule `j` (below `links.length`) from a child to its parent `links[j]`,
 * rule `links.length + j` from a mother to her child.
 */
export interface BoundChain {
  readonly persons: readonly number[];
  readonly values: readonly number[];
  readonly rules: readonly number[];
}

/** The latest day a Person can have been born, by one fact of theirs. */
export function anchorBound(a: BirthAnchor): number {
  //@ verify
  //@ ensures a.kind === MARRIAGE ==> \result === a.day - MIN_AGE_AT_MARRIAGE * YEAR
  //@ ensures a.kind === PARENT_DEATH ==> \result === a.day + MAX_AFTER_PARENT_DEATH * YEAR
  //@ ensures a.kind !== MARRIAGE && a.kind !== PARENT_DEATH ==> \result === a.day
  if (a.kind === MARRIAGE) return a.day - MIN_AGE_AT_MARRIAGE * YEAR;
  if (a.kind === PARENT_DEATH) return a.day + MAX_AFTER_PARENT_DEATH * YEAR;
  return a.day;
}

/** Whether a chain has as many Persons and values as steps, at least one, and ends at Person `p`. */
export function endsAt(c: BoundChain, p: number): boolean {
  //@ verify
  return c.rules.length > 0 && c.persons.length === c.rules.length && c.values.length === c.rules.length && c.persons[c.rules.length - 1]! === p;
}

/**
 * Whether step `i` of a chain follows: the first from a fact of its Person, each later one from the
 * step before by a parent link, with the value the bound gives.
 */
export function isStep(c: BoundChain, anchors: readonly BirthAnchor[], links: readonly ParentLink[], i: number): boolean {
  //@ verify
  //@ requires 0 <= i && i < c.rules.length && c.persons.length === c.rules.length && c.values.length === c.rules.length
  const r = c.rules[i]!;
  if (i === 0) return 0 <= r && r < anchors.length && anchors[r]!.person === c.persons[0]! && c.values[0]! === anchorBound(anchors[r]!);
  if (0 <= r && r < links.length)
    return links[r]!.child === c.persons[i - 1]! && links[r]!.parent === c.persons[i]! && c.values[i]! === c.values[i - 1]! - MIN_PARENT_AGE * YEAR;
  if (links.length <= r && r < links.length + links.length)
    return (
      links[r - links.length]!.mother &&
      links[r - links.length]!.parent === c.persons[i - 1]! &&
      links[r - links.length]!.child === c.persons[i]! &&
      c.values[i]! === c.values[i - 1]! + MAX_MOTHER_AGE * YEAR
    );
  return false;
}

/** Whether a chain ends at Person `p` and each of its steps follows. */
export function checkChain(c: BoundChain, anchors: readonly BirthAnchor[], links: readonly ParentLink[], p: number): boolean {
  //@ verify
  //@ ensures \result ==> endsAt(c, p) && forall(i: nat, i < c.rules.length ==> isStep(c, anchors, links, i))
  if (!endsAt(c, p)) return false;
  let i = 0;
  while (i < c.rules.length) {
    //@ invariant 0 <= i && i <= c.rules.length
    //@ invariant forall(j: nat, j < i ==> isStep(c, anchors, links, j))
    //@ decreases c.rules.length - i
    if (!isStep(c, anchors, links, i)) return false;
    i = i + 1;
  }
  return true;
}

/**
 * Who is presumed dead, of Persons 0 … count - 1: `chains[p]` is the chain offered for Person `p`,
 * `cutoff` the day {@link PRESUMED_DEATH_YEARS} years before the run.
 */
export function presumedDead(
  count: number,
  hasDeath: readonly boolean[],
  ownBirth: readonly boolean[],
  anchors: readonly BirthAnchor[],
  links: readonly ParentLink[],
  chains: readonly BoundChain[],
  cutoff: number,
): boolean[] {
  //@ verify
  //@ contract vault-import: Presumed death when birth is provably long ago
  //@ requires hasDeath.length === count && ownBirth.length === count && chains.length === count
  //@ ensures \result.length === count
  // Only a Person with no death or burial, and no birth or baptism date of their own (the Living rule decides for them).
  //@ ensures forall(p: nat, p < count && \result[p] ==> !hasDeath[p] && !ownBirth[p])
  // Only from a chain of the bounds that ends at the Person, each step following, with a bound on the birth before the cutoff.
  //@ ensures forall(p: nat, p < count && \result[p] ==> endsAt(chains[p], p) && chains[p].values[chains[p].rules.length - 1] < cutoff && forall(i: nat, i < chains[p].rules.length ==> isStep(chains[p], anchors, links, i)))
  // Scenario "No dates, no relatives": with no fact of their own and no parent link, nobody is presumed dead.
  //@ ensures forall(p: nat, p < count && forall(a: nat, a < anchors.length ==> anchors[a].person !== p) && forall(j: nat, j < links.length ==> links[j].parent !== p && links[j].child !== p) ==> !\result[p])
  const dead: boolean[] = [];
  let p = 0;
  while (p < count) {
    //@ invariant 0 <= p && p <= count && dead.length === p
    //@ invariant forall(u: nat, u < p && dead[u] ==> !hasDeath[u] && !ownBirth[u])
    //@ invariant forall(u: nat, u < p && dead[u] ==> endsAt(chains[u], u) && chains[u].values[chains[u].rules.length - 1] < cutoff && forall(i: nat, i < chains[u].rules.length ==> isStep(chains[u], anchors, links, i)))
    //@ invariant forall(u: nat, u < p && forall(a: nat, a < anchors.length ==> anchors[a].person !== u) && forall(j: nat, j < links.length ==> links[j].parent !== u && links[j].child !== u) ==> !dead[u])
    //@ decreases count - p
    const c = chains[p]!;
    const chained = checkChain(c, anchors, links, p);
    dead.push(!hasDeath[p]! && !ownBirth[p]! && chained && c.values[c.rules.length - 1]! < cutoff);
    p = p + 1;
  }
  return dead;
}

// ---------------------------------------------------------------- the shell

/** What the rule needs of Persons 0 … count - 1. */
export interface PresumptionFacts {
  readonly count: number;
  readonly hasDeath: readonly boolean[];
  readonly ownBirth: readonly boolean[];
  readonly anchors: readonly BirthAnchor[];
  readonly links: readonly ParentLink[];
}

/** A presumed death: the Person, and the chain that proves the bound on their birth. */
export interface Presumption {
  readonly person: number;
  readonly chain: BoundChain;
}

/**
 * The presumed deaths, and whether the bounds settled. They do not when the parent links contradict
 * each other (someone is their own ancestor); a bound that rests on such a circle is then refused.
 */
export interface Presumptions {
  readonly presumed: readonly Presumption[];
  readonly settled: boolean;
}

/** A calendar day as one integer, year * 10000 + month * 100 + day. */
export function dayKey(year: number, month: number, day: number): number {
  return year * YEAR + month * 100 + day;
}

/** A day of this file as an ISO day; 29 February of a common year, as a bound, is 28 February. */
export function dayText(key: number): string {
  const year = Math.floor(key / YEAR);
  const month = Math.floor((key % YEAR) / 100);
  let day = key % 100;
  if (month === 2 && day === 29 && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))) day = 28;
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

const EMPTY: BoundChain = { persons: [], values: [], rules: [] };

/**
 * The tightest bound on each Person's birth, by the four bounds from the facts, repeated until
 * nothing changes; then, for each Person with no death and no birth date of their own whose bound is
 * before the cutoff, the chain behind it, which {@link presumedDead} checks. A chain that does not
 * lead back to a fact (only possible when the parent links contradict each other) is refused.
 */
export function presumeDeaths(facts: PresumptionFacts, today: Date): Presumptions {
  const { count, anchors, links } = facts;
  const cutoff = dayKey(today.getUTCFullYear() - PRESUMED_DEATH_YEARS, today.getUTCMonth() + 1, today.getUTCDate());
  /** The tightest bound so far on each birth, and the step it came by: an anchor, or a chain rule along a link. */
  const best: Array<number | null> = Array.from({ length: count }, () => null);
  const via: Array<{ anchor: number } | { rule: number } | null> = Array.from({ length: count }, () => null);
  const tighten = (p: number, value: number, step: { anchor: number } | { rule: number }) => {
    const current = best[p];
    if (current !== null && current !== undefined && current <= value) return false;
    best[p] = value;
    via[p] = step;
    return true;
  };
  anchors.forEach((a, i) => tighten(a.person, anchorBound(a), { anchor: i }));
  // A round tightens what a chain one step longer gives; with links that agree, count rounds settle every bound.
  let changed = true;
  for (let round = 0; changed && round <= count; round++) {
    changed = false;
    links.forEach((l, j) => {
      const child = best[l.child];
      if (child !== null && child !== undefined && tighten(l.parent, child - MIN_PARENT_AGE * YEAR, { rule: j })) changed = true;
      const mother = best[l.parent];
      if (l.mother && mother !== null && mother !== undefined && tighten(l.child, mother + MAX_MOTHER_AGE * YEAR, { rule: links.length + j })) changed = true;
    });
  }
  /** The chain behind a bound, back to its fact; none when the steps go round in a circle (links that contradict each other). */
  const chainTo = (p: number): BoundChain => {
    const steps: Array<{ person: number; rule: number }> = [];
    let at = p;
    while (steps.length <= count) {
      const step = via[at];
      if (!step) return EMPTY;
      if ('anchor' in step) {
        steps.unshift({ person: at, rule: step.anchor });
        const values: number[] = [];
        for (const [i, s] of steps.entries())
          values.push(
            i === 0 ? anchorBound(anchors[s.rule]!) : s.rule < links.length ? values[i - 1]! - MIN_PARENT_AGE * YEAR : values[i - 1]! + MAX_MOTHER_AGE * YEAR,
          );
        return { persons: steps.map((s) => s.person), values, rules: steps.map((s) => s.rule) };
      }
      steps.unshift({ person: at, rule: step.rule });
      at = step.rule < links.length ? links[step.rule]!.child : links[step.rule - links.length]!.parent;
    }
    return EMPTY;
  };
  const chains = Array.from({ length: count }, (_, p) => {
    const b = best[p];
    return !facts.hasDeath[p] && !facts.ownBirth[p] && b !== null && b !== undefined && b < cutoff ? chainTo(p) : EMPTY;
  });
  const dead = presumedDead(count, facts.hasDeath, facts.ownBirth, anchors, links, chains, cutoff);
  return { presumed: chains.flatMap((chain, person) => (dead[person] ? [{ person, chain }] : [])), settled: !changed };
}
