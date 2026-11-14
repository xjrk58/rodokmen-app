// The tree form of a Descendant chart laid out (tree-charts spec, "Descendant chart"; design.md,
// "Layout"): a tidy tree over units, each the descendant's card and one partner card per Family.
// Siblings go left to right in the model's order, each subtree pushed right until its contour
// clears the ones before it by a fixed gap, and each unit is centred over its children
// (Reingold–Tilford with contours). Pure, and in whole tenths of a millimetre.

import { CARD, cardText, SIZE, textLine } from './chart-cards.js';

/** @typedef {import('./types.js').DescendantChart} DescendantChart */
/** @typedef {import('./types.js').DescendantNode} DescendantNode */
/** @typedef {import('./types.js').ChartPerson} ChartPerson */
/** @typedef {import('./chart-cards.js').FontMetrics} FontMetrics */
/** @typedef {import('./chart-text.js').ChartLabels} ChartLabels */
/**
 * @typedef {object} LaidCard
 * @property {string} key unique within the layout
 * @property {string | null} personId
 * @property {'person' | 'partner' | 'pointer' | 'stub' | 'row' | 'sibling' | 'list'} kind
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {boolean} dashed
 * @property {boolean} onLine
 * @property {boolean} moreBelow the Person has descendants the Chart leaves out: a Chart opens from them
 * @property {import('./chart-cards.js').TextLine[]} lines
 * @property {import('./chart-cards.js').SymbolMark[]} symbols
 */
/** @typedef {{ key: string, d: string, style: 'solid' | 'dashed' | 'dotted', line: boolean }} LaidLine */
/** @typedef {{ width: number, height: number, cards: LaidCard[], lines: LaidLine[], symbols: string[] }} ChartLayout */

/** Gaps: between a person and a partner card, between subtrees, and between generations. */
export const GAP = { couple: 40, subtree: 80, generation: 170 };

/**
 * @typedef {object} Sub
 * @property {string} key
 * @property {number} unitW
 * @property {number} unitX the unit's left edge, relative to the subtree's origin
 * @property {Array<{ sub: Sub, dx: number }>} kids
 * @property {Array<[number, number]>} contour left and right edge per depth below
 */

/**
 * @param {DescendantChart} model
 * @param {FontMetrics} metrics
 * @param {ChartLabels} labels
 * @param {{ root?: string, stubs?: Map<string, number> }} [part] a page of a split Chart: its top node, and the nodes moved to other pages
 * @returns {ChartLayout}
 */
