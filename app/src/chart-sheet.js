// The drawing of a Chart (tree-charts spec, "What a Sheet holds"; design.md, "Cards, text,
// symbols and fonts"): one template, written as `h` calls, for the frame, title, ornament, cards, lines, symbols,
// legend of exactly the symbols used, and colophon. Bound to Preact's `h` it draws the screen;
// bound to src/svg-string.js it writes the SVG files and the golden files, so screen and file
// cannot drift apart. Symbols are paths, not font glyphs. Only presentation attributes, never a
// style attribute, so the app's Content-Security-Policy holds.

import { fit, SIZE } from './chart-cards.js';
import { contentArea, fitScale, SHEET } from './chart-pages.js';
import { renderSvg, h as stringH } from './svg-string.js';

/** @typedef {import('./chart-tree-layout.js').ChartLayout} ChartLayout */
/** @typedef {import('./chart-tree-layout.js').LaidCard} LaidCard */
/** @typedef {import('./chart-cards.js').FontMetrics} FontMetrics */
/** @typedef {import('./chart-cards.js').TextLine} TextLine */
/** @typedef {import('./chart-text.js').ChartLabels} ChartLabels */
/** @typedef {import('./types.js').ChartModel} ChartModel */
/** @typedef {(tag: string, props: Record<string, unknown> | null, ...children: unknown[]) => unknown} H */

const INK = '#3b2f22';
const PAPER = '#fffdf6';
const LINE = '#8b1e1e';
const FAINT = '#c9b99a';
const FAMILY = { regular: 'EB Garamond', italic: 'EB Garamond', semibold: 'EB Garamond', title: 'Grenze Gotisch' };

/** The symbols, as paths in a box of 20 by 20 tenths of a millimetre. */
export const SYMBOLS = /** @type {Record<string, string>} */ ({
  birth: 'M10 2V18M3 6L17 14M17 6L3 14',
  baptism: 'M2 12C5 5 8 5 10 10S15 15 18 8',
  marriage: 'M2 10a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0M9 10a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0',
  death: 'M10 1V19M4 6H16',
  burial: 'M4 4H16V16H4Z',
  diedYoung: 'M10 5V15M7 8H13M2 10a8 8 0 1 0 16 0a8 8 0 1 0 -16 0',
  possible: 'M7 7a3 3 0 1 1 4 3v2M10 15v2M2 10a8 8 0 1 0 16 0a8 8 0 1 0 -16 0',
  line: 'M10 2L18 10L10 18L2 10Z',
  pointer: 'M3 10H15M11 6L15 10L11 14',
  continued: 'M3 10H15M11 6L15 10L11 14M3 6V14',
  leftOut: 'M4 6L10 12L16 6M4 11L10 17L16 11',
  bornHere: 'M3 10L10 3L17 10V17H3Z',
  diedHere: 'M10 4V16M6 8H14',
});

/** The legend's entries, in this order, each shown only when the Sheet uses it. */
const LEGEND = [
  'birth',
  'baptism',
  'marriage',
  'death',
  'burial',
  'diedYoung',
  'possible',
  'living',
  'line',
  'nonBirth',
  'weak',
  'pointer',
  'continued',
  'leftOut',
  'bornHere',
  'diedHere',
  'marriedIn',
  'residents',
];

/** The fixed ornament under the title: a rule with a scroll at each end and a lozenge in the middle. */
const ORNAMENT = 'M-300 0H-40M40 0H300M-300 0c-20 -14 -40 -14 -40 0s20 14 32 4M300 0c20 -14 40 -14 40 0s-20 14 -32 4M0 -16L20 0L0 16L-20 0Z';

/**
 * @param {H} h
 * @param {string} kind
 * @param {number} x
 * @param {number} y
 */
