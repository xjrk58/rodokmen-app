// Lays out the hourglass (family-tree spec, "Hourglass layout"): the focus Person in the middle
// row, their ancestors above as a binary tree of couples, their descendants below, each
// Family's children grouped under that couple, and partners beside every Person. Pure: it
// turns the API's hourglass into boxes and lines in pixels, with the focus Person's box
// centred on x = 0 and its top at y = 0. Sized so that 3 generations up (4 couples in the top
// row) fit a 390 px wide phone.

/** @typedef {import('./types.js').Hourglass} Hourglass */
/** @typedef {import('./types.js').PersonSummary} PersonSummary */
/** @typedef {import('./types.js').ChildLinkType} ChildLinkType */
/** @typedef {Hourglass['persons'][number]} Entry */
/** @typedef {Hourglass['families'][number]} Family */
/** @typedef {Hourglass['childLinks'][number]} ChildLink */

/** A Person's box. */
export const BOX = /** @type {const} */ ({ w: 88, h: 50 });
/** Between the two Persons of an ancestor couple, stacked. */
const COUPLE_GAP = 2;
/** Between cards or units side by side. */
const COL_GAP = 8;
/** Between the children of different Families of one Person. */
const GROUP_GAP = 16;
/** Between a Person and a partner in one row. */
const PARTNER_GAP = 14;
/** Between generations. */
const ROW_GAP = 34;
const CARD_H = BOX.h * 2 + COUPLE_GAP;
const SLOT = BOX.w + COL_GAP;

/**
 * @typedef {object} LayoutNode
 * @property {string} id the Person's id
 * @property {number} x left
 * @property {number} y top
 * @property {'focus' | 'ancestor' | 'descendant' | 'partner'} kind
 * @property {number} generation 0 the focus row, positive above, negative below
 * @property {PersonSummary} person
 * @property {boolean} moreAbove the Tree knows this Person's parents, beyond the rows shown
 * @property {boolean} moreBelow the Tree knows this Person's children, beyond the rows shown
 */

/**
 * @typedef {object} LayoutLine
 * @property {string} key stable, for the renderer
 * @property {string} d SVG path data
 * @property {'couple' | 'parents' | 'child'} kind a couple, from a couple to their children's bar, from the bar to one child
 * @property {ChildLinkType | null} linkType for a child line: how the child belongs to the Family (other than birth is drawn dashed)
 */

/**
 * @typedef {object} Layout
 * @property {LayoutNode[]} nodes
 * @property {LayoutLine[]} lines
 * @property {{ minX: number, minY: number, maxX: number, maxY: number }} bounds
 * @property {{ familyId: string, linkType: ChildLinkType, parents: PersonSummary[] }[]} otherParents the focus Person's other parent Families (adoptive, foster), which the tree does not draw
 */

/**
 * @template K, V
 * @param {readonly V[]} items
 * @param {(item: V) => K} key
 * @returns {Map<K, V[]>}
 */
