// Interface strings in Czech and English. The language comes from the
// reader's choice (kept in localStorage), else navigator.language, else English.

export const LANGUAGES = /** @type {const} */ (['cs', 'en']);
/** @typedef {typeof LANGUAGES[number]} Language */

const STORAGE_KEY = 'rodokmen.language';

/** @type {Record<string, string>} */
let strings = {};
/** @type {Language} */
let current = 'en';
/** @type {Set<(lang: Language) => void>} */
const listeners = new Set();

/**
 * @param {string | null | undefined} value
 * @returns {value is Language}
 */
function isLanguage(value) {
  return LANGUAGES.includes(/** @type {Language} */ (value));
}

/** @returns {Language} */
export function detectLanguage() {
  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // storage blocked
  }
  if (isLanguage(stored)) return stored;
  const browser = (navigator.language || 'en').toLowerCase();
  return browser === 'cs' || browser.startsWith('cs-') ? 'cs' : 'en';
}

/** @returns {Language} */
export function language() {
  return current;
}

/**
 * Loads a language, translates the page and remembers the choice if asked.
 * @param {Language} lang
 * @param {{ remember?: boolean }} [options]
 */
export async function setLanguage(lang, { remember = false } = {}) {
  const response = await fetch(`i18n/${lang}.json`);
  if (!response.ok) throw new Error(`Cannot load i18n/${lang}.json`);
  strings = await response.json();
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
    for (const pair of (/** @type {HTMLElement} */ (el).dataset.i18nAttr ?? '').split(';')) {
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
