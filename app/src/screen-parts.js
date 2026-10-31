// Pieces the family screens share: loading cache first, the "as of" label, error lines,
// a Person's name with life years and marks, and a debounced value.

import { ApiError, messageOf } from './api.js';
import { loadThrough } from './cache.js';
import { lifeYears } from './hourglass-layout.js';
import { language, t } from './i18n.js';
import { relationOf } from './relation.js';
import { html, useEffect, useState } from './ui.js';

/** @typedef {import('./types.js').PersonSummary} PersonSummary */

/**
 * @template T
 * @typedef {{ key: string | null, data: T | null, asOf: string | null, error: unknown, loading: boolean }} Loaded
 */

/**
 * Loads a record cache first (src/cache.js): the cached copy at once, then the fresh one.
 * While another key loads, the previous data stays, so a screen can move from one to the next.
 * @template T
 * @param {string | null} key cache key; null loads nothing
 * @param {(signal: AbortSignal) => Promise<T>} fetcher
 * @param {boolean} cache whether to use the cache (only for a signed-in Member)
 * @returns {Loaded<T> & { reload: () => void }}
 */
export function useCachedLoad(key, fetcher, cache) {
  /** @type {[Loaded<T>, (update: Loaded<T> | ((s: Loaded<T>) => Loaded<T>)) => void]} */
  const [state, setState] = useState(/** @type {Loaded<T>} */ ({ key: null, data: null, asOf: null, error: null, loading: key !== null }));
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (key === null) return undefined;
    const controller = new AbortController();
    const { signal } = controller;
    setState((s) => ({ ...s, loading: true, error: null }));
    loadThrough(
      key,
      () => fetcher(signal),
      (data, asOf) => {
        if (!signal.aborted) setState({ key, data, asOf, error: null, loading: asOf !== null });
      },
      { cache, signal },
    )
      .then(() => {
        if (!signal.aborted) setState((s) => ({ ...s, loading: false }));
      })
      .catch((/** @type {unknown} */ error) => {
        if (!signal.aborted) setState((s) => ({ ...s, key, data: s.key === key ? s.data : null, error, loading: false }));
      });
    return () => controller.abort();
    // The fetcher is a new function on every render; the key names what it loads.
  }, [key, round, cache]);
  return { ...state, reload: () => setRound((r) => r + 1) };
}

/**
 * A value that follows `value` after `ms` without change.
 * @template T
 * @param {T} value
 * @param {number} ms
 * @returns {T}
 */
export function useDebounced(value, ms) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** @param {string} iso */
export function formatTime(iso) {
  return new Intl.DateTimeFormat(language(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

/**
 * "As of" and the time the data shown was loaded, when it comes from the device and not the server.
 * @param {{ asOf: string | null }} props
 */
export function AsOf({ asOf }) {
  if (!asOf) return null;
  return html`<p class="as-of" data-testid="as-of" role="status">${t('cache.asOf', { time: formatTime(asOf) })}</p>`;
}

/**
 * What went wrong, in words for the Member.
 * @param {unknown} error
 */
export function errorText(error) {
  if (error instanceof ApiError && error.offline) return t('family.offline');
  if (error instanceof ApiError && error.status === 401) return t('family.signedOut');
  if (error instanceof ApiError && error.status === 404) return t('family.notFound');
  return messageOf(error);
}

/** @param {{ error: unknown }} props */
export function ErrorLine({ error }) {
  if (!error) return null;
  return html`<p class="form-status error" role="alert" data-testid="screen-error">${errorText(error)}</p>`;
}

/**
 * The marks a Person carries wherever they appear: Living, Possible relative once the Tree knows
 * the relation (src/relation.js), and Family root.
 * @param {Pick<PersonSummary, 'living' | 'relation' | 'familyRoot'>} person
 * @returns {{ kind: 'living' | 'possible' | 'root', text: string }[]}
 */
export function personMarks(person) {
  /** @type {{ kind: 'living' | 'possible' | 'root', text: string }[]} */
  const marks = [];
  if (person.living) marks.push({ kind: 'living', text: t('person.living') });
  if (relationOf(person) === 'possible') marks.push({ kind: 'possible', text: t('person.possible') });
  if (person.familyRoot) marks.push({ kind: 'root', text: t('person.familyRoot') });
  return marks;
}

/** @param {{ marks: ReturnType<typeof personMarks> }} props */
export const Marks = ({ marks }) => marks.map((m) => html` <span class=${`mark ${m.kind}`} data-testid="mark" data-mark=${m.kind}>${m.text}</span>`);

/**
 * A Person's name, life years and marks on one line.
 * @param {{ person: PersonSummary, href?: string }} props
 */
export function PersonLine({ person, href }) {
  const years = lifeYears(person);
  const marks = personMarks(person);
  const name = href ? html`<a href=${href} class="person-name">${person.displayName}</a>` : html`<span class="person-name">${person.displayName}</span>`;
  return html`<span class="person-line"> ${name}${years ? html` <span class="years">${years}</span>` : null} <${Marks} marks=${marks} /> </span>`;
}
