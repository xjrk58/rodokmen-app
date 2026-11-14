// The Chart's fonts (design.md, "Cards, text, symbols and fonts"): the table of advance widths
// that text is fitted by (data/chart-fonts.json), and the @font-face rules an SVG file carries
// with the fonts inside it as data: WOFF2, so that it shows the same fonts on a computer without
// them. The files are those styles.css declares; tests/unit/chart-sheet.test.mjs checks the two agree.

/** @typedef {import('./chart-cards.js').FontMetrics} FontMetrics */

const LATIN_EXT =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';
const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

/** Every face and subset, in the order styles.css declares them. */
export const FONT_FILES = /** @type {const} */ ([
  ['EB Garamond', 'normal', 400, 'vendor/fonts/eb-garamond/eb-garamond-latin-ext-400-normal.woff2', LATIN_EXT],
  ['EB Garamond', 'normal', 400, 'vendor/fonts/eb-garamond/eb-garamond-latin-400-normal.woff2', LATIN],
  ['EB Garamond', 'italic', 400, 'vendor/fonts/eb-garamond/eb-garamond-latin-ext-400-italic.woff2', LATIN_EXT],
  ['EB Garamond', 'italic', 400, 'vendor/fonts/eb-garamond/eb-garamond-latin-400-italic.woff2', LATIN],
  ['EB Garamond', 'normal', 600, 'vendor/fonts/eb-garamond/eb-garamond-latin-ext-600-normal.woff2', LATIN_EXT],
  ['EB Garamond', 'normal', 600, 'vendor/fonts/eb-garamond/eb-garamond-latin-600-normal.woff2', LATIN],
  ['Grenze Gotisch', 'normal', 400, 'vendor/fonts/grenze-gotisch/grenze-gotisch-latin-ext-400-normal.woff2', LATIN_EXT],
  ['Grenze Gotisch', 'normal', 400, 'vendor/fonts/grenze-gotisch/grenze-gotisch-latin-400-normal.woff2', LATIN],
]);

/**
 * The @font-face rules of an SVG file, each font as data: WOFF2, in a fixed order.
 * @param {readonly string[]} base64 the files of FONT_FILES, in its order
 */
export function fontFaceCss(base64) {
  return FONT_FILES.map(
    ([family, style, weight, , range], i) =>
      `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};src:url(data:font/woff2;base64,${base64[i] ?? ''}) format('woff2');unicode-range:${range}}`,
  ).join('');
}

/** @type {Promise<FontMetrics> | null} */
let metrics = null;

/** The advance widths of the fonts, loaded once (precached, so also offline). @returns {Promise<FontMetrics>} */
export function loadMetrics() {
  metrics ??= fetch('data/chart-fonts.json').then(async (r) => {
    if (!r.ok) throw new Error('The Chart fonts table could not be loaded.');
    /** @type {unknown} */
    const table = await r.json();
    return /** @type {FontMetrics} */ (table);
  });
  return metrics;
}

/** @param {ArrayBuffer} buffer */
function base64Of(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The @font-face rules with the fonts inside, for an SVG file. */
export async function loadFontCss() {
  const files = await Promise.all(
    FONT_FILES.map(async ([, , , path]) => {
      const r = await fetch(path);
      if (!r.ok) throw new Error(`The font ${path} could not be loaded.`);
      return base64Of(await r.arrayBuffer());
    }),
  );
  return fontFaceCss(files);
}
