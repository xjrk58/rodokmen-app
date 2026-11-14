// Kinship in the mocked Tree API (kinship spec): the answers of GET /api/persons/{id}/kinship and
// the short form on Person summaries, for Dorota (23) as the reader. The answers come from the
// server's own rules applied to the invented Tree (tests/e2e/family-kinship.json, written and
// checked by tests/unit/kinship-answers.test.mjs); nothing here works kinship out.
import { readFileSync } from 'node:fs';
import { ID, PEOPLE } from './family-data.js';

/** @typedef {import('../../src/types.js').Kinship} Kinship */
/** @typedef {import('../../src/types.js').KinshipShort} KinshipShort */
/** @typedef {import('../../src/types.js').Me} Me */

/** The reader whose answers the file holds. */
export const KINSHIP_READER = 23;

/** @type {unknown} */
const parsed = JSON.parse(readFileSync(new URL('./family-kinship.json', import.meta.url), 'utf8'));
const ANSWERS = /** @type {Record<string, Kinship>} */ (parsed);

/** The answer for the reader about Person `n`. @param {number} n @returns {Kinship} */
export const kinshipOf = (n) => structuredClone(/** @type {Kinship} */ (ANSWERS[n]));

/** The first step of the reader's first path to Person `n`. @param {number} n */
export function firstStep(n) {
  const step = kinshipOf(n).paths[0]?.steps[0];
  if (!step) throw new Error(`no path to ${n}`);
  return step;
}

/** The short form of an answer, as Person summaries carry it. @param {Kinship} k @returns {KinshipShort | null} */
export function shortOf(k) {
  const [first] = k.paths;
  if (!first) return null;
  return { kind: first.kind, term: first.term, possible: first.possible, line: first.line, degree: first.degree, others: k.paths.length - 1, more: k.more };
}

/** Whether the Member's own Person is the reader of the answers. @param {Me | null} me */
const isReader = (me) => me?.person?.id === ID(KINSHIP_READER);

/**
 * GET /api/persons/{id}/kinship as the server answers it: the reader's answer, 422 with no own
 * Person; any other own Person gets 404, as no answers are kept for it.
 * @param {Me | null} me
 * @param {string} id
 */
export function kinshipReply(me, id) {
  if (!me?.person) return { status: 422, json: { code: 'no_own_person', message: 'Name the starting Person with ?from=.' } };
  const n = Number(id.slice(-12));
  if (!isReader(me) || !ANSWERS[n]) return { status: 404, json: { code: 'not_found', message: 'No kinship kept for this reader.' } };
  return { json: kinshipOf(n) };
}

/**
 * Puts the short form into every Person summary of an answer, as the server does for a Member
 * with an own Person; for anyone else the field stays absent.
 * @template T
 * @param {T} json
 * @param {Me | null} me
 * @returns {T}
 */
export function withKinship(json, me) {
  if (!isReader(me)) return json;
  /** @param {unknown} v @returns {unknown} */
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    /** @type {Record<string, unknown>} */
    const out = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    if (typeof out.id === 'string' && 'displayName' in out && 'familyRoot' in out && PEOPLE.some(([n]) => ID(n) === out.id)) {
      out.kinship = shortOf(kinshipOf(Number(out.id.slice(-12))));
    }
    return out;
  };
  return /** @type {T} */ (walk(json));
}
