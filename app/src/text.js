// Text helpers shared by the browser and the data build script.

/**
 * Folds a name or query for matching: no diacritics, lower case, dashes and
 * runs of whitespace become one space. "Brandýs nad Labem - Stará Boleslav"
 * becomes "brandys nad labem stara boleslav".
 * @param {string} text
 * @returns {string}
 */
export function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[\s\-‐-―]+/g, ' ')
    .trim();
}

/** Czech collation, so "Ch" sorts after "H" and "Š" after "S". */
export const czechCollator = new Intl.Collator('cs', { sensitivity: 'base' });
