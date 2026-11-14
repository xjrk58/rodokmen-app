// The line form of a Descendant chart laid out (tree-charts spec, "Direct line"; design.md,
// "Layout"): one row per generation of the Direct line, the line couple at x = 0 in every row,
// their children listed under it with the next Person of the line marked, and the married
// siblings of that Person as smaller cards outward on both sides, the elder on the left. Pure,
// and in whole tenths of a millimetre.

import { CARD, cardText, listLine, SIZE, SMALL, textLine } from './chart-cards.js';
import { card, finish, GAP } from './chart-tree-layout.js';

/** @typedef {import('./types.js').DescendantChart} DescendantChart */
/** @typedef {import('./types.js').LineRow} LineRow */
/** @typedef {import('./types.js').ChartPerson} ChartPerson */
/** @typedef {import('./chart-cards.js').FontMetrics} FontMetrics */
/** @typedef {import('./chart-text.js').ChartLabels} ChartLabels */
/** @typedef {import('./chart-tree-layout.js').LaidCard} LaidCard */
/** @typedef {import('./chart-tree-layout.js').LaidLine} LaidLine */
/** @typedef {import('./chart-tree-layout.js').ChartLayout} ChartLayout */

/** The couple's width: two cards and the gap between them; the list under it is as wide. */
export const COUPLE_W = 2 * CARD.w + GAP.couple;
const ROW_GAP = 150;
const SIDE_GAP = 60;

/**
 * The height of a sibling's card: the name, and for each Family the partner and the children.
 * @param {LineRow['siblings'][number]} s
 */
const siblingHeight = (s) => SMALL.head + s.families.reduce((n, f) => n + SMALL.line * (1 + f.children.length), 0) + 10;

/**
 * @param {DescendantChart} model
 * @param {FontMetrics} metrics
 * @param {ChartLabels} labels
 * @param {{ from?: number, to?: number }} [part] the rows of one sheet
 * @returns {ChartLayout}
 */
