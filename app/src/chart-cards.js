// The cards of a Chart (tree-charts spec, "What a card shows", "Marks on cards"): their sizes,
// their text slots, and text fitted by the bundled fonts' advance widths (app/data/chart-fonts.json),
// never measured in the browser, so every device fits a name the same way. All lengths are whole
// numbers in tenths of a millimetre.

/** @typedef {import('./types.js').ChartPerson} ChartPerson */
/** @typedef {import('./chart-text.js').ChartLabels} ChartLabels */
/** @typedef {{ family: string, weight: number, style: string, unitsPerEm: number, fallback: number, advances: Record<string, number> }} FontFace */
/** @typedef {{ faces: Record<'regular' | 'italic' | 'semibold' | 'title', FontFace> }} FontMetrics */
/** @typedef {'regular' | 'italic' | 'semibold' | 'title'} Face */
/** @typedef {{ text: string, face: Face, size: number, x: number, y: number, length: number | null, anchor: 'start' | 'middle' }} TextLine */
/** @typedef {{ kind: string, x: number, y: number }} SymbolMark */

/** Card sizes per kind. */
export const CARD = { w: 420, h: 230 };
export const SMALL = { w: 400, line: 32, head: 70 };
/** Text sizes: a name is 9 points (32 tenths of a millimetre), a fact 7 points. */
export const SIZE = { name: 32, fact: 25, small: 23, title: 90, heading: 34 };
const PAD = 16;
/** A name may be set up to 15 % narrower before it is cut. */
const SQUEEZE = 0.85;

/**
 * The width of a text in tenths of a millimetre at a size, by the face's advance widths.
 * @param {FontMetrics} metrics
 * @param {Face} face
 * @param {number} size
 * @param {string} text
 */
export function measure(metrics, face, size, text) {
  const f = metrics.faces[face];
  let units = 0;
  for (const ch of text) units += f.advances[ch] ?? f.fallback;
  return (units * size) / f.unitsPerEm;
}

/**
 * A text that fits a width: as it is, up to 15 % narrower (`length` for the SVG's textLength),
 * or cut with "…" until it fits that way.
 * @param {FontMetrics} metrics
 * @param {Face} face
 * @param {number} size
 * @param {string} text
 * @param {number} width
 * @returns {{ text: string, length: number | null }}
 */
export function fit(metrics, face, size, text, width) {
  const w = measure(metrics, face, size, text);
  if (w <= width) return { text, length: null };
  if (w * SQUEEZE <= width) return { text, length: Math.floor(width) };
  const chars = [...text];
  for (let n = chars.length - 1; n > 0; n--) {
    const cut = `${chars.slice(0, n).join('').trimEnd()}…`;
    const cw = measure(metrics, face, size, cut);
    if (cw <= width) return { text: cut, length: null };
    if (cw * SQUEEZE <= width) return { text: cut, length: Math.floor(width) };
  }
  return { text: '…', length: null };
}

/**
 * A line of text fitted to a width, placed at (x, y).
 * @param {FontMetrics} metrics
 * @param {Face} face
 * @param {number} size
 * @param {string} text
 * @param {number} width
 * @param {number} x
 * @param {number} y baseline
 * @param {'start' | 'middle'} [anchor]
 * @returns {TextLine}
 */
export function textLine(metrics, face, size, text, width, x, y, anchor = 'start') {
  return { ...fit(metrics, face, size, text, width), face, size, x: Math.round(x), y: Math.round(y), anchor };
}

/**
 * A name in up to two lines: one when it fits, else given names on the first and the rest on
 * the second, each fitted.
 * @param {FontMetrics} metrics
 * @param {string} name
 * @param {number} width
 * @returns {Array<{ text: string, length: number | null }>}
 */
export function nameLines(metrics, name, width) {
  if (measure(metrics, 'semibold', SIZE.name, name) <= width) return [{ text: name, length: null }];
  const words = name.split(' ');
  // Break before the surname: the first word that starts the second half of the name's width.
  let best = 1;
  for (let i = 1; i < words.length; i++) {
    const first = words.slice(0, i).join(' ');
    if (measure(metrics, 'semibold', SIZE.name, first) <= width) best = i;
  }
  if (words.length === 1) return [fit(metrics, 'semibold', SIZE.name, name, width)];
  return [fit(metrics, 'semibold', SIZE.name, words.slice(0, best).join(' '), width), fit(metrics, 'semibold', SIZE.name, words.slice(best).join(' '), width)];
}

