import { parseEdtf } from './edtf.js';

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

/** Pure Living rule. `today` is passed in so that callers and tests control the clock. */
export function isLiving(facts: LivingFacts, today: Date): boolean {
  if (facts.deathRecorded) return false;
  if (facts.birthDates.length === 0) return true;
  let latestBirth: string | null = null;
  for (const date of facts.birthDates) {
    if (date === null) continue;
    const latest = parseEdtf(date).latest;
    if (latest !== null && (latestBirth === null || latest < latestBirth)) latestBirth = latest;
  }
  // No bounded birth date: the birth could be recent.
  if (latestBirth === null) return true;
  return latestBirth >= livingCutoff(today);
}