function symbol(h, kind, x, y) {
  const d = SYMBOLS[kind];
  if (!d) return null;
  const filled = kind === 'line' || kind === 'bornHere';
  return h('path', {
    d,
    transform: `translate(${x} ${y})`,
    fill: filled ? INK : 'none',
    stroke: INK,
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
}

/**
 * @param {H} h
 * @param {TextLine} l
 */
function text(h, l) {
  return h(
    'text',
    {
      x: l.x,
      y: l.y,
      'font-family': FAMILY[l.face],
      'font-size': l.size,
      'font-weight': l.face === 'semibold' ? 600 : null,
      'font-style': l.face === 'italic' ? 'italic' : null,
      'text-anchor': l.anchor === 'middle' ? 'middle' : null,
      textLength: l.length,
      lengthAdjust: l.length === null ? null : 'spacingAndGlyphs',
      fill: INK,
    },
    l.text,
  );
}

/**
 * The lines and cards of a layout, at its own coordinates.
 * @param {H} h
 * @param {ChartLayout} layout
 */
export function chartBody(h, layout) {
  const lines = layout.lines.map((l) =>
    h('path', {
      key: l.key,
      d: l.d,
      fill: 'none',
      stroke: l.line ? LINE : INK,
      'stroke-width': l.line ? 8 : 3,
      'stroke-dasharray': l.style === 'dashed' ? '14 9' : l.style === 'dotted' ? '3 7' : null,
      'stroke-linecap': l.style === 'dotted' ? 'round' : null,
    }),
  );
  const cards = layout.cards.map((c) => [
    h(
      'g',
      { key: c.key, 'data-card': c.kind, 'data-person': c.personId, 'data-key': c.key, 'data-line': c.onLine ? 'true' : null },
      c.kind === 'list'
        ? null
        : h('rect', {
            x: c.x,
            y: c.y,
            width: c.w,
            height: c.h,
            rx: 10,
            fill: PAPER,
            stroke: c.onLine ? LINE : INK,
            'stroke-width': c.onLine ? 7 : 3,
            'stroke-dasharray': c.dashed ? '14 9' : null,
          }),
      c.lines.map((l) => text(h, l)),
      c.symbols.map((s) => symbol(h, s.kind, s.x, s.y)),
    ),
    // Under a Person whose descendants the Chart leaves out: the mark that opens a Chart from them.
    c.moreBelow && c.personId !== null
      ? h(
          'g',
          { key: `${c.key}#more`, 'data-person': c.personId, 'data-branch': 'true' },
          h('rect', { x: c.x + c.w / 2 - 40, y: c.y + c.h, width: 80, height: 50, fill: PAPER, 'fill-opacity': 0 }),
          symbol(h, 'leftOut', c.x + c.w / 2 - 10, c.y + c.h + 8),
        )
      : null,
  ]);
  return [h('g', { 'data-layer': 'lines' }, lines), h('g', { 'data-layer': 'cards' }, cards)];
}

/**
 * The legend: each symbol and mark the Sheet uses, with its meaning.
 * @param {H} h
 * @param {FontMetrics} metrics
 * @param {ChartLabels} labels
 * @param {string[]} used
 * @param {number} x
 * @param {number} y
 * @param {number} width
 */
function legend(h, metrics, labels, used, x, y, width) {
  const entries = LEGEND.filter((k) => used.includes(k));
  const col = 560;
  const perRow = Math.max(1, Math.floor(width / col));
  return entries.map((k, i) => {
    const ex = x + (i % perRow) * col;
    const ey = y + Math.floor(i / perRow) * 40;
    const sample =
      k === 'line' || k === 'nonBirth' || k === 'weak'
        ? h('path', {
            d: `M${ex} ${ey - 8}H${ex + 40}`,
            stroke: k === 'line' ? LINE : INK,
            'stroke-width': k === 'line' ? 8 : 3,
            'stroke-dasharray': k === 'nonBirth' ? '14 9' : k === 'weak' ? '3 7' : null,
            fill: 'none',
          })
        : k === 'living' || k === 'marriedIn' || k === 'residents'
          ? null
          : symbol(h, k, ex + 10, ey - 18);
    const label = fit(metrics, 'regular', SIZE.small, labels.t(`chart.legend.${k}`), col - 70);
    return h('g', { key: k, 'data-legend': k }, sample, text(h, { ...label, face: 'regular', size: SIZE.small, x: ex + 54, y: ey, anchor: 'start' }));
  });
}

/**
 * The colophon: Rodokmen, the state of the Tree, the day of the Living rule, the Sources, the sheet's number.
 * @param {H} h
 * @param {FontMetrics} metrics
 * @param {ChartLabels} labels
 * @param {ChartModel} model
 * @param {{ x: number, y: number, w: number, number: number, of: number }} at
 */
function colophon(h, metrics, labels, model, at) {
  const asOf = model.asOf.acceptedAt === null ? labels.t('chart.colophon.empty') : labels.date(model.asOf.acceptedAt.slice(0, 10));
  const first = labels.t('chart.colophon.made', { asOf, livingOn: labels.date(model.livingOn) });
  const sources = model.sources.length === 0 ? '' : labels.t('chart.colophon.sources', { sources: model.sources.map((s) => s.title).join('; ') });
  const lines = [first, ...wrap(metrics, sources, at.w)].slice(0, 4);
  return [
    ...lines.map((l, i) =>
      text(h, { ...fit(metrics, 'italic', SIZE.small, l, at.w), face: 'italic', size: SIZE.small, x: at.x, y: at.y + 32 * i, anchor: 'start' }),
    ),
    at.of > 1
      ? text(h, {
          text: labels.t('chart.sheetOf', { n: at.number, of: at.of }),
          length: null,
          face: 'regular',
          size: SIZE.small,
          x: at.x + at.w,
          y: at.y,
          anchor: 'start',
        })
      : null,
  ];
}

/** Words into lines of at most `width`. @param {FontMetrics} metrics @param {string} s @param {number} width */
function wrap(metrics, s, width) {
  if (!s) return [];
  /** @type {string[]} */
  const out = [];
  let line = '';
  for (const word of s.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && fit(metrics, 'italic', SIZE.small, next, width).text !== next) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/**
 * One Sheet: the frame, the title and ornament, the Chart at its scale, the legend and the colophon.
 * @param {H} h
 * @param {{ model: ChartModel, layout: ChartLayout, metrics: FontMetrics, labels: ChartLabels, title: string, size: { w: number, h: number }, scale?: number, number?: number, of?: number, fontCss?: string }} o
 */
export function sheet(h, o) {
  sheetOnly(o.model);
  const { size, layout, metrics, labels, model } = o;
  const area = contentArea(size);
  const scale = o.scale ?? fitScale(layout, area);
  const ox = Math.round(area.x + (area.w - layout.width * scale) / 2);
  const m = SHEET.margin;
  const titleY = m + SHEET.inset + 110;
  const title = fit(metrics, 'title', SIZE.title, o.title, size.w - 2 * (m + SHEET.inset));
  const footY = size.h - m - SHEET.inset - SHEET.footer + 60;
  const half = Math.round((size.w - 2 * (m + SHEET.inset)) / 2);
  return h(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width: `${size.w / 10}mm`,
      height: `${size.h / 10}mm`,
      viewBox: `0 0 ${size.w} ${size.h}`,
      'data-sheet': String(o.number ?? 1),
    },
    o.fontCss ? h('style', null, o.fontCss) : null,
    h('rect', { x: 0, y: 0, width: size.w, height: size.h, fill: PAPER }),
    h('rect', { x: m, y: m, width: size.w - 2 * m, height: size.h - 2 * m, fill: 'none', stroke: INK, 'stroke-width': 8 }),
    h('rect', { x: m + 18, y: m + 18, width: size.w - 2 * m - 36, height: size.h - 2 * m - 36, fill: 'none', stroke: FAINT, 'stroke-width': 3 }),
    text(h, { ...title, face: 'title', size: SIZE.title, x: Math.round(size.w / 2), y: titleY, anchor: 'middle' }),
    h('path', { d: ORNAMENT, transform: `translate(${Math.round(size.w / 2)} ${titleY + 50})`, fill: 'none', stroke: INK, 'stroke-width': 3 }),
    h('g', { transform: `translate(${ox} ${area.y}) scale(${scale.toFixed(3)})`, 'data-layer': 'chart' }, chartBody(h, layout)),
    h('g', { 'data-layer': 'legend' }, legend(h, metrics, labels, layout.symbols, m + SHEET.inset, footY, half - 40)),
    h(
      'g',
      { 'data-layer': 'colophon' },
      colophon(h, metrics, labels, model, { x: m + SHEET.inset + half, y: footY, w: half - 120, number: o.number ?? 1, of: o.of ?? 1 }),
    ),
  );
}

/** The size of a Sheet that holds a whole Chart at full size, for the SVG and PNG files. @param {ChartLayout} layout */
export function naturalSize(layout) {
  const side = 2 * (SHEET.margin + SHEET.inset);
  return { w: Math.max(2100, layout.width + side), h: layout.height + side + SHEET.header + SHEET.footer };
}

/**
 * A model that is not a Sheet's carries Living people unreduced, and may carry kinship, so no
 * Sheet, print or file is made from it.
 */
export class NotASheet extends Error {
  constructor(message = 'A Sheet is drawn only from the Sheet variant of a Chart (sheet=reduced or sheet=nameless).') {
    super(message);
    this.name = 'NotASheet';
  }
}

/**
 * Refuses a model that may not become a Sheet: the screen variant, and any model whose cards
 * carry kinship, which a Sheet never shows (tree-charts spec, "Kinship on Chart cards"). Print,
 * the SVG file and the PNG all pass here.
 * @param {ChartModel} model
 */
function sheetOnly(model) {
  if (model.sheet === null) throw new NotASheet();
  if (model.persons.some((p) => 'kinship' in p)) throw new NotASheet('A Sheet never shows kinship: this model carries it.');
}

/**
 * The SVG file of a Chart: the whole Chart at its natural size, with its fonts embedded.
 * @param {{ model: ChartModel, layout: ChartLayout, metrics: FontMetrics, labels: ChartLabels, title: string, fontCss: string }} o
 */
export function sheetFile(o) {
  sheetOnly(o.model);
  const size = naturalSize(o.layout);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${renderSvg(sheet(/** @type {H} */ (stringH), { ...o, size, scale: 1 }))}\n`;
}
