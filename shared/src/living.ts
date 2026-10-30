import { parseEdtf, type CalendarDay } from './edtf.js';

/**
 * The Living rule (tree-model spec, "Living people are computed"; GLOSSARY "Living person").
 *
 * A Person is Living when they were born within the last {@link LIVING_YEARS} years and
 * have no recorded death, or when neither birth nor death is recorded. It is derived
 * from Events only, never entered by hand.
 *
 * - Birth evidence: birth and baptism Events in which the Person has the Role `child`.
 *   Each one bounds the birth from above (a baptism follows the birth), so the most
 *   constraining is the smallest `latest` day among them.
 * - Death evidence: death and burial Events in which the Person has the Role `deceased`,
 *   dated or not.
 *
 * When in doubt the rule says Living: an undated birth, or a date range open towards
 * today (`1790/..`), could fall within the last 100 years.
 *
 * The decision itself, {@link isLivingOn}, is proved with LemmaScript (ADR 0009,
 * docs/verification.md). Collecting the facts from Events, reading the EDTF dates and
 * reading today's date from the clock are not; the tests cover them.
 */
export const LIVING_YEARS = 100;

export const BIRTH_EVENT_TYPES = ['birth', 'baptism'] as const;
export const DEATH_EVENT_TYPES = ['death', 'burial'] as const;

export interface LivingFacts {
  /** EDTF dates (null when undated) of the Person's birth and baptism Events. */
  readonly birthDates: ReadonlyArray<string | null>;
  /** Whether any death or burial Event names the Person as deceased. */
  readonly deathRecorded: boolean;
}

export interface EventParticipation {
  readonly type: string;
  readonly role: string;
  readonly date: string | null;
}

/** Collects the facts the Living rule needs from the Events a Person takes part in. */
export function livingFactsFromEvents(events: Iterable<EventParticipation>): LivingFacts {
  const birthDates: Array<string | null> = [];
  let deathRecorded = false;
  for (const e of events) {
    if ((BIRTH_EVENT_TYPES as readonly string[]).includes(e.type) && e.role === 'child') birthDates.push(e.date);
    if ((DEATH_EVENT_TYPES as readonly string[]).includes(e.type) && e.role === 'deceased') deathRecorded = true;
  }
  return { birthDates, deathRecorded };
}

/** The day LIVING_YEARS before `today`, as an ISO day. */
export function livingCutoff(today: Date): string {
  const d = new Date(today.getTime());
  d.setUTCFullYear(d.getUTCFullYear() - LIVING_YEARS);
  return d.toISOString().slice(0, 10);
}

/**
 * The Living rule on calendar days. `birthLatest` holds, for each piece of birth evidence
 * whose date bounds the birth, the last day the birth could have been. Undated evidence
 * and dates open towards today bound nothing, so they are left out and never make a
 * Person not Living.
 *
 * The cutoff is the same calendar day {@link LIVING_YEARS} years before `today`. When
 * that is 29 February of a common year, born on 1 March or later still counts as within
 * the 100 years, as with {@link livingCutoff}.
 */
function isLivingOn(deathRecorded: boolean, birthLatest: ReadonlyArray<CalendarDay>, today: CalendarDay): boolean {
  //@ verify
  //@ contract tree-model: Living people are computed
  //@ requires 1 <= today.month && today.month <= 12 && 1 <= today.day && today.day <= 31
  //@ requires forall(i: nat, i < birthLatest.length ==> 1 <= birthLatest[i].month && birthLatest[i].month <= 12 && 1 <= birthLatest[i].day && birthLatest[i].day <= 31)
  // The rule: Living exactly when no death is recorded and every bounded birth could have been on or after the cutoff day.
  //@ ensures \result === (!deathRecorded && forall(i: nat, i < birthLatest.length ==> birthLatest[i].year > today.year - LIVING_YEARS || (birthLatest[i].year === today.year - LIVING_YEARS && (birthLatest[i].month > today.month || (birthLatest[i].month === today.month && birthLatest[i].day >= today.day)))))
  // A recorded death means not Living, whatever the birth dates say.
  //@ ensures deathRecorded ==> !\result
  // Scenario "No dates at all": no birth and no death Event means Living.
  //@ ensures !deathRecorded && birthLatest.length === 0 ==> \result
  // Scenario "Born more than 100 years ago": born in 1920, no recorded death, current year 2026 means not Living.
  //@ ensures exists(i: nat, i < birthLatest.length && birthLatest[i].year < today.year - LIVING_YEARS) ==> !\result
  // Scenario "Born less than 100 years ago": born in 1950, no recorded death means Living.
  //@ ensures !deathRecorded && forall(i: nat, i < birthLatest.length ==> birthLatest[i].year > today.year - LIVING_YEARS) ==> \result
  if (deathRecorded) return false;
  const cutoff = (today.year - LIVING_YEARS) * 10000 + today.month * 100 + today.day;
  for (const latest of birthLatest) {
    //@ invariant forall(j: nat, j < _latest_idx ==> birthLatest[j].year * 10000 + birthLatest[j].month * 100 + birthLatest[j].day >= cutoff)
    if (latest.year * 10000 + latest.month * 100 + latest.day < cutoff) return false;
  }
  return true;
}

/** The calendar day of an ISO day written by parseEdtf (the inverse of isoDay). */
function dayOfIso(iso: string): CalendarDay {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

/** Pure Living rule. `today` is passed in so that callers and tests control the clock. */
export function isLiving(facts: LivingFacts, today: Date): boolean {
  // A recorded death decides alone: the birth dates are not even read.
  const birthLatest: CalendarDay[] = [];
  if (!facts.deathRecorded) {
    for (const date of facts.birthDates) {
      if (date === null) continue;
      const latest = parseEdtf(date).latest;
      if (latest !== null) birthLatest.push(dayOfIso(latest));
    }
  }
  return isLivingOn(facts.deathRecorded, birthLatest, { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1, day: today.getUTCDate() });
}
