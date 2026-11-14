/**
 * The Descendant chart's model from the gathered rows (tree-charts spec, "Descendant chart",
 * "Direct line", "Size of a Chart"): the unverified shell around the proved rules of
 * shared/src/charts.ts. It indexes the rows, orders them, asks the rules who is in the Chart, at
 * which generation, on the Direct line and within 500 cards, and writes the nodes in the Chart's
 * order. The tests cover it, with golden models (shared/test/golden/charts/).
 *
 * The nodes are written depth first: a Person's Families earlier marriage first, each Family's
 * children by birth. Each selected Person has one main place, at the depth of their generation;
 * every later place is a card pointing to it. A Family is drawn under the first partner, in that
 * order, whose generation is the smaller; under the other it is a pointer.
 */
import { ChartIndex, chartContents, type ChartRows, type SheetOption } from './chart-rows.js';
import { cutToSize, directLine, goesOn, selectDescendants, type ChildEdge, type Selection } from './charts.js';
import type { DescendantChart, DescendantNode, LineRow, LineSibling } from './schemas/charts.js';

/** At most this many Person cards on a Chart (tree-charts spec, "Size of a Chart"). */
export const CARD_LIMIT = 500;
/** The Direct line goes at most this many generations down. */
export const LINE_GENERATIONS = 12;

export interface DescendantOptions {
  readonly start: { readonly personId: string } | { readonly familyId: string };
  readonly generations: number;
  readonly form: 'tree' | 'line';
  readonly line: string | null;
  readonly sheet: SheetOption;
}

/** The answer when the end of the Direct line does not descend from the start (the route's 422). */
export class NotADescendant extends Error {
  constructor() {
    super('The end of the Direct line does not descend from the start within 12 generations.');
    this.name = 'NotADescendant';
  }
}

/** The rows as indices for the proved rules. */
class Graph {
  readonly ids: string[];
  readonly at = new Map<string, number>();
  readonly familyIds: string[];
  readonly edges: ChildEdge[] = [];
  /** The child link behind each edge. */
  readonly linkOf: Array<{ familyId: string; childId: string }> = [];

  constructor(readonly index: ChartIndex) {
    this.ids = [...index.persons.keys()];
    this.ids.forEach((id, i) => this.at.set(id, i));
    // Families and their children are in the Chart's order, so the edges are too.
    this.familyIds = [...index.families.keys()];
    this.familyIds.forEach((fid, f) => {
      const fam = index.families.get(fid)!;
      for (const l of index.childrenOf.get(fid) ?? []) {
        const child = this.at.get(l.childId);
        if (child === undefined) continue;
        this.edges.push({
          family: f,
          a: this.indexOf(fam.partner1Id),
          b: this.indexOf(fam.partner2Id),
          child,
          followed: l.linkType === 'birth' || l.linkType === 'adoptive',
        });
        this.linkOf.push({ familyId: fid, childId: l.childId });
      }
    });
  }

  indexOf(id: string | null): number {
    return id === null ? -1 : (this.at.get(id) ?? -1);
  }
}

interface Start {
  personIndex: number;
  familyIndex: number;
  isStart: boolean[];
}

function startOf(graph: Graph, options: DescendantOptions): Start {
  const isStart = graph.ids.map(() => false);
  if ('personId' in options.start) {
    const p = graph.indexOf(options.start.personId);
    if (p >= 0) isStart[p] = true;
    return { personIndex: p, familyIndex: -1, isStart };
  }
  const f = graph.familyIds.indexOf(options.start.familyId);
  const fam = graph.index.families.get(options.start.familyId);
  const partners = [fam?.partner1Id ?? null, fam?.partner2Id ?? null].map((id) => graph.indexOf(id)).filter((i) => i >= 0);
  for (const p of partners) isStart[p] = true;
  return { personIndex: partners[0] ?? -1, familyIndex: f, isStart };
}

/** Writes the nodes depth first, down to `depth` generations, counting the cards of each generation. */
class TreeWriter {
  readonly nodes: DescendantNode[] = [];
  readonly cardsAt: number[];
  private readonly placed = new Set<string>();
  private readonly drawnFamilies = new Set<string>();

  constructor(
    private readonly graph: Graph,
    private readonly sel: Selection,
    private readonly start: Start,
    private readonly generations: number,
    private readonly depth: number,
  ) {
    this.cardsAt = Array.from({ length: generations }, () => 0);
  }

  private count(depth: number, n: number) {
    if (depth >= 1 && depth <= this.cardsAt.length) this.cardsAt[depth - 1]! += n;
  }

  /** Whether the Family's children are drawn under partner `p`: the first place among its partners of the smallest generation. */
  private drawsFamilyHere(familyIndex: number, p: number): boolean {
    const fam = this.graph.index.families.get(this.graph.familyIds[familyIndex]!)!;
    const gens = [fam.partner1Id, fam.partner2Id]
      .map((id) => this.graph.indexOf(id))
      .filter((q) => q >= 0 && goesOn(this.sel.gen, this.start.isStart, this.start.familyIndex, this.generations, familyIndex, q))
      .map((q) => this.sel.gen[q]!);
    return gens.length > 0 && this.sel.gen[p]! === Math.min(...gens);
  }