/**
 * The text of a Person's card at (x, y): the name in one or two lines, the birth (or baptism)
 * and the death (or burial) each after its symbol, and a line of marks.
 * @param {FontMetrics} metrics
 * @param {ChartLabels} labels
 * @param {ChartPerson} p
 * @param {{ x: number, y: number, w: number, h: number }} box
 * @param {{ leftOut?: number, pointer?: boolean, marriage?: import('./types.js').ChartFact | null }} [extra]
 * @returns {{ lines: TextLine[], symbols: SymbolMark[] }}
 */
export function cardText(metrics, labels, p, box, extra = {}) {
  const inner = box.w - 2 * PAD;
  /** @type {TextLine[]} */
  const lines = [];
  /** @type {SymbolMark[]} */
  const symbols = [];
  const names = nameLines(metrics, labels.name(p), inner);
  names.forEach((n, i) => lines.push({ ...n, face: 'semibold', size: SIZE.name, x: box.x + box.w / 2, y: box.y + 44 + 36 * i, anchor: 'middle' }));
  let y = box.y + 44 + 36 * names.length + 6;
  const factLine = (/** @type {string} */ symbol, /** @type {string} */ text) => {
    if (!text) return;
    symbols.push({ kind: symbol, x: box.x + PAD, y: y - 18 });
    lines.push({ ...fit(metrics, 'regular', SIZE.fact, text, inner - 26), face: 'regular', size: SIZE.fact, x: box.x + PAD + 26, y, anchor: 'start' });
    y += 31;
  };
  // A partner's card carries the couple's marriage.
  if (extra.marriage) factLine('marriage', labels.fact(extra.marriage) || ' ');
  if (extra.pointer) symbols.push({ kind: 'pointer', x: box.x + box.w - 34, y: box.y + 8 });
  if (extra.pointer) {
    lines.push({
      ...fit(metrics, 'italic', SIZE.fact, labels.t('chart.pointer'), inner),
      face: 'italic',
      size: SIZE.fact,
      x: box.x + box.w / 2,
      y,
      anchor: 'middle',
    });
  } else if (p.reduced && p.birthYear !== null && p.born === null) {
    factLine('birth', String(p.birthYear));
  } else {
    if (p.born) factLine(p.born.type === 'baptism' ? 'baptism' : 'birth', labels.fact(p.born));
    if (p.died) factLine(p.died.type === 'burial' ? 'burial' : 'death', labels.fact(p.died));
  }
  // The marks line at the foot of the card: on screen with kinship switched on, the kinship first.
  const marks = [];
  const kinship = labels.kinship(p);
  if (kinship) marks.push(kinship);
  if (p.living) marks.push(labels.t('chart.mark.living'));
  // The mark is text; the legend lists it all the same (a symbol with no drawing).
  if (p.living) symbols.push({ kind: 'living', x: box.x, y: box.y });
  if (extra.leftOut) marks.push(labels.count('chart.leftOut', extra.leftOut));
  if (marks.length > 0) {
    lines.push({
      ...fit(metrics, 'italic', SIZE.small, marks.join(' · '), inner),
      face: 'italic',
      size: SIZE.small,
      x: box.x + box.w / 2,
      y: box.y + box.h - 14,
      anchor: 'middle',
    });
  }
  if (p.diedYoung) symbols.push({ kind: 'diedYoung', x: box.x + box.w - PAD - 18, y: box.y + 8 });
  if (p.relation === 'possible') symbols.push({ kind: 'possible', x: box.x + 8, y: box.y + 8 });
  return { lines: lines.map((l) => ({ ...l, x: Math.round(l.x), y: Math.round(l.y) })), symbols };
}

/**
 * One line of a children list or a sibling card: the name and life years.
 * @param {FontMetrics} metrics
 * @param {ChartLabels} labels
 * @param {ChartPerson} p
 * @param {number} x
 * @param {number} y baseline
 * @param {number} width
 * @param {Face} [face]
 * @returns {TextLine}
 */
export function listLine(metrics, labels, p, x, y, width, face = 'regular') {
  const years = labels.lifeYears(p);
  const text = years ? `${labels.name(p)}, ${years}` : labels.name(p);
  return { ...fit(metrics, face, SIZE.small, text, width), face, size: SIZE.small, x: Math.round(x), y: Math.round(y), anchor: 'start' };
}
