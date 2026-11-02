// Interface strings in Czech and English. The language is the reader's choice on
// this device (kept in localStorage), else a signed-in Member's account language,
// else Czech; the browser's language does not decide it (map-view, "Czech by default").

export const LANGUAGES = /** @type {const} */ (['cs', 'en']);
/** @typedef {typeof LANGUAGES[number]} Language */

const STORAGE_KEY = 'rodokmen.language';

/** @type {Record<string, string>} */
let strings = {};
/** @type {Language} */
let current = 'cs';
/** @type {Set<(lang: Language) => void>} */
const listeners = new Set();
/** Counts setLanguage calls, so a slow load of an earlier choice cannot undo a later one. */
let requested = 0;

/**
 * @param {string | null | undefined} value
 * @returns {value is Language}
 */
function isLanguage(value) {
  return LANGUAGES.includes(/** @type {Language} */ (value));
}

/**
 * The language the reader chose on this device, if any.
 * @returns {Language | null}
 */
export function storedLanguage() {
  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // storage blocked
  }
  return isLanguage(stored) ? stored : null;
}

/**
 * The language to open in: the choice on this device, else the account's language of a
 * signed-in Member, else Czech.
 * @param {string | null} [accountLanguage]
 * @returns {Language}
 */
export function detectLanguage(accountLanguage = null) {
  return storedLanguage() ?? (isLanguage(accountLanguage) ? accountLanguage : 'cs');
}

/** @returns {Language} */
export function language() {
  return current;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, string>}
 */
const isStrings = (value) => typeof value === 'object' && value !== null && Object.values(value).every((v) => typeof v === 'string');

/**
 * Loads a language, translates the page and remembers the choice if asked.
 * When called again before it finishes, only the last call takes effect.
 * @param {Language} lang
 * @param {{ remember?: boolean }} [options]
 */
export async function setLanguage(lang, { remember = false } = {}) {
  const mine = ++requested;
  const response = await fetch(`i18n/${lang}.json`);
  if (!response.ok) throw new Error(`Cannot load i18n/${lang}.json`);
  /** @type {unknown} */
  const loaded = await response.json();
  if (!isStrings(loaded)) throw new Error(`i18n/${lang}.json is not a table of strings`);
  if (mine !== requested) return;
  strings = loaded;
  current = lang;
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // storage blocked: the choice lasts for this visit
    }
  }
  document.documentElement.lang = lang;
  translate(document);
  for (const listener of listeners) listener(lang);
}

/** @param {(lang: Language) => void} listener */
export function onLanguageChange(listener) {
  listeners.add(listener);
}

/** Whether the interface has a text for this key. @param {string} key */
export function has(key) {
  return Object.hasOwn(strings, key);
}

/**
 * @param {string} key
 * @param {Record<string, string | number>} [params]
 */
export function t(key, params = {}) {
  const template = strings[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

/**
 * Fills elements marked with data-i18n (text) and data-i18n-attr
 * ("attribute:key;attribute:key").
 * @param {ParentNode} root
 */
export function translate(root) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(/** @type {HTMLElement} */ (el).dataset.i18n ?? '');
  }
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    const attrs = /** @type {HTMLElement} */ (el).dataset.i18nAttr ?? '';
    for (const pair of attrs.split(';')) {
      const [attr, key] = pair.split(':');
      if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
    }
  }
}

/** @param {number} km */
export function formatKm(km) {
  const digits = km < 10 ? 1 : 0;
  return `${new Intl.NumberFormat(current, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(km)} km`;
}