  /** May the Family be shown under `p` at all: from a start Family, its partners show only it. */
  private shows(familyIndex: number, p: number): boolean {
    return this.start.familyIndex < 0 || familyIndex === this.start.familyIndex || !this.start.isStart[p];
  }

  write(p: number, depth: number): string {
    const personId = this.graph.ids[p]!;
    this.placed.add(personId);
    const node: DescendantNode = {
      key: personId,
      personId,
      generation: this.sel.gen[p]!,
      followed: true,
      pointer: false,
      onLine: false,
      leftOut: 0,
      moreBelow: false,
      families: [],
    };
    this.nodes.push(node);
    this.count(depth, 1);
    for (const fam of this.graph.index.familiesOf.get(personId) ?? []) {
      const f = this.graph.familyIds.indexOf(fam.id);
      if (!this.shows(f, p)) continue;
      const partnerId = fam.partner1Id === personId ? fam.partner2Id : fam.partner1Id;
      const pointer = this.drawnFamilies.has(fam.id);
      const place = { familyId: fam.id, partnerId, pointer, children: [] as string[] };
      node.families.push(place);
      if (partnerId !== null || pointer) this.count(depth, 1);
      if (pointer) continue;
      const goes = goesOn(this.sel.gen, this.start.isStart, this.start.familyIndex, this.generations, f, p) && this.drawsFamilyHere(f, p);
      if (goes) this.drawnFamilies.add(fam.id);
      if (!goes || depth >= this.depth) continue;
      for (const l of this.graph.index.childrenOf.get(fam.id) ?? []) {
        const c = this.graph.indexOf(l.childId);
        if (c < 0) continue;
        const followed = l.linkType === 'birth' || l.linkType === 'adoptive';
        if (followed && this.sel.gen[c]! === depth + 1 && !this.placed.has(l.childId)) {
          place.children.push(this.write(c, depth + 1));
        } else {
          const key = `${l.childId}/${fam.id}`;
          place.children.push(key);
          this.nodes.push({
            key,
            personId: l.childId,
            generation: this.sel.gen[c]! || depth + 1,
            followed,
            pointer: this.sel.gen[c]! >= 1,
            onLine: false,
            leftOut: 0,
            moreBelow: false,
            families: [],
          });
          this.count(depth + 1, 1);
        }
      }
    }
    return personId;
  }
}

/** Whether a Person has followed children in the gathered rows. */
function hasChildren(graph: Graph, p: number): boolean {
  return graph.edges.some((e) => e.followed && (e.a === p || e.b === p));
}

function lineRows(graph: Graph, line: { persons: number[]; via: number[] }): { rows: LineRow[]; persons: Set<string>; families: Set<string> } {
  const index = graph.index;
  const persons = new Set<string>();
  const families = new Set<string>();
  const rows = line.persons.map((p, k): LineRow => {
    const personId = graph.ids[p]!;
    persons.add(personId);
    const edge = k < line.via.length ? line.via[k]! : -1;
    const familyId = edge >= 0 ? graph.linkOf[edge]!.familyId : (index.familiesOf.get(personId)?.[0]?.id ?? null);
    const nextId = k + 1 < line.persons.length ? graph.ids[line.persons[k + 1]!]! : null;
    if (familyId === null) return { personId, familyId: null, partnerId: null, children: [], nextId, siblings: [] };
    families.add(familyId);
    const fam = index.families.get(familyId)!;
    const partnerId = fam.partner1Id === personId ? fam.partner2Id : fam.partner1Id;
    if (partnerId !== null) persons.add(partnerId);
    const links = index.childrenOf.get(familyId) ?? [];
    for (const l of links) persons.add(l.childId);
    const nextAt = links.findIndex((l) => l.childId === nextId);
    const siblings: LineSibling[] = [];
    // Outward from the line: the nearest sibling first on each side.
    const left = nextAt < 0 ? [] : links.slice(0, nextAt).reverse();
    const right = nextAt < 0 ? [] : links.slice(nextAt + 1);
    for (const [side, list] of [
      ['left', left],
      ['right', right],
    ] as const) {
      for (const l of list) {
        const own = index.familiesOf.get(l.childId) ?? [];
        if (own.length === 0) continue;
        siblings.push({
          personId: l.childId,
          side,
          families: own.map((f) => {
            families.add(f.id);
            const partner = f.partner1Id === l.childId ? f.partner2Id : f.partner1Id;
            if (partner !== null) persons.add(partner);
            const kids = (index.childrenOf.get(f.id) ?? []).map((c) => c.childId);
            for (const kid of kids) persons.add(kid);
            return { familyId: f.id, partnerId: partner, children: kids };
          }),
        });
      }
    }
    return {
      personId,
      familyId,
      partnerId,
      children: links.map((l) => ({ personId: l.childId, linkType: l.linkType, weakLink: l.weakLink })),
      nextId,
      siblings,
    };
  });
  return { rows, persons, families };
}

