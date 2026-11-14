// The fonts of the Charts (add-tree-charts, design "Cards, text, symbols and fonts"): the faces,
// the Fontsource files each comes from, the letters every face must have, and a reader for the
// @font-face rules of app/styles.css. Used by scripts/vendor-fonts.mjs, scripts/font-metrics.mjs
// and tests/unit/chart-fonts.test.mjs.

/**
 * @typedef {{ family: string, package: string, weight: number, style: 'normal' | 'italic' }} Face
 * @typedef {{ family: string, weight: number, style: string, display: string, url: string, ranges: [number, number][] }} FontFaceRule
 */

/**
 * The faces of a Chart, by their key in app/data/chart-fonts.json; `package` is the Fontsource package.
 * @type {Record<'regular' | 'italic' | 'semibold' | 'title', Face>}
 */
export const FACES = {
  regular: { family: 'EB Garamond', package: 'eb-garamond', weight: 400, style: 'normal' },
  italic: { family: 'EB Garamond', package: 'eb-garamond', weight: 400, style: 'italic' },
  semibold: { family: 'EB Garamond', package: 'eb-garamond', weight: 600, style: 'normal' },
  title: { family: 'Grenze Gotisch', package: 'grenze-gotisch', weight: 400, style: 'normal' },
};

/** The Fontsource subsets vendored, in the order styles.css declares them, as Fontsource's own CSS does. */
export const SUBSETS = ['latin-ext', 'latin'];

/**
 * Where a face's file of one subset is vendored, relative to app/, under Fontsource's file name.
 * @param {Face} face
 * @param {string} subset
 */
export const fontFile = (face, subset) => `vendor/fonts/${face.package}/${face.package}-${subset}-${face.weight}-${face.style}.woff2`;

/** The lower-case alphabets of Czech, Slovak and German. */
const ALPHABETS = ['aábcčdďeéěfghiíjklmnňoópqrřsštťuúůvwxyýzž', 'aáäbcčdďeéfghiíjklĺľmnňoóôpqrŕsštťuúvwxyýzž', 'abcdefghijklmnopqrstuvwxyzäöüß'].join('');

/** Every letter of those alphabets in both cases, sorted; ẞ by hand, since 'ß'.toUpperCase() is 'SS'. */
export const LETTERS = [...new Set([...ALPHABETS, ...ALPHABETS.toUpperCase(), 'ẞ'])].sort().join('');

/**
 * The @font-face rules of a style sheet, in the order it declares them. Only what Fontsource's
 * CSS and app/styles.css use: one `url()` source, and `unicode-range` as single code points or
 * ranges (no wildcards). A rule without `unicode-range` covers every code point.
 * @param {string} css
 * @returns {FontFaceRule[]}
 */
export function fontFaceRules(css) {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body = '']) => {
    /** @param {string} name */
    const value = (name) => new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(body)?.[1]?.trim() ?? '';
    const url = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(value('src'))?.[1] ?? '';
    const range = value('unicode-range');
    /** @type {[number, number][]} */
    const ranges =
      range === ''
        ? [[0, 0x10ffff]]
        : range.split(',').map((r) => {
            const m = /^\s*U\+([0-9A-F]{1,6})(?:-([0-9A-F]{1,6}))?\s*$/i.exec(r);
            if (!m?.[1]) throw new Error(`Unsupported unicode-range part: ${r}`);
            return [parseInt(m[1], 16), parseInt(m[2] ?? m[1], 16)];
          });
    return {
      family: value('font-family').replace(/^['"]|['"]$/g, ''),
      weight: Number(value('font-weight')),
      style: value('font-style'),
      display: value('font-display'),
      url,
      ranges,
    };
  });
}