export function layoutLine(model, metrics, labels, part = {}) {
  const persons = new Map(model.persons.map((p) => [p.id, p]));
  const families = new Map(model.families.map((f) => [f.id, f]));
  /** @type {LaidCard[]} */
  const cards = [];
  /** @type {LaidLine[]} */
  const lines = [];
  const used = new Set(['line']);
  const rows = model.rows.slice(part.from ?? 0, part.to ?? model.rows.length);
  let y = 0;
  rows.forEach((row) => {
    const p = persons.get(row.personId);
    const partner = row.partnerId === null ? undefined : persons.get(row.partnerId);
    // The line Person's card at the same place in every row, so that the line runs straight down.
    const own = { x: -CARD.w - GAP.couple / 2, y, w: CARD.w, h: CARD.h };
    cards.push(card(`line:${row.personId}`, row.personId, 'person', own, true, false, p ? cardText(metrics, labels, p, own) : { lines: [], symbols: [] }));
    if (partner && row.partnerId !== null) {
      const box = { x: GAP.couple / 2, y, w: CARD.w, h: CARD.h };
      const marriage = row.familyId === null ? null : (families.get(row.familyId)?.marriage ?? null);
      if (marriage) used.add('marriage');
      cards.push(
        card(`line:${row.personId}+${row.partnerId}`, row.partnerId, 'partner', box, false, false, cardText(metrics, labels, partner, box, { marriage })),
      );
      lines.push({ key: `couple:${row.personId}`, d: `M${-GAP.couple / 2} ${y + CARD.h / 2}H${GAP.couple / 2}`, style: 'solid', line: false });
    }
    // The children, listed under the couple; the next Person of the line in the semibold face.
    const listY = y + CARD.h + 30;
    const list = row.children.flatMap((c, i) => {
      const child = persons.get(c.personId);
      if (!child) return [];
      const next = c.personId === row.nextId;
      return [listLine(metrics, labels, child, -COUPLE_W / 2 + 34, listY + 30 + SMALL.line * i, COUPLE_W - 50, next ? 'semibold' : 'regular')];
    });
    const listH = row.children.length === 0 ? 0 : 40 + SMALL.line * row.children.length;
    if (listH > 0) {
      const nextAt = row.children.findIndex((c) => c.personId === row.nextId);
      const symbols = nextAt < 0 ? [] : [{ kind: 'line', x: -COUPLE_W / 2 + 8, y: listY + 30 + SMALL.line * nextAt - 18 }];
      cards.push(card(`list:${row.personId}`, null, 'list', { x: -COUPLE_W / 2, y: listY, w: COUPLE_W, h: listH }, false, false, { lines: list, symbols }));
    }
    // The siblings of the next Person, outward on each side.
    let left = -COUPLE_W / 2 - SIDE_GAP;
    let right = COUPLE_W / 2 + SIDE_GAP;
    let tallest = CARD.h + 30 + listH;
    for (const s of row.siblings) {
      const sib = persons.get(s.personId);
      const h = siblingHeight(s);
      const x = s.side === 'left' ? left - SMALL.w : right;
      if (s.side === 'left') left -= SMALL.w + GAP.subtree;
      else right += SMALL.w + GAP.subtree;
      tallest = Math.max(tallest, h);
      cards.push(
        card(`sibling:${s.personId}`, s.personId, 'sibling', { x, y, w: SMALL.w, h }, false, false, siblingText(metrics, labels, persons, s, sib, { x, y })),
      );
      const cx = x + SMALL.w / 2;
      const join = s.side === 'left' ? -COUPLE_W / 2 : COUPLE_W / 2;
      lines.push({ key: `sibling:${s.personId}`, d: `M${join} ${y + CARD.h + 15}H${cx}V${y + h}`, style: 'solid', line: false });
    }
    if (row.nextId !== null) used.add('line');
    y += tallest + ROW_GAP;
  });
  // The Direct line runs down the centre, from each line Person to the next.
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = cards.find((c) => c.key === `line:${rows[i].personId}`);
    const b = cards.find((c) => c.key === `line:${rows[i + 1].personId}`);
    if (a && b) lines.push({ key: `line:${rows[i].personId}`, d: `M${a.x + CARD.w / 2} ${a.y + CARD.h}V${b.y}`, style: 'solid', line: true });
  }
  return finish(cards, lines, used);
}

/**
 * The text of a sibling's card: the name and life years, and for each Family the partner and the children's names and life years.
 * @param {FontMetrics} metrics
 * @param {ChartLabels} labels
 * @param {Map<string, ChartPerson>} persons
 * @param {LineRow['siblings'][number]} s
 * @param {ChartPerson | undefined} sib
 * @param {{ x: number, y: number }} at
 */
function siblingText(metrics, labels, persons, s, sib, at) {
  const width = SMALL.w - 30;
  /** @type {import('./chart-cards.js').TextLine[]} */
  const lines = [];
  /** @type {import('./chart-cards.js').SymbolMark[]} */
  const symbols = [];
  if (sib) lines.push(textLine(metrics, 'semibold', SIZE.name, labels.name(sib), width, at.x + SMALL.w / 2, at.y + 40, 'middle'));
  if (sib) lines.push(textLine(metrics, 'regular', SIZE.small, labels.lifeYears(sib), width, at.x + SMALL.w / 2, at.y + 64, 'middle'));
  let y = at.y + SMALL.head + 26;
  for (const f of s.families) {
    const partner = f.partnerId === null ? undefined : persons.get(f.partnerId);
    symbols.push({ kind: 'marriage', x: at.x + 12, y: y - 18 });
    lines.push(textLine(metrics, 'regular', SIZE.small, partner ? labels.name(partner) : '', width - 26, at.x + 40, y));
    y += SMALL.line;
    for (const kid of f.children) {
      const k = persons.get(kid);
      if (k) lines.push(listLine(metrics, labels, k, at.x + 40, y, width - 26));
      y += SMALL.line;
    }
  }
  return { lines, symbols };
}