/** The tree form's nodes: who is in it (proved), written depth first, cut to whole generations within 500 cards (proved). */
function treeNodes(graph: Graph, start: Start, generations: number, onLine: Set<string>) {
  const count = graph.ids.length;
  const sel = selectDescendants(count, start.isStart, start.familyIndex, graph.edges, generations);
  // Count the cards of every generation asked for, then keep as many whole generations as fit.
  const full = new TreeWriter(graph, sel, start, generations, generations);
  if (start.personIndex >= 0) full.write(start.personIndex, 1);
  const cut = cutToSize(count, sel.gen, sel.parent, full.cardsAt, CARD_LIMIT);
  const writer = cut.kept === generations ? full : new TreeWriter(graph, sel, start, generations, cut.kept);
  if (writer !== full && start.personIndex >= 0) writer.write(start.personIndex, 1);
  let leftOut = cut.total;
  for (const node of writer.nodes) {
    if (node.pointer || !node.followed) continue;
    const p = graph.indexOf(node.personId);
    node.onLine = onLine.has(node.personId);
    if (node.generation === cut.kept) {
      node.leftOut = cut.leftOut[p]!;
      node.moreBelow = hasChildren(graph, p);
    }
  }
  const nodes = trimSecondGeneration(writer, (dropped) => (leftOut += dropped));
  return { nodes, kept: cut.kept, leftOut };
}

/** The Descendant chart (tree-charts spec): who is in it, in what order, with which facts and marks. */
export function descendantChart(rows: ChartRows, options: DescendantOptions): DescendantChart {
  const index = new ChartIndex(rows);
  const graph = new Graph(index);
  const start = startOf(graph, options);
  const count = graph.ids.length;
  const line =
    options.line === null || start.personIndex < 0 || graph.indexOf(options.line) < 0
      ? null
      : directLine(count, graph.edges, start.personIndex, start.familyIndex, graph.indexOf(options.line), LINE_GENERATIONS);
  if (options.line !== null && (line === null || line.persons.length === 0)) throw new NotADescendant();
  const base = {
    kind: 'descendants' as const,
    form: options.form,
    start: 'personId' in options.start ? { personId: options.start.personId, familyId: null } : { personId: null, familyId: options.start.familyId },
    generations: options.generations,
    sheet: options.sheet,
    asOf: rows.asOf,
    livingOn: rows.livingOn,
    line: line === null ? [] : line.persons.map((p) => graph.ids[p]!),
  };
  if (options.form === 'line' && line !== null) {
    const l = lineRows(graph, line);
    const contents = chartContents(index, l.persons, l.families, options.sheet);
    return { ...base, shown: line.persons.length, leftOut: 0, cards: contents.persons.length, lineBeyond: false, nodes: [], rows: l.rows, ...contents };
  }
  const { nodes, kept, leftOut } = treeNodes(graph, start, options.generations, new Set(base.line));
  const persons = new Set<string>();
  const families = new Set<string>();
  for (const n of nodes) {
    persons.add(n.personId);
    for (const f of n.families) {
      families.add(f.familyId);
      if (f.partnerId !== null) persons.add(f.partnerId);
    }
  }
  const contents = chartContents(index, persons, families, options.sheet);
  const cards = nodes.reduce((n, node) => n + cardsOf(node), 0);
  return { ...base, shown: kept, leftOut, cards, lineBeyond: base.line.length > kept, nodes, rows: [], ...contents };
}

/**
 * The one case the proved cut leaves to the shell: when even two generations hold more than 500
 * cards, the second is cut in the Chart's order, and the start's mark counts those left out.
 */
/** The cards a node draws: its own, and a partner or pointer card for each Family. */
const cardsOf = (node: DescendantNode): number => 1 + node.families.filter((f) => f.partnerId !== null || f.pointer).length;

function trimSecondGeneration(writer: TreeWriter, addLeftOut: (n: number) => void): DescendantNode[] {
  const nodes = writer.nodes;
  const cards = nodes.reduce((n, node) => n + cardsOf(node), 0);
  if (cards <= CARD_LIMIT || nodes.length === 0) return nodes;
  const root = nodes[0]!;
  const keep = new Set<string>([root.key]);
  let used = cardsOf(root);
  let dropped = 0;
  for (const place of root.families) {
    place.children = place.children.filter((key) => {
      const child = nodes.find((n) => n.key === key)!;
      const size = cardsOf(child);
      if (used + size > CARD_LIMIT) {
        dropped += 1 + child.leftOut;
        return false;
      }
      used += size;
      keep.add(key);
      return true;
    });
  }
  root.leftOut += dropped;
  root.moreBelow = root.moreBelow || dropped > 0;
  addLeftOut(dropped);
  return nodes.filter((n) => keep.has(n.key));
}
