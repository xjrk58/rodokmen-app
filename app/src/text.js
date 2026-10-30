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
