// The words of kinship (kinship spec): a path or a short form as the app says it, in one
// language. The reader's own Person is "vy", a possible path "možná …", through i18n keys and
// never by joining words. Pure, so that the cards of a Chart (src/chart-text.js) say it with the
// Chart's labels exactly as the person page and the lists say it (src/kinship.js).

/** @typedef {import('./types.js').KinshipTerm} KinshipTerm */
/** @typedef {import('./i18n.js').Language} Language */

/**
 * @param {{ kind: string, term: KinshipTerm, possible: boolean }} k
 * @param {(key: string, params?: Record<string, string | number>) => string} tr the texts of the language
 * @param {Language} lang
 */
export function kinshipWords(k, tr, lang) {
  if (k.kind === 'self') return tr('kinship.you');
  const term = k.term[lang].text;
  return k.possible ? tr('kinship.possibly', { term }) : term;
}
