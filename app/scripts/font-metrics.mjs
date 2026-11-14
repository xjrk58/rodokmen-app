#!/usr/bin/env node
// Writes app/data/chart-fonts.json: the advance width, in font units, of every character a Chart
// may draw, in each face of scripts/lib/chart-fonts.mjs, read with fontkit from the vendored WOFF2
// files that app/styles.css declares. Charts fit text by this table and never measure it in the
// browser, so a Chart comes out the same on every device. The characters: printable ASCII, every
// letter of Czech, Slovak and German, every character of app/i18n/*.json and a few typographic
// marks. A face that lacks one leaves it out, and the app takes the face's `fallback` (the width
// of "n"). Widths are per character, without kerning.
//
// Run it after vendoring other fonts or adding characters to app/i18n/:
// `pnpm --filter @rodokmen/app font-metrics`. tests/unit/chart-fonts.test.mjs fails while the
// committed file differs from what this writes.
//
//   node scripts/font-metrics.mjs             write app/data/chart-fonts.json
//   node scripts/font-metrics.mjs --out FILE  write FILE instead
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openSync } from 'fontkit';
import { FACES, fontFaceRules, LETTERS } from './lib/chart-fonts.mjs';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Typographic marks a Chart may draw besides the letters and the translations. */
const MARKS = '–—…’‘„“«»·°×⚭†';

/**
 * @typedef {import('fontkit').Font} Font
 * @typedef {import('./lib/chart-fonts.mjs').Face & { fonts: { font: Font, ranges: [number, number][] }[] }} LoadedFace
 */

/**
 * The faces with their vendored files as app/styles.css declares them, each face's files in the
 * order a browser tries them where their unicode ranges overlap: the last rule declared first
 * (CSS Fonts 4, "Font Matching").
 * @param {string} [appDir]
 * @returns {Promise<Record<keyof typeof FACES, LoadedFace>>}
 */
export async function loadFaces(appDir = APP_DIR) {
  const rules = fontFaceRules(await readFile(join(appDir, 'styles.css'), 'utf8'));
  /** @param {import('./lib/chart-fonts.mjs').Face} face @returns {LoadedFace} */
  const load = (face) => {
    const own = rules.filter((r) => r.family === face.family && r.weight === face.weight && r.style === face.style);
    if (own.length === 0) throw new Error(`styles.css declares no @font-face for ${face.family} ${face.weight} ${face.style}`);
    const fonts = own.reverse().map((r) => {
      if (!/^vendor\/fonts\/[^:]+\.woff2$/.test(r.url)) throw new Error(`${face.family}: expected a WOFF2 file in vendor/fonts/, found ${r.url}`);
      return { font: openSync(join(appDir, r.url)), ranges: r.ranges };
    });
    return { ...face, fonts };
  };
  return { regular: load(FACES.regular), italic: load(FACES.italic), semibold: load(FACES.semibold), title: load(FACES.title) };
}

/**
 * The advance width of a code point in a face, as a browser draws it: from the first of the
 * face's files whose unicode range covers it and that has a glyph for it. Null when none has.
 * @param {LoadedFace} face
 * @param {number} codePoint
 */
export function advanceOf(face, codePoint) {
  for (const { font, ranges } of face.fonts) {
    if (ranges.some(([lo, hi]) => lo <= codePoint && codePoint <= hi) && font.hasGlyphForCodePoint(codePoint)) {
      return font.glyphForCodePoint(codePoint).advanceWidth;
    }
  }
  return null;
}

/**
 * Every string in a parsed translation file.
 * @param {unknown} value
 * @returns {string[]}
 */
const stringsIn = (value) =>
  typeof value === 'string'
    ? [value]
    : typeof value === 'object' && value !== null
      ? Object.values(/** @type {Record<string, unknown>} */ (value)).flatMap(stringsIn)
      : [];

/**
 * The characters to measure, without control characters.
 * @param {string} appDir
 */
async function characters(appDir) {
  /** @type {Set<string>} */
  const chars = new Set();
  for (let c = 0x20; c <= 0x7e; c++) chars.add(String.fromCodePoint(c));
  for (const c of LETTERS + MARKS) chars.add(c);
  const i18n = join(appDir, 'i18n');
  for (const file of (await readdir(i18n)).filter((f) => f.endsWith('.json')).sort()) {
    for (const text of stringsIn(JSON.parse(await readFile(join(i18n, file), 'utf8')))) for (const c of text) chars.add(c);
  }
  return [...chars].filter((c) => !/\p{Cc}/u.test(c));
}

/**
 * Object keys in code unit order, which for these keys (all in the Basic Multilingual Plane) is
 * code point order.
 * @param {string} a
 * @param {string} b
 */
const inCodeOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * JSON with two spaces of indent and every object's keys in code point order. JSON.stringify
 * cannot do this: it writes integer-like keys such as "0" to "9" before all others.
 * @param {unknown} value
 * @param {string} [indent]
 * @returns {string}
 */
function sortedJson(value, indent = '') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return JSON.stringify(value);
  const record = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(record).sort(inCodeOrder);
  if (keys.length === 0) return '{}';
  const inner = `${indent}  `;
  return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${sortedJson(record[k], inner)}`).join(',\n')}\n${indent}}`;
}

/**
 * The text of app/data/chart-fonts.json for the fonts, styles.css and translations in `appDir`.
 * @param {string} [appDir]
 */
export async function chartFontsJson(appDir = APP_DIR) {
  const loaded = await loadFaces(appDir);
  const chars = await characters(appDir);
  /** @type {Record<string, unknown>} */
  const faces = {};
  for (const [key, face] of Object.entries(loaded)) {
    const units = new Set(face.fonts.map((f) => f.font.unitsPerEm));
    if (units.size !== 1) throw new Error(`${key}: the files disagree on unitsPerEm (${[...units].join(', ')})`);
    /** @type {Record<string, number>} */
    const advances = {};
    for (const c of chars) {
      const cp = /** @type {number} */ (c.codePointAt(0));
      const advance = advanceOf(face, cp);
      if (advance === null) continue;
      // The subsets are cut from one font, so a glyph two files share must have one width.
      const widths = new Set(face.fonts.filter((f) => f.font.hasGlyphForCodePoint(cp)).map((f) => f.font.glyphForCodePoint(cp).advanceWidth));
      if (widths.size !== 1 || !Number.isInteger(advance)) throw new Error(`${key}: U+${cp.toString(16)} has the widths ${[...widths].join(', ')}`);
      advances[c] = advance;
    }
    const fallback = advances.n;
    if (fallback === undefined) throw new Error(`${key}: no glyph for "n"`);
    faces[key] = { family: face.family, weight: face.weight, style: face.style, unitsPerEm: [...units][0], fallback, advances };
  }
  return `${sortedJson({ faces })}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  const out = values.out ? resolve(values.out) : join(APP_DIR, 'data', 'chart-fonts.json');
  await writeFile(out, await chartFontsJson());
  console.log(`Wrote the widths of the Chart fonts to ${out}`);
}