export function layoutTree(model, metrics, labels, part = {}) {
  const nodes = new Map(model.nodes.map((n) => [n.key, n]));
  const persons = new Map(model.persons.map((p) => [p.id, p]));
  const families = new Map(model.families.map((f) => [f.id, f]));
  /** @type {Map<string, number>} */
  const stubs = part.stubs ?? new Map();
  const rootKey = part.root ?? model.nodes[0]?.key;
  if (rootKey === undefined) return { width: 0, height: 0, cards: [], lines: [], symbols: [] };

  const top = subtrees(model, { root: rootKey, stubs }).get(rootKey);
  if (top === undefined) return { width: 0, height: 0, cards: [], lines: [], symbols: [] };
  /** @type {LaidCard[]} */
  const cards = [];
  /** @type {LaidLine[]} */
  const lines = [];
  /** @type {Set<string>} */
  const used = new Set();
  /** @type {Map<string, { x: number, y: number }>} */
  const topOf = new Map();
  /** @type {Array<() => void>} */
  const deferred = [];

  /** @param {Sub} s @param {number} ox @param {number} depth */
  const place = (s, ox, depth) => {
    const n = /** @type {DescendantNode} */ (nodes.get(s.key));
    const x = ox + s.unitX;
    const y = depth * (CARD.h + GAP.generation);
    topOf.set(s.key, { x: x + CARD.w / 2, y });
    const p = persons.get(n.personId);
    const own = { x, y, w: CARD.w, h: CARD.h };
    if (stubs.has(n.key)) {
      used.add('continued');
      cards.push(card(`${n.key}#stub`, n.personId, 'stub', own, n.onLine, false, stubText(metrics, labels, p, own, /** @type {number} */ (stubs.get(n.key)))));
      return;
    }
    const kind = n.pointer ? 'pointer' : 'person';
    const text = p ? cardText(metrics, labels, p, own, { leftOut: n.leftOut, pointer: n.pointer }) : { lines: [], symbols: [] };
    cards.push(card(n.key, n.personId, kind, own, n.onLine, n.moreBelow, text, n.pointer || !n.followed));
    if (n.pointer) used.add('pointer');
    if (n.leftOut > 0) used.add('leftOut');
    let px = x + CARD.w + GAP.couple;
    let i = 0;
    for (const f of n.families) {
      let from = { x: x + CARD.w / 2, y: y + CARD.h };
      if (f.partnerId !== null || f.pointer) {
        from = partnerCard(n, f, { x, y, px, i });
        px += CARD.w + GAP.couple;
        i++;
      }
      if (f.pointer || f.children.length === 0 || stubs.has(n.key)) continue;
      drop(n, f, from, y);
    }
    for (const k of s.kids) place(k.sub, ox + k.dx, depth + 1);
  };

  /**
   * A partner's card beside the descendant's (or one pointing to a Family drawn elsewhere), and
   * the couple's line to it, each Family at its own height behind the cards between them, dotted
   * for a weak link between the partners. Returns where the lines to their children start.
   * @param {DescendantNode} n
   * @param {DescendantNode['families'][number]} f
   * @param {{ x: number, y: number, px: number, i: number }} at
   */
  const partnerCard = (n, f, { x, y, px, i }) => {
    const family = families.get(f.familyId);
    const partner = f.partnerId === null ? undefined : persons.get(f.partnerId);
    const box = { x: px, y, w: CARD.w, h: CARD.h };
    const marriage = family?.marriage ?? null;
    const ptext = partner ? cardText(metrics, labels, partner, box, { marriage, pointer: f.pointer }) : { lines: [], symbols: [] };
    if (marriage) used.add('marriage');
    cards.push(card(`${n.key}+${f.familyId}`, f.partnerId, f.pointer ? 'pointer' : 'partner', box, false, false, ptext, f.pointer));
    if (f.pointer) used.add('pointer');
    const ly = y + CARD.h / 2 + 14 * i;
    lines.push({ key: `couple:${n.key}:${f.familyId}`, d: `M${x + CARD.w} ${ly}H${px}`, style: family?.weakLink ? 'dotted' : 'solid', line: false });
    if (family?.weakLink) used.add('weak');
    return { x: px - GAP.couple / 2, y: ly };
  };

  /** The lines from a couple down to its children. @param {DescendantNode} n @param {DescendantNode['families'][number]} f @param {{ x: number, y: number }} from @param {number} y */
  const drop = (n, f, from, y) => {
    const cx = from.x;
    const family = families.get(f.familyId);
    const bus = y + CARD.h + GAP.generation / 2;
    deferred.push(() => {
      const tops = f.children.map((k) => ({ k, at: topOf.get(k) })).filter((c) => c.at !== undefined);
      if (tops.length === 0) return;
      const xs = tops.map((c) => /** @type {{ x: number }} */ (c.at).x);
      const onLine = n.onLine && tops.some((c) => nodes.get(c.k)?.onLine);
      lines.push({
        key: `down:${n.key}:${f.familyId}`,
        d: `M${cx} ${from.y}V${bus}H${Math.min(cx, ...xs)}M${cx} ${bus}H${Math.max(cx, ...xs)}`,
        style: 'solid',
        line: onLine,
      });
      for (const c of tops) {
        const child = /** @type {DescendantNode} */ (nodes.get(c.k));
        const link = family?.children.find((l) => l.personId === child.personId);
        const style = link?.weakLink ? 'dotted' : link && link.linkType !== 'birth' ? 'dashed' : 'solid';
        if (style === 'dotted') used.add('weak');
        if (style === 'dashed') used.add('nonBirth');
        const at = /** @type {{ x: number, y: number }} */ (c.at);
        lines.push({ key: `child:${c.k}`, d: `M${at.x} ${bus}V${at.y}`, style, line: n.onLine && child.onLine });
      }
    });
  };
  place(top, 0, 0);
  for (const f of deferred) f();
  if (cards.some((c) => c.onLine)) used.add('line');
  return finish(cards, lines, used);
}

/**
 * The subtrees of a page, each with its contour: the left and right edge of every generation below it.
 * @param {DescendantChart} model
 * @param {{ root: string, stubs: Map<string, number> }} part
 * @returns {Map<string, Sub>}
 */
