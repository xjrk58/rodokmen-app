// Text helpers shared by the browser and the data build script.

/**
 * Letters that Unicode does not decompose into a base letter and marks, folded
 * as PostgreSQL's unaccent folds them. The same table as foldForSearch in
 * shared/src/text.ts (the server's search), so a name matches the same way in
 * the map's search and the Tree's; tests/unit/text.test.mjs compares the two.
 * @type {Readonly<Record<string, string>>}
 */
const LETTERS = {
  æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', ŀ: 'l', ɫ: 'l', đ: 'd', ð: 'd', þ: 'th', ħ: 'h', ı: 'i', ŧ: 't', ŋ: 'n',
  ĸ: 'q', ß: 'ss', ſ: 's', ƒ: 'f', ĳ: 'ij', ǆ: 'dz', ǉ: 'lj', ǌ: 'nj', ﬁ: 'fi', ﬂ: 'fl', ŉ: "'n",
};
const LETTER = new RegExp(`[${Object.keys(LETTERS).join('')}]`, 'gu');

/**
 * Folds a name or query for matching: lower case, no diacritics (as
 * foldForSearch in shared/), and then, unlike foldForSearch, dashes and every
 * kind of space become one space. The gazetteer needs that: "Frýdek-Místek"
 * and "Brandýs nad Labem - Stará Boleslav" must match "frydek mistek" and
 * "brandys nad labem stara boleslav".
 * @param {string} text
 * @returns {string}
 */
export function normalize(text) {
  return text
    .toLowerCase()
    .replace(LETTER, (letter) => LETTERS[letter] ?? letter)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[\s\-‐-―]+/g, ' ')
    .trim();
}

/** Czech collation, so "Ch" sorts after "H" and "Š" after "S". */
export const czechCollator = new Intl.Collator('cs', { sensitivity: 'base' });

/**
 * Bytes as lower-case hexadecimal, two digits each.
 * @param {Uint8Array} bytes
 */
export function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A URL template with the Municipality name filled in: every "{name}" becomes the encoded name.
 * @param {string} template
 * @param {string} name
 */
export function withName(template, name) {
  return template.replaceAll('{name}', encodeURIComponent(name));
}
