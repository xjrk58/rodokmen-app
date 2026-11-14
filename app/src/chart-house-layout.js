// A House chart laid out (tree-charts spec, "House chart", "Succession in a House chart";
// design.md, "Layout"): one column of rows in the model's order, at equal spacing (not to a time
// scale), with each row's period and house numbers on the left like a timeline, the couple's
// cards, the children with marks for those born and died at the House, and a rail of links
// (son, daughter, remarriage) from each row to the earlier one. Pure, and in whole tenths of a millimetre.

import { CARD, cardText, listLine, SIZE, SMALL, textLine } from './chart-cards.js';
import { card, finish, GAP } from './chart-tree-layout.js';

/** @typedef {import('./types.js').HouseChart} HouseChart */
/** @typedef {import('./types.js').HouseRow} HouseRow */
/** @typedef {import('./chart-cards.js').FontMetrics} FontMetrics */
/** @typedef {import('./chart-text.js').ChartLabels} ChartLabels */
/** @typedef {import('./chart-tree-layout.js').LaidCard} LaidCard */
/** @typedef {import('./chart-tree-layout.js').LaidLine} LaidLine */
/** @typedef {import('./chart-tree-layout.js').ChartLayout} ChartLayout */

/** The period column, the rail of links, and the children's list. */
export const HOUSE = { period: 330, rail: 160, list: 560, rowGap: 120 };

/** @param {HouseRow} row */
export const rowHeight = (row) => Math.max(CARD.h, 50 + SMALL.line * row.children.length);

/**
 * @param {HouseChart} model
 * @param {FontMetrics} metrics
 * @param {ChartLabels} labels
 * @param {{ from?: number, to?: number }} [part] the rows of one sheet
 * @returns {ChartLayout}
 */
export function layoutHouse(model, metrics, labels, part = {}) {
  const persons = new Map(model.persons.map((p) => [p.id, p]));
  const families = new Map(model.families.map((f) => [f.id, f]));
  /** @type {LaidCard[]} */
  const cards = [];
  /** @type {LaidLine[]} */
  const lines = [];
  const used = new Set(['residents']);
  const rows = model.rows.slice(part.from ?? 0, part.to ?? model.rows.length);
  /** @type {Map<string, number>} the middle of each row */
  const middle = new Map();
  const cardsX = HOUSE.period + HOUSE.rail;
  let y = 0;
  for (const row of rows) {
    const h = rowHeight(row);
    middle.set(row.key, y + Math.round(h / 2));
    // The period and the house numbers, on the left.
    const period = [row.earliest ? labels.date(row.earliest) : '', row.latest && row.latest !== row.earliest ? labels.date(row.latest) : ''].filter(Boolean);
    const periodText = row.dated ? (period.length === 0 ? '?' : period.join(' – ')) : labels.t('chart.undated');
    cards.push(
      card(`period:${row.key}`, null, 'list', { x: 0, y, w: HOUSE.period, h }, false, false, {
        lines: [
          textLine(metrics, 'semibold', SIZE.fact, periodText, HOUSE.period - 20, 10, y + 40),
          textLine(metrics, 'regular', SIZE.small, row.numbers.map((n) => labels.houseNumber(n)).join(', '), HOUSE.period - 20, 10, y + 72),
        ],
        symbols: [],
      }),
    );
    // The couple.
    let x = cardsX;
    const partners = [row.partner1Id, row.partner2Id].filter((id) => id !== null);
    const marriage = row.familyId === null ? null : (families.get(row.familyId)?.marriage ?? null);
    partners.forEach((id, i) => {
      const p = persons.get(id);
      const box = { x, y, w: CARD.w, h: CARD.h };
      const text = p ? cardText(metrics, labels, p, box, { marriage: i === 1 ? marriage : null }) : { lines: [], symbols: [] };
      if (row.diedHere.includes(id)) text.symbols.push({ kind: 'diedHere', x: box.x + box.w - 34, y: box.y + box.h - 34 });
      if (row.marriedIn === id) {
        text.lines.push(
          textLine(metrics, 'italic', SIZE.small, labels.t(`chart.marriedIn.${p?.sex ?? 'unknown'}`), CARD.w - 40, box.x + CARD.w / 2, box.y - 10, 'middle'),
        );
        used.add('marriedIn');
      }
      if (marriage && i === 1) used.add('marriage');
      cards.push(card(`row:${row.key}:${id}`, id, 'person', box, false, false, text));
      if (i === 1) lines.push({ key: `couple:${row.key}`, d: `M${box.x - GAP.couple} ${y + CARD.h / 2}H${box.x}`, style: 'solid', line: false });
      x += CARD.w + GAP.couple;
    });
    // The children: born here, died here.
    if (row.children.length > 0) {
      const lx = cardsX + 2 * (CARD.w + GAP.couple);
      const list = row.children.flatMap((c, i) => {
        const child = persons.get(c.personId);
        return child ? [listLine(metrics, labels, child, lx + 60, y + 40 + SMALL.line * i, HOUSE.list - 80)] : [];
      });
      const symbols = row.children.flatMap((c, i) => [
        ...(c.bornHere ? [{ kind: 'bornHere', x: lx + 10, y: y + 22 + SMALL.line * i }] : []),
        ...(row.diedHere.includes(c.personId) ? [{ kind: 'diedHere', x: lx + 32, y: y + 22 + SMALL.line * i }] : []),
      ]);
      cards.push(card(`children:${row.key}`, null, 'list', { x: lx, y, w: HOUSE.list, h }, false, false, { lines: list, symbols }));
      lines.push({ key: `children:${row.key}`, d: `M${lx - GAP.couple} ${y + CARD.h / 2}H${lx}`, style: 'solid', line: false });
    }
    y += h + HOUSE.rowGap;
  }
  // The rail: each link from a row to the earlier one, labelled with its kind, nearer rows nearer the cards.
  rows.forEach((row, r) => {
    if (row.link.rowKey === null) return;
    const from = middle.get(row.link.rowKey);
    const to = middle.get(row.key);
    if (from === undefined || to === undefined) return;
    const back = r - rows.findIndex((x) => x.key === row.link.rowKey);
    const rx = cardsX - 30 - Math.min(5, back) * 22;
    lines.push({ key: `link:${row.key}`, d: `M${cardsX} ${from}H${rx}V${to}H${cardsX}`, style: 'solid', line: false });
    cards.push(
      card(`link:${row.key}`, null, 'list', { x: HOUSE.period, y: to - 34, w: HOUSE.rail - 40, h: 30 }, false, false, {
        lines: [textLine(metrics, 'italic', SIZE.small, labels.t(`chart.link.${row.link.kind}`), HOUSE.rail - 40, HOUSE.period + 4, to - 12)],
        symbols: [],
      }),
    );
    used.add(`link.${row.link.kind}`);
  });
  return finish(cards, lines, used);
}
