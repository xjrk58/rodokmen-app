// Kinship (kinship spec): how a Person is related to the signed-in Member's own Person. The server
// works it out from the Family links by fixed rules (shared/src/kinship.ts, proved) and writes each
// term in every Interface language, so the app holds no kinship rules and builds no term from
// words. This module is the one place the app reads kinship, as relation.js reads the relation to
// the family: the full answer of a person page, cached as "kinship:<id>", and the short form that
// Person summaries carry. A Chart's cards carry the same short form and say it through the same
// words (src/kinship-text.js), with the Chart's labels.

import { api } from './api.js';
import { language, t } from './i18n.js';
import { kinshipWords } from './kinship-text.js';

/** @typedef {import('./types.js').Kinship} Kinship */
/** @typedef {import('./types.js').KinshipShort} KinshipShort */
/** @typedef {import('./types.js').KinshipPath} KinshipPath */
/** @typedef {import('./types.js').KinshipTerm} KinshipTerm */
/** @typedef {import('./types.js').Me} Me */
/** @typedef {import('./types.js').MemberView} MemberView */
/** @typedef {import('./types.js').PersonSummary} PersonSummary */

/**
 * Every path between the signed-in Member's own Person and this one.
 * @param {string} id @param {AbortSignal} [signal] @returns {Promise<Kinship>}
 */
export const getKinship = (id, signal) => api(`persons/${encodeURIComponent(id)}/kinship`, { signal });

/** "This is me": asks the Owner to link the account to this Person. @param {string} personId @returns {Promise<Me>} */
export const askToBeLinked = (personId) => api('me/person-request', { method: 'PUT', body: { personId } });

/** Withdraws the request to be linked. @returns {Promise<Me>} */
export const withdrawRequest = () => api('me/person-request', { method: 'DELETE' });

/** The Owner refuses a Member's request. @param {string} memberId @returns {Promise<MemberView>} */
export const refuseRequest = (memberId) => api(`members/${encodeURIComponent(memberId)}/person-request`, { method: 'DELETE' });

/** A term in the reader's Interface language. @param {KinshipTerm} term */
export const termText = (term) => term[language()].text;

/**
 * The kinship of a path or a short form, as the app says it: the reader's own Person as "vy",
 * a possible path with "možná" (through an i18n key, never by joining words), in the reader's
 * Interface language. The cards of a Chart say it the same way (src/kinship-text.js).
 * @param {{ kind: string, term: KinshipTerm, possible: boolean }} k
 */
export const kinshipText = (k) => kinshipWords(k, t, language());

/**
 * The line and degree as the civil code counts them, kinship by marriage marked; empty for the
 * kinds with no degree.
 * @param {{ kind: string, line: 'direct' | 'collateral' | null, degree: number | null }} k
 */
export function lineAndDegree(k) {
  if (k.line === null || k.degree === null) return '';
  const text = t('kinship.lineDegree', { line: t(`kinship.line.${k.line}`), degree: k.degree });
  return k.kind === 'marriage' ? t('kinship.byMarriage', { lineDegree: text }) : text;
}

/** The short form of a Person summary as text, or null when there is none to show. @param {PersonSummary | object} person */
export function shortKinship(person) {
  const k = 'kinship' in person ? person.kinship : null;
  return k ? kinshipText(k) : null;
}

/**
 * Whether a full answer belongs to the Member signed in now: an answer kept on the device for
 * another own Person is not shown.
 * @param {Kinship} k @param {Me | null} me
 */
export const isForMe = (k, me) => Boolean(me?.person && k.from === me.person.id);