function groupBy(items, key) {
  /** @type {Map<K, V[]>} */
  const out = new Map();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/** @param {Family} f @param {string} id */
const otherPartner = (f, id) => (f.partner1Id === id ? f.partner2Id : f.partner1Id);

/**
 * @typedef {object} Unit a descendant (or the focus Person) with partners and children
 * @property {string} id
 * @property {{ id: string | null, familyId: string }[]} partners
 * @property {{ familyId: string, children: Unit[], links: Map<string, ChildLink> }[]} groups
 * @property {number} rowWidth
 * @property {number} width
 */

/**
 * @typedef {object} Ancestors a couple of ancestors and theirs
 * @property {string} familyId
 * @property {ChildLinkType} linkType how the child below belongs to this Family
 * @property {string | null} top shown in the upper row: the father, when known
 * @property {string | null} bottom the mother
 * @property {[Ancestors | null, Ancestors | null]} parents of top and of bottom
 * @property {number} slots width in cards
 */

/**
 * @param {Hourglass} data
 * @returns {Layout}
 */
export function layoutHourglass(data) {
  const entries = new Map(data.persons.map((p) => [p.person.id, p]));
  const linksByChild = groupBy(data.childLinks, (l) => l.childId);
  const linksByFamily = groupBy(data.childLinks, (l) => l.familyId);
  const familyById = new Map(data.families.map((f) => [f.id, f]));
  const familiesByPartner = groupBy(
    data.families.flatMap((f) => [f.partner1Id, f.partner2Id].filter((id) => id !== null).map((id) => ({ id, f }))),
    (x) => x.id,
  );
  /** @type {LayoutNode[]} */
  const nodes = [];
  /** @type {LayoutLine[]} */
  const lines = [];
  /** @type {Map<string, LayoutNode>} */
  const placed = new Map();

  /** @param {string} id @param {number} x @param {number} y */
  const box = (id, x, y) => {
    const e = /** @type {Entry} */ (entries.get(id));
    const node = { id, x, y, kind: e.relation, generation: e.generation, person: e.person, moreAbove: e.moreAbove, moreBelow: e.moreBelow };
    nodes.push(node);
    placed.set(id, node);
    return node;
  };

  // ------------------------------------------------------------ descendants (and the focus row)

  /** @type {Set<string>} */
  const inUnits = new Set();
  /**
   * @param {string} id
   * @param {number} generation
   * @returns {Unit}
   */
  const unit = (id, generation) => {
    inUnits.add(id);
    const families = (familiesByPartner.get(id) ?? []).map((x) => x.f);
    const partners = families.map((f) => ({ id: otherPartner(f, id), familyId: f.id })).filter((p) => p.id === null || entries.has(p.id));
    const groups = partners.map((p) => {
      const links = (linksByFamily.get(p.familyId) ?? []).filter((l) => {
        const child = entries.get(l.childId);
        return child?.relation === 'descendant' && child.generation === generation - 1 && !inUnits.has(l.childId);
      });
      return { familyId: p.familyId, children: links.map((l) => unit(l.childId, generation - 1)), links: new Map(links.map((l) => [l.childId, l])) };
    });
    const shown = partners.filter((p) => p.id !== null).length;
    const rowWidth = (1 + shown) * BOX.w + shown * PARTNER_GAP;
    const filled = groups.filter((g) => g.children.length > 0);
    const childrenWidth =
      filled.reduce((sum, g) => sum + g.children.reduce((s, c) => s + c.width, 0) + (g.children.length - 1) * COL_GAP, 0) +
      Math.max(0, filled.length - 1) * GROUP_GAP;
    return { id, partners, groups, rowWidth, width: Math.max(rowWidth, childrenWidth) };
  };

  /** Row order: one partner to the right; with two or more, the first to the left. @param {Unit} u */
  const rowOrder = (u) => {
    const others = u.partners.map((p) => p.id).filter((id) => id !== null);
    return others.length >= 2 ? [others[0], u.id, ...others.slice(1)] : [u.id, ...others];
  };

  /** @param {number} generation */
  const rowTop = (generation) => (0 - generation) * (BOX.h + ROW_GAP);

  /**
   * Places a unit in [left, left + width]; returns the centre x of its Person's box.
   * @param {Unit} u
   * @param {number} left
   * @param {number} generation
   * @returns {number}
   */
  const place = (u, left, generation) => {
    const y = rowTop(generation);
    const order = rowOrder(u);
    const rowLeft = left + (u.width - u.rowWidth) / 2;
    /** @type {Map<string, number>} centre x of each box in the row */
    const centre = new Map();
    order.forEach((id, i) => {
      const x = rowLeft + i * (BOX.w + PARTNER_GAP);
      if (!placed.has(id)) box(id, x, y);
      centre.set(id, x + BOX.w / 2);
    });
    const self = /** @type {number} */ (centre.get(u.id));
    for (const p of u.partners) {
      if (p.id === null) continue;
      const other = /** @type {number} */ (centre.get(p.id));
      const [a, b] = other < self ? [other, self] : [self, other];
      lines.push({ key: `couple:${p.familyId}`, d: `M${a + BOX.w / 2} ${y + BOX.h / 2}H${b - BOX.w / 2}`, kind: 'couple', linkType: null });
    }
    const filled = u.groups.filter((g) => g.children.length > 0);
    const childrenWidth =
      filled.reduce((sum, g) => sum + g.children.reduce((s, c) => s + c.width, 0) + (g.children.length - 1) * COL_GAP, 0) +
      Math.max(0, filled.length - 1) * GROUP_GAP;
    let x = left + (u.width - childrenWidth) / 2;
    for (const g of filled) {
      const partner = u.partners.find((p) => p.familyId === g.familyId)?.id ?? null;
      const ox = partner ? (self + /** @type {number} */ (centre.get(partner))) / 2 : self;
      const oy = partner ? y + BOX.h / 2 : y + BOX.h;
      const bar = y + BOX.h + ROW_GAP / 2;
      const childTop = rowTop(generation - 1);
      /** @type {number[]} */
      const tops = [];
      for (const c of g.children) {
        const cx = place(c, x, generation - 1);
        tops.push(cx);
        const link = /** @type {ChildLink} */ (g.links.get(c.id));
        lines.push({ key: `child:${link.id}`, d: `M${cx} ${bar}V${childTop}`, kind: 'child', linkType: link.linkType });
        x += c.width + COL_GAP;
      }
      x += GROUP_GAP - COL_GAP;
      const from = Math.min(ox, ...tops);
      const to = Math.max(ox, ...tops);
      lines.push({ key: `parents:${g.familyId}`, d: `M${ox} ${oy}V${bar}M${from} ${bar}H${to}`, kind: 'parents', linkType: null });
    }
    return self;
  };

  const focus = unit(data.focusId, 0);
  const focusCentre = place(focus, 0, 0);
  // Centre the focus Person's box on x = 0.
  const shift = -focusCentre;
  for (const n of nodes) n.x += shift;
  for (const l of lines) l.d = shiftPath(l.d, shift);

  // ------------------------------------------------------------ ancestors

  /** @param {string} childId */
  const parentFamilies = (childId) =>
    (linksByChild.get(childId) ?? [])
      .map((l) => ({ link: l, family: familyById.get(l.familyId) }))
      .filter(
        /** @returns {x is { link: ChildLink, family: Family }} */
        (x) => x.family !== undefined && [x.family.partner1Id, x.family.partner2Id].some((id) => id !== null && entries.get(id)?.relation === 'ancestor'),
      )
      // A birth Family first, then the others in the order the API gives them.
      .sort((a, b) => Number(b.link.linkType === 'birth') - Number(a.link.linkType === 'birth'));

  /** @type {Set<string>} */
  const inTree = new Set([data.focusId]);
  /**
   * @param {string} childId
   * @param {number} generation 1 for the parents
   * @returns {Ancestors | null}
   */
  const ancestorsOf = (childId, generation) => {
    if (generation > data.up) return null;
    const chosen = parentFamilies(childId)[0];
    if (!chosen) return null;
    // A Person already drawn (pedigree collapse, a partner who is also an ancestor) is drawn once.
    const ids = [chosen.family.partner1Id, chosen.family.partner2Id].map((id) =>
      id !== null && entries.has(id) && !inTree.has(id) && !placed.has(id) ? id : null,
    );
    // The father above the mother when the sexes say so; otherwise in the Family's order.
    const sex = (/** @type {string | null} */ id) => (id ? entries.get(id)?.person.sex : undefined);
    const [top, bottom] = sex(ids[0]) === 'female' || sex(ids[1]) === 'male' ? [ids[1], ids[0]] : [ids[0], ids[1]];
    if (top === null && bottom === null) return null;
    if (top) inTree.add(top);
    if (bottom) inTree.add(bottom);
    /** @type {[Ancestors | null, Ancestors | null]} */
    const parents = [top ? ancestorsOf(top, generation + 1) : null, bottom ? ancestorsOf(bottom, generation + 1) : null];
    const slots = Math.max(1, (parents[0]?.slots ?? 0) + (parents[1]?.slots ?? 0));
    return { familyId: chosen.family.id, linkType: chosen.link.linkType, top, bottom, parents, slots };
  };

  /** @param {number} generation */
  const cardTop = (generation) => (0 - generation) * (CARD_H + ROW_GAP);

  /**
   * @param {Ancestors} a
   * @param {number} left
   * @param {number} generation
   * @returns {{ cx: number, bottom: number }} the card's centre x and bottom edge
   */
  const placeAncestors = (a, left, generation) => {
    const cx = left + (a.slots * SLOT) / 2;
    const x = cx - BOX.w / 2;
    const y = cardTop(generation);
    if (a.top) box(a.top, x, y);
    if (a.bottom) box(a.bottom, x, y + BOX.h + COUPLE_GAP);
    const [fatherSide, motherSide] = a.parents;
    const fatherSlots = fatherSide?.slots ?? 0;
    if (fatherSide) {
      const up = placeAncestors(fatherSide, left, generation + 1);
      const mid = up.bottom + ROW_GAP / 2;
      const side = Math.min(up.cx, x - 6);
      lines.push({
        key: `parents:${fatherSide.familyId}`,
        d: `M${up.cx} ${up.bottom}V${mid}H${side}V${y + BOX.h / 2}H${x}`,
        kind: 'parents',
        linkType: fatherSide.linkType,
      });
    }
    if (motherSide) {
      const up = placeAncestors(motherSide, left + fatherSlots * SLOT, generation + 1);
      const mid = up.bottom + ROW_GAP / 2;
      const side = Math.max(up.cx, x + BOX.w + 6);
      const row = a.top ? y + BOX.h + COUPLE_GAP + BOX.h / 2 : y + BOX.h / 2;
      lines.push({
        key: `parents:${motherSide.familyId}`,
        d: `M${up.cx} ${up.bottom}V${mid}H${side}V${row}H${x + BOX.w}`,
        kind: 'parents',
        linkType: motherSide.linkType,
      });
    }
    const bottom = a.bottom || !a.top ? y + CARD_H : y + BOX.h;
    return { cx, bottom };
  };

  const tree = ancestorsOf(data.focusId, 1);
  if (tree) {
    const parents = placeAncestors(tree, -(tree.slots * SLOT) / 2, 1);
    lines.push({ key: `parents:${tree.familyId}`, d: `M${parents.cx} ${parents.bottom}V0`, kind: 'parents', linkType: tree.linkType });
  }

  const otherParents = parentFamilies(data.focusId)
    .filter((x) => x.family.id !== tree?.familyId)
    .map((x) => ({
      familyId: x.family.id,
      linkType: x.link.linkType,
      parents: [x.family.partner1Id, x.family.partner2Id].flatMap((id) => {
        const e = id ? entries.get(id) : undefined;
        return e ? [e.person] : [];
      }),
    }));

  return { nodes, lines, bounds: boundsOf(nodes), otherParents };
}

/**
 * Moves the x coordinates of a path made of M, H and V commands.
 * @param {string} d
 * @param {number} dx
 */
function shiftPath(d, dx) {
  return d.replace(/([MH])(-?[\d.]+)/g, (_, cmd, x) => `${cmd}${Number(x) + dx}`);
}

/** @param {LayoutNode[]} nodes */
function boundsOf(nodes) {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    minX: Math.min(...nodes.map((n) => n.x)),
    minY: Math.min(...nodes.map((n) => n.y)),
    maxX: Math.max(...nodes.map((n) => n.x + BOX.w)),
    maxY: Math.max(...nodes.map((n) => n.y + BOX.h)),
  };
}

/**
 * The life years of a Person for a box: "1801–1850", "* 1936", "† 1850" or "".
 * @param {{ birth: string | null, death: string | null }} p
 */
export function lifeYears(p) {
  const year = (/** @type {string | null} */ d) => (d ? (/\d{4}/.exec(d)?.[0] ?? d) : null);
  const b = year(p.birth);
  const d = year(p.death);
  if (b && d) return `${b}–${d}`;
  if (b) return `* ${b}`;
  if (d) return `† ${d}`;
  return '';
}
