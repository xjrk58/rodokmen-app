/**
 * Letters that Unicode does not decompose into a base letter and marks, folded the way
 * PostgreSQL's unaccent folds them. Keys are lower case.
 */
const LETTERS: Readonly<Record<string, string>> = {
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  ŀ: 'l',
  ɫ: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ħ: 'h',
  ı: 'i',
  ŧ: 't',
  ŋ: 'n',
  ĸ: 'q',
  ß: 'ss',
  ſ: 's',
  ƒ: 'f',
  ĳ: 'ij',
  ǆ: 'dz',
  ǉ: 'lj',
  ǌ: 'nj',
  ﬁ: 'fi',
  ﬂ: 'fl',
  ŉ: "'n",
};
const LETTER = new RegExp(`[${Object.keys(LETTERS).join('')}]`, 'gu');

/**
 * What `\s` matches in PostgreSQL's regular expressions (with the PostGIS image's locale). Unlike
 * JavaScript's `\s` it leaves no-break spaces (U+00A0, U+2007, U+202F) and U+FEFF alone.
 */
const WHITESPACE = /[\t\n\v\f\r \u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]+/g;

/**
 * Search normalisation: lower case, no diacritics, runs of whitespace as one space, trimmed.
 *
 * The definition is the database's `rdk_fold()` (migration 0001), which backs the stored
 * `search_text` columns and their indexes; the server folds search input with it in SQL. This
 * is its mirror for code without a database (rdk_fold does not trim). server/test/fold.test.ts
 * checks that the two agree.
 */
export function foldForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(LETTER, (letter) => LETTERS[letter] ?? letter)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(WHITESPACE, ' ')
    .replace(/^ | $/g, '');
}
