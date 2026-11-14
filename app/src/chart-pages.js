// A Chart cut into Sheets of paper (tree-charts spec, "Printing and downloading a Sheet"; design.md,
// "Layout"): A4 or A3, portrait or landscape, each page holding its part at a scale that keeps
// names at 7 points or more. A tree that does not fit moves its widest branch (ties by the
// Chart's order) to a new page, leaving a "continued on sheet n" card, until every page fits;
// the line form and the House chart break between rows. Pure: the same pages every run.

import { CARD } from './chart-cards.js';
import { layoutHouse, rowHeight } from './chart-house-layout.js';
import { layoutLine } from './chart-line-layout.js';
import { layoutTree, subtreeWidths } from './chart-tree-layout.js';

/** @typedef {import('./types.js').ChartModel} ChartModel */
/** @typedef {import('./chart-tree-layout.js').ChartLayout} ChartLayout */
/** @typedef {import('./chart-cards.js').FontMetrics} FontMetrics */
/** @typedef {import('./chart-text.js').ChartLabels} ChartLabels */
/** @typedef {'a4-portrait' | 'a4-landscape' | 'a3-portrait' | 'a3-landscape'} Paper */
/** @typedef {{ number: number, layout: ChartLayout, scale: number }} Page */

/** The sheet's frame: the margin to the paper's edge, the title above the content and the legend and colophon below. */
export const SHEET = { margin: 80, inset: 50, header: 230, footer: 300 };
/** Names are set at 9 points, and may shrink to 7 on paper. */
export const MIN_SCALE = 7 / 9;

/** @param {Paper} paper @returns {{ w: number, h: number }} in tenths of a millimetre */
export function paperSize(paper) {
  const [w, h] = paper.startsWith('a3') ? [2970, 4200] : [2100, 2970];
  return paper.endsWith('landscape') ? { w: h, h: w } : { w, h };
}

/** The room a page has for the Chart itself. @param {{ w: number, h: number }} size */
export function contentArea(size) {
  const side = SHEET.margin + SHEET.inset;
  return { x: side, y: side + SHEET.header, w: size.w - 2 * side, h: size.h - 2 * side - SHEET.header - SHEET.footer };
}

/**
 * The scale a layout needs to fit an area: at most 1, in thousandths, so that it prints the same everywhere.
 * @param {{ width: number, height: number }} layout
 * @param {{ w: number, h: number }} area
 */
export function fitScale(layout, area) {
  const s = Math.min(1, area.w / Math.max(1, layout.width), area.h / Math.max(1, layout.height));
  return Math.floor(s * 1000) / 1000;
}

/**
 * The pages of a Chart on a paper.
 * @param {ChartModel} model
 * @param {FontMetrics} metrics
 * @param {ChartLabels} labels
 * @param {Paper} paper
 * @returns {Page[]}
 */
export function paginate(model, metrics, labels, paper) {
  const area = contentArea(paperSize(paper));
  if (model.kind === 'house')
    return byRows(
      model.rows.map((r) => rowHeight(r)),
      area,
      (from, to) => layoutHouse(model, metrics, labels, { from, to }),
    );
  if (model.form === 'line')
    return byRows(
      model.rows.map(() => CARD.h * 3),
      area,
      (from, to) => layoutLine(model, metrics, labels, { from, to }),
    );
  return byBranches(model, metrics, labels, area);
}

/**
 * Splits a tree by branches: while a page does not fit at the smallest scale, its widest branch
 * below the page's top moves to a new page.
 * @param {import('./types.js').DescendantChart} model
 * @param {FontMetrics} metrics
 * @param {ChartLabels} labels
 * @param {{ w: number, h: number }} area
 * @returns {Page[]}
 */
function byBranches(model, metrics, labels, area) {
  const first = model.nodes[0];
  if (first === undefined) return [{ number: 1, layout: layoutTree(model, metrics, labels), scale: 1 }];
  /** @type {Array<{ root: string, stubs: Map<string, number> }>} */
  const parts = [{ root: first.key, stubs: new Map() }];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    for (;;) {
      const widths = subtreeWidths(model, part);
      const layout = layoutTree(model, metrics, labels, part);
      if (fitScale(layout, area) >= MIN_SCALE) break;
      // The widest branch on this page, its top excluded; the first in the Chart's order on a tie.
      let best = null;
      for (const [key, width] of widths) {
        if (key === part.root || part.stubs.has(key)) continue;
        if (best === null || width > best.width) best = { key, width };
      }
      if (best === null) break;
      part.stubs.set(best.key, parts.length + 1);
      parts.push({ root: best.key, stubs: new Map() });
    }
  }
  return parts.map((part, i) => {
    const layout = layoutTree(model, metrics, labels, part);
    return { number: i + 1, layout, scale: fitScale(layout, area) };
  });
}

/**
 * Splits rows between pages: as many rows on a page as fit at the smallest scale, at least one.
 * @param {number[]} heights a guess of each row's height, to try a split
 * @param {{ w: number, h: number }} area
 * @param {(from: number, to: number) => ChartLayout} lay
 * @returns {Page[]}
 */
function byRows(heights, area, lay) {
  /** @type {Page[]} */
  const pages = [];
  let from = 0;
  while (from < heights.length || pages.length === 0) {
    let to = from + 1;
    while (to < heights.length && fitScale(lay(from, to + 1), area) >= MIN_SCALE) to++;
    const layout = lay(from, Math.min(to, heights.length));
    pages.push({ number: pages.length + 1, layout, scale: fitScale(layout, area) });
    from = to;
    if (heights.length === 0) break;
  }
  return pages;
}