function subtrees(model, part) {
  const nodes = new Map(model.nodes.map((n) => [n.key, n]));
  const { stubs } = part;
  /** @type {Map<string, Sub>} */
  const all = new Map();
  /** The cards beside a node's own: one per Family with a partner, or pointing elsewhere. @param {DescendantNode} n */
  const places = (n) => n.families.filter((f) => f.partnerId !== null || f.pointer);
  /** @param {DescendantNode} n */
  const unitWidth = (n) => (stubs.has(n.key) ? CARD.w : CARD.w + places(n).length * (CARD.w + GAP.couple));
  /** @param {DescendantNode} n */
  const childKeys = (n) => (stubs.has(n.key) ? [] : n.families.flatMap((f) => (f.pointer ? [] : f.children)));

  /** @param {string} key @returns {Sub} */
  const sub = (key) => {
    const n = /** @type {DescendantNode} */ (nodes.get(key));
    const unitW = unitWidth(n);
    /** @type {Array<{ sub: Sub, dx: number }>} */
    const kids = [];
    /** @type {Array<[number, number]>} */
    const below = [];
    for (const k of childKeys(n)) {
      const s = sub(k);
      let dx = 0;
      if (kids.length > 0) {
        dx = -Infinity;
        for (let d = 0; d < Math.min(below.length, s.contour.length); d++) dx = Math.max(dx, below[d][1] + GAP.subtree - s.contour[d][0]);
      }
      kids.push({ sub: s, dx });
      s.contour.forEach(([l, r], d) => {
        below[d] = below[d] ? [Math.min(below[d][0], l + dx), Math.max(below[d][1], r + dx)] : [l + dx, r + dx];
      });
    }
    let unitX = 0;
    if (kids.length > 0) {
      const first = kids[0];
      const last = kids[kids.length - 1];
      const centre = (first.dx + first.sub.unitX + first.sub.unitW / 2 + last.dx + last.sub.unitX + last.sub.unitW / 2) / 2;
      // Whole units, so that every coordinate stays an integer.
      unitX = Math.round(centre - unitW / 2);
    }
    const made = { key, unitW, unitX, kids, contour: /** @type {Array<[number, number]>} */ ([[unitX, unitX + unitW], ...below]) };
    all.set(key, made);
    return made;
  };
  sub(part.root);
  return all;
}

/**
 * The width of each branch on a page, by its top node, for choosing which branch moves to another sheet.
 * @param {DescendantChart} model
 * @param {{ root: string, stubs: Map<string, number> }} part
 * @returns {Map<string, number>} in the Chart's order
 */
export function subtreeWidths(model, part) {
  const subs = subtrees(model, part);
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const n of model.nodes) {
    const s = subs.get(n.key);
    if (s) out.set(n.key, Math.max(...s.contour.map((c) => c[1])) - Math.min(...s.contour.map((c) => c[0])));
  }
  return out;
}

/**
 * @param {string} key
 * @param {string | null} personId
 * @param {LaidCard['kind']} kind
 * @param {{ x: number, y: number, w: number, h: number }} box
 * @param {boolean} onLine
 * @param {boolean} moreBelow
 * @param {{ lines: import('./chart-cards.js').TextLine[], symbols: import('./chart-cards.js').SymbolMark[] }} text
 * @param {boolean} [dashed]
 * @returns {LaidCard}
 */
export function card(key, personId, kind, box, onLine, moreBelow, text, dashed = false) {
  return { key, personId, kind, ...box, dashed, onLine, moreBelow, lines: text.lines, symbols: text.symbols };
}

/** The card left where a branch moves to another sheet. */
function stubText(
  /** @type {FontMetrics} */ metrics,
  /** @type {ChartLabels} */ labels,
  /** @type {ChartPerson | undefined} */ p,
  /** @type {{ x: number, y: number, w: number, h: number }} */ box,
  /** @type {number} */ sheet,
) {
  const base = p ? cardText(metrics, labels, p, box) : { lines: [], symbols: [] };
  return {
    lines: [
      ...base.lines.slice(0, 2),
      textLine(metrics, 'italic', SIZE.fact, labels.t('chart.continued', { n: sheet }), box.w - 30, box.x + box.w / 2, box.y + box.h - 18, 'middle'),
    ],
    symbols: [],
  };
}

/**
 * Moves the layout so that it starts at (0, 0), and lists the symbols it uses with those of its cards.
 * @param {LaidCard[]} cards
 * @param {LaidLine[]} lines
 * @param {Set<string>} used
 * @returns {ChartLayout}
 */
export function finish(cards, lines, used) {
  const minX = Math.min(0, ...cards.map((c) => c.x));
  const minY = Math.min(0, ...cards.map((c) => c.y));
  const maxX = Math.max(0, ...cards.map((c) => c.x + c.w));
  const maxY = Math.max(0, ...cards.map((c) => c.y + c.h));
  const shift = (/** @type {string} */ d) =>
    d.replace(/([MLHV])(-?\d+)(?: (-?\d+))?/g, (_m, cmd, a, b) =>
      cmd === 'H' ? `H${Number(a) - minX}` : cmd === 'V' ? `V${Number(a) - minY}` : `${cmd}${Number(a) - minX} ${Number(b) - minY}`,
    );
  for (const c of cards) for (const s of c.symbols) used.add(s.kind);
  return {
    width: maxX - minX,
    height: maxY - minY,
    cards: cards.map((c) => ({
      ...c,
      x: c.x - minX,
      y: c.y - minY,
      lines: c.lines.map((l) => ({ ...l, x: l.x - minX, y: l.y - minY })),
      symbols: c.symbols.map((s) => ({ ...s, x: s.x - minX, y: s.y - minY })),
    })),
    lines: lines.map((l) => ({ ...l, d: shift(l.d) })),
    symbols: [...used].sort(),
  };
}
