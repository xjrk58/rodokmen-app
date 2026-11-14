// The drawing of a Sheet (src/chart-sheet.js, src/svg-string.js): golden SVG files in Czech and
// English, rewritten only with UPDATE_GOLDEN=1; the legend, the colophon, the two languages, the
// refusal of a screen variant, and the fonts the file carries. The golden files hold the fonts'
// rules as FONTS, replaced by the real rules (fontFaceCss of the vendored files) in a download.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fontFaceCss, FONT_FILES } from '../../src/chart-fonts.js';
import { layoutHouse } from '../../src/chart-house-layout.js';
import { layoutLine } from '../../src/chart-line-layout.js';
import { NotASheet, sheetFile } from '../../src/chart-sheet.js';
import { chartLabels, defaultTitle } from '../../src/chart-text.js';
import { layoutTree } from '../../src/chart-tree-layout.js';
import { fontMetrics, goldenHouse, goldenTree, NOVAK, novakChart, texts } from './chart-models.mjs';
import { APP } from './helpers.mjs';

/** @typedef {import('../../src/types.js').ChartModel} ChartModel */

const GOLDEN = join(APP, 'tests', 'unit', 'golden', 'charts');
/** The fonts' rules in a golden file; a download carries the real ones. */
export const FONTS = '/*FONTS*/';
const metrics = await fontMetrics();
const strings = { cs: await texts('cs'), en: await texts('en') };

/**
 * The SVG file of a Sheet in a language.
 * @param {ChartModel} model
 * @param {'cs' | 'en'} lang
 * @param {string} [fontCss]
 */
export function svgOf(model, lang, fontCss = FONTS) {
  const labels = chartLabels(strings[lang], lang);
  const layout =
    model.kind === 'house'
      ? layoutHouse(model, metrics, labels)
      : model.form === 'line'
        ? layoutLine(model, metrics, labels)
        : layoutTree(model, metrics, labels);
  return sheetFile({ model, layout, metrics, labels, title: defaultTitle(labels, model), fontCss });
}

/** @param {string} name @param {string} svg */
function golden(name, svg) {
  const file = join(GOLDEN, `${name}.svg`);
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(file, svg);
    return;
  }
  assert.ok(existsSync(file), `${file} is missing: run with UPDATE_GOLDEN=1`);
  assert.equal(svg, readFileSync(file, 'utf8'), name);
}

/** @type {Array<[string, () => Promise<ChartModel> | ChartModel]>} */
const SHEETS = [
  ['novak-tree-reduced', () => goldenTree('novak-tree-reduced')],
  ['novak-tree-nameless', () => goldenTree('novak-tree-nameless')],
  ['novak-line-reduced', () => novakChart({ form: 'line', line: NOVAK.petr, sheet: 'reduced' })],
  ['house-a-sheet', () => goldenHouse('house-a-sheet')],
];

test('the golden SVG files, in Czech and English', async () => {
  for (const [name, make] of SHEETS) for (const lang of /** @type {const} */ (['cs', 'en'])) golden(`${name}.${lang}`, svgOf(await make(), lang));
});

test('"Two languages": the Czech and English files differ only in their text', async () => {
  // Text nodes, and the width a text is squeezed to, are the language's; every card, line and place is not.
  const shape = (/** @type {string} */ svg) => svg.replace(/>[^<]*</g, '><').replace(/ (lengthAdjust|textLength)="[^"]*"/g, '');
  for (const [name, make] of SHEETS) {
    const model = await make();
    assert.equal(shape(svgOf(model, 'cs')), shape(svgOf(model, 'en')), name);
    assert.notEqual(svgOf(model, 'cs'), svgOf(model, 'en'), name);
  }
});

test('"Legend": exactly the symbols and marks the Sheet uses', async () => {
  const legend = (/** @type {string} */ svg) => [...svg.matchAll(/data-legend="([^"]+)"/g)].map((m) => m[1]);
  const tree = svgOf(await goldenTree('novak-tree-reduced'), 'cs');
  // Anna died at two: the mark is there; the line form has no child who died young.
  assert.ok(legend(tree).includes('diedYoung'));
  assert.ok(legend(tree).includes('nonBirth'));
  const line = svgOf(novakChart({ form: 'line', line: NOVAK.petr, sheet: 'reduced', generations: 4 }), 'cs');
  const noYoung = svgOf(await goldenHouse('house-a-sheet'), 'cs');
  for (const svg of [line, noYoung]) {
    const used = legend(svg);
    for (const kind of used) assert.ok(svg.includes(`data-legend="${kind}"`));
  }
  // Every legend entry stands for something drawn.
  for (const kind of legend(tree).filter((k) => !['living', 'residents', 'line', 'nonBirth', 'weak', 'marriedIn'].includes(k)))
    assert.match(tree, new RegExp(`d="[^"]+" fill="(none|#3b2f22)"`), kind);
  assert.ok(legend(noYoung).includes('residents'), 'a House chart says its rows are residents');
  assert.ok(!legend(noYoung).includes('diedYoung'));
});

test('"Colophon": Rodokmen, the state of the Tree, the day of the Living rule, and the Sources of the facts shown', async () => {
  const svg = svgOf(await goldenTree('novak-tree-reduced'), 'en');
  assert.match(svg, /Made by Rodokmen from the Tree as of 13 Nov 2026; Living people as of 14 Nov 2026\./);
  assert.match(svg, /Sources: Matrika N Kamenná Lhota 1784–1850; Sčítání lidu 1869/);
});

test('"Living grandchild" and "Names left off": no Sheet file holds a Living person\'s birth day or Place', async () => {
  const reduced = svgOf(await goldenTree('novak-tree-reduced'), 'cs');
  assert.match(reduced, />Petr Novák</);
  assert.match(reduced, />2010</);
  assert.doesNotMatch(reduced, /3\. 5\. 2010/);
  const nameless = svgOf(await goldenTree('novak-tree-nameless'), 'cs');
  assert.doesNotMatch(nameless, /Petr/);
  assert.match(nameless, />žijící osoba</);
});

test('the SVG writer refuses a model that is not a Sheet', async () => {
  const screen = await goldenTree('novak-tree-4');
  assert.throws(() => svgOf(screen, 'cs'), NotASheet);
});

test('a file carries the fonts styles.css declares, as data: WOFF2', () => {
  const css = readFileSync(join(APP, 'styles.css'), 'utf8');
  const declared = [
    ...css.matchAll(
      /@font-face \{[^}]*?font-family: '([^']+)';\s*font-style: (\w+);[^}]*?font-weight: (\d+);\s*src: url\(([^)]+)\)[^}]*?unicode-range:([^;]+);/g,
    ),
  ].map((m) => [m[1], m[2], Number(m[3]), m[4], m[5].split(/\s+/).join(' ').trim()]);
  assert.deepEqual(
    declared,
    FONT_FILES.map((f) => [...f]),
  );
  const files = FONT_FILES.map(([, , , path]) => readFileSync(join(APP, path)).toString('base64'));
  const withFonts = fontFaceCss(files);
  assert.equal((withFonts.match(/@font-face/g) ?? []).length, 8);
  assert.ok(withFonts.includes("font-family:'Grenze Gotisch'"));
});
