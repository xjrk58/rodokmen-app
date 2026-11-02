/**
 * Matching read names to Persons of the Tree (scan-reading spec, "Names are matched, not
 * duplicated"). The candidates come from the Tree, never from the model: the server queries
 * Persons by folded name variants, then scores each one with the fixed rules below. Deciding
 * who someone is stays this rule plus the Member's tap (ADR 0011).
 *
 * The scoring is proved with LemmaScript (ADR 0009, docs/verification.md). The folding of names
 * into variants and the years a role allows (name-variants.ts) are the unverified shell: they
 * use regular expressions and tables, and are tested.
 */
/** A read person as the rule sees it: folded name variants, the house number, the Place and the years their birth may fall in. */
export interface ReadFacts {
  givens: string[];
  surnames: string[];
  /** House number as read; empty when none. */
  house: string;
  /** The Place of the reading; empty when unknown. */
  placeId: string;
  /** Whether the reading gives a year, so a window of birth years. */
  hasWindow: boolean;
  windowFrom: number;
  windowTo: number;
}

/** A candidate Person as the rule sees it, gathered from the Tree. */
export interface CandidateFacts {
  /** Folded variants of the given names and surnames of all their Names. */
  givens: string[];
  surnames: string[];
  /** House numbers of the Houses where they have Events, as those Houses carried them then. */
  houses: string[];
  /** Places where they have Events. */
  placeIds: string[];
  /** Whether a birth or baptism year is known, and its range. */
  hasBirth: boolean;
  birthFrom: number;
  birthTo: number;
  /** A partner of theirs matches another person of the same entry. */
  family: boolean;
}

export interface MatchFlags {
  name: boolean;
  house: boolean;
  years: boolean;
  place: boolean;
  family: boolean;
}

export interface MatchScore {
  score: number;
  reasons: MatchFlags;
}

/** Whether two lists share a value. */
export function sharesOne(a: readonly string[], b: readonly string[]): boolean {
  //@ verify
  return a.some((x) => b.includes(x));
}

/** A given name and a surname of the read person, or their variants, are among the candidate's. */
export function nameMatches(read: ReadFacts, c: CandidateFacts): boolean {
  //@ verify
  return sharesOne(read.givens, c.givens) && sharesOne(read.surnames, c.surnames);
}

/** The read house number is one the candidate's Houses carried. */
export function houseMatches(read: ReadFacts, c: CandidateFacts): boolean {
  //@ verify
  return read.house !== '' && c.houses.includes(read.house);
}

/** The candidate's birth range meets the window of years the read role allows. */
export function yearsMatch(read: ReadFacts, c: CandidateFacts): boolean {
  //@ verify
  return read.hasWindow && c.hasBirth && c.birthFrom <= read.windowTo && read.windowFrom <= c.birthTo;
}

/** The candidate has an Event at the Place of the reading. */
export function placeMatches(read: ReadFacts, c: CandidateFacts): boolean {
  //@ verify
  return read.placeId !== '' && c.placeIds.includes(read.placeId);
}

/** The reasons for a candidate: computed from the read person and the Tree's facts only. */
export function matchReasons(read: ReadFacts, c: CandidateFacts): MatchFlags {
  //@ verify
  return { name: nameMatches(read, c), house: houseMatches(read, c), years: yearsMatch(read, c), place: placeMatches(read, c), family: c.family };
}

/**
 * The score of a set of reasons. The weights make the name, the House and the years decisive:
 * each outweighs everything below it together (16 > 8 + 4 + 1 + 1, 8 > 4 + 1 + 1, 4 > 1 + 1).
 */
export function scoreOf(r: MatchFlags): number {
  //@ verify
  //@ ensures \result >= 0 && \result <= 30
  return (r.name ? 16 : 0) + (r.house ? 8 : 0) + (r.years ? 4 : 0) + (r.place ? 1 : 0) + (r.family ? 1 : 0);
}

/** A candidate with the read name, the read House and a birth in the window. */
export function fullMatch(read: ReadFacts, c: CandidateFacts): boolean {
  //@ verify
  return nameMatches(read, c) && houseMatches(read, c) && yearsMatch(read, c);
}

/**
 * The score of one candidate for one read person, with its reasons. It depends only on the read
 * text and the Tree: the reasons are computed from the two, and the score from the reasons.
 */
export function scoreCandidate(read: ReadFacts, c: CandidateFacts): MatchScore {
  //@ verify
  //@ contract scan-reading: Names are matched, not duplicated
  //@ ensures \result.reasons === matchReasons(read, c)
  //@ ensures \result.score === scoreOf(matchReasons(read, c))
  const reasons = matchReasons(read, c);
  return { score: scoreOf(reasons), reasons };
}

/**
 * Whether candidate `a` is suggested before candidate `b` (scan-reading spec, "Names are
 * matched, not duplicated"; scenario "Known father"): a candidate with the read name, House and
 * a birth in the window scores above any candidate without all three, whatever else either has.
 */
export function ranksAbove(read: ReadFacts, a: CandidateFacts, b: CandidateFacts): boolean {
  //@ verify
  //@ contract scan-reading: Names are matched, not duplicated
  // Scenario "Known father": Jan Novák of čp. 12, born 1770, comes before a stranger of the same name elsewhere.
  //@ ensures fullMatch(read, a) && !fullMatch(read, b) ==> \result
  //@ ensures \result === (scoreCandidate(read, a).score > scoreCandidate(read, b).score)
  return scoreCandidate(read, a).score > scoreCandidate(read, b).score;
}

/** Whether a candidate is offered at all: only Persons whose name matches. */
export function isSuggested(read: ReadFacts, c: CandidateFacts): boolean {
  //@ verify
  //@ ensures \result === nameMatches(read, c)
  return nameMatches(read, c);
}
