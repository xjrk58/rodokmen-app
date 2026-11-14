/**
 * The House chart's model from the gathered rows (tree-charts spec, "House chart", "Succession
 * in a House chart", "Size of a Chart"): the unverified shell around the proved rules of
 * shared/src/house-chart.ts. It puts each Role at an Event at the House into a row (the child's
 * Family for a birth, the couple's for a marriage, the Person's Family at the date otherwise),
 * asks the rules for the periods, the order and the links, and keeps at most 80 rows. The tests
 * cover it, with golden models (shared/test/golden/charts/).
 *
 * On a Sheet, an Event at the House in which a Living person took part is left out before
 * anything else, as in an Export, so that no row, period or mark comes from one.
 */
import { byId, ChartIndex, chartContents, dateKeys, type ChartRows, type RowEvent, type SheetOption } from './chart-rows.js';
import { CHILD, compareRows, DAUGHTER, familyAt, houseRows, placesAtHouse, REMARRIAGE, SON, succession, type Placement, type RowChild } from './house-chart.js';
import type { HouseChart, HouseRow } from './schemas/charts.js';
import { mayShowOnSheet } from './sheet-reduction.js';

/** At most this many rows on a House chart (tree-charts spec, "Size of a Chart"). */
export const ROW_LIMIT = 80;

export interface HouseNumberRow {
  readonly number: string;
  /** The period as the Tree records it (EDTF), for the title. */
  readonly from: string | null;
  readonly to: string | null;
  /** The stored days of the period: '-infinity' and 'infinity' for open ends. */
  readonly validFrom: string;
  readonly validTo: string;
}

export interface HouseChartRows extends ChartRows {
  readonly house: { readonly id: string; readonly placeId: string; readonly place: string | null; readonly numbers: readonly HouseNumberRow[] };
}

export interface HouseOptions {
  readonly from: number | null;
  readonly to: number | null;
  readonly unrelated: boolean;
  readonly sheet: SheetOption;
}

/** The kind of a proved link, as the model names it. */
function linkKind(kind: number): 'son' | 'daughter' | 'child' | 'remarriage' | 'none' {
  if (kind === SON) return 'son';
  if (kind === DAUGHTER) return 'daughter';
  if (kind === CHILD) return 'child';
  return kind === REMARRIAGE ? 'remarriage' : 'none';
}
const rowOwn = (personId: string) => personId;

interface RowPlan {
  key: string;
  familyId: string | null;
  a: string | null;
  b: string | null;
}

/** Puts each placing Role of each Event at the House into a row. */
function plan(index: ChartIndex, events: readonly RowEvent[]) {
  const rows = new Map<string, RowPlan>();
  const placements: Array<{ key: string; e: RowEvent; role: string }> = [];
  const familyRow = (familyId: string) => {
    const f = index.families.get(familyId)!;
    if (!rows.has(familyId)) rows.set(familyId, { key: familyId, familyId, a: f.partner1Id, b: f.partner2Id });
    return familyId;
  };
  const ownRow = (personId: string) => {
    const key = rowOwn(personId);
    if (!rows.has(key)) rows.set(key, { key, familyId: null, a: personId, b: null });
    return key;
  };
  const birthFamily = (personId: string): string | null => {
    const links = index.rows.childLinks.filter(
      (l) => l.childId === personId && (l.linkType === 'birth' || l.linkType === 'adoptive') && index.families.has(l.familyId),
    );
    links.sort((x, y) => (x.linkType === y.linkType ? 0 : x.linkType === 'birth' ? -1 : 1) || byId(x.familyId, y.familyId));
    return links[0]?.familyId ?? null;
  };
  const later: Array<{ e: RowEvent; personId: string; role: string }> = [];
  for (const e of events) {
    for (const r of e.roles) {
      if (!placesAtHouse(e.type, r.role)) continue;
      if (e.type === 'birth' || e.type === 'baptism') {
        const child = e.roles.find((x) => x.role === 'child')?.personId ?? null;
        const fam = child === null ? null : birthFamily(child);
        placements.push({ key: fam !== null ? familyRow(fam) : ownRow(r.personId), e, role: r.role });
      } else if (e.type === 'marriage') {
        const partners = e.roles.filter((x) => x.role === 'partner').map((x) => x.personId);
        const fam = (index.familiesOf.get(r.personId) ?? []).find(
          (f) => partners.length === 2 && partners.every((p) => p === f.partner1Id || p === f.partner2Id),
        );
        placements.push({ key: fam ? familyRow(fam.id) : ownRow(r.personId), e, role: r.role });
      } else {
        const own = index.familiesOf.get(r.personId) ?? [];
        const keys = own.map((f) => dateKeys(index.marriageOf(f)?.date ?? null));
        const day = dateKeys(e.date);
        const at = familyAt(
          keys.map((k) => k.dated && k.earliest !== null),
          keys.map((k) => k.earliest ?? 0),
          day.latest === null,
          day.latest ?? 0,
        );
        if (at >= 0) placements.push({ key: familyRow(own[at]!.id), e, role: r.role });
        else later.push({ e, personId: r.personId, role: r.role });
      }
    }
  }
  // Someone without such a Family: the row of their birth Family if that row exists, else a row of their own.
  for (const { e, personId, role } of later) {
    const fam = birthFamily(personId);
    placements.push({ key: fam !== null && rows.has(fam) ? fam : ownRow(personId), e, role });
  }
  return { rows, placements };
}

/** Whether a period (ISO days, null for open) overlaps the years asked for. */
function overlaps(row: HouseRow, from: number | null, to: number | null): boolean {
  if (!row.dated) return from === null && to === null;
  const start = from === null ? null : `${String(from).padStart(4, '0')}-01-01`;
  const end = to === null ? null : `${String(to).padStart(4, '0')}-12-31`;
  return (end === null || row.earliest === null || row.earliest <= end) && (start === null || row.latest === null || row.latest >= start);
}

const isoOf = (key: number) =>
  `${String(Math.floor(key / 10000)).padStart(4, '0')}-${String(Math.floor(key / 100) % 100).padStart(2, '0')}-${String(key % 100).padStart(2, '0')}`;

/** The house numbers whose stored period overlaps the row's; for an undated row, those with no period. */
function numbersOf(numbers: readonly HouseNumberRow[], row: { dated: boolean; earliest: string | null; latest: string | null }): string[] {
  const rank = (d: string) => (d === '-infinity' ? '0000' : d === 'infinity' ? '9999-99-99' : d);
  const hits = numbers.filter((n) =>
    row.dated
      ? rank(n.validFrom) <= (row.latest ?? '9999-99-99') && (row.earliest ?? '0000') <= rank(n.validTo)
      : n.validFrom === '-infinity' && n.validTo === 'infinity',
  );
  return [...new Set((numbers.length === 1 ? numbers : hits).map((n) => n.number))];
}

/** The House chart (tree-charts spec): the Families who lived at a House, in order, with their periods and links. */
export function houseChart(rows: HouseChartRows, options: HouseOptions): HouseChart {
  const index = new ChartIndex(rows);
  const living = (id: string) => index.living(id);
  const atHouse = rows.events
    .filter((e) => e.houseId === rows.house.id)
    .filter((e) => options.sheet === null || mayShowOnSheet(e, living))
    .sort((a, b) => byId(a.id, b.id));
  const { rows: planned, placements } = plan(index, atHouse);
  const keys = [...planned.keys()].sort(byId);
  const at = new Map(keys.map((k, i) => [k, i]));
  const proved = houseRows(
    keys.length,
    placements.map((p): Placement => {
      const d = dateKeys(p.e.date);
      return {
        row: at.get(p.key)!,
        type: p.e.type,
        role: p.role,
        dated: d.dated,
        openStart: d.earliest === null,
        openEnd: d.latest === null,
        earliest: d.earliest ?? 0,
        latest: d.latest ?? 0,
      };
    }),
  );
  const bornHere = new Set(
    atHouse.filter((e) => e.type === 'birth' || e.type === 'baptism').flatMap((e) => e.roles.filter((r) => r.role === 'child').map((r) => r.personId)),
  );
  const diedHere = new Set(
    atHouse.filter((e) => e.type === 'death' || e.type === 'burial').flatMap((e) => e.roles.filter((r) => r.role === 'deceased').map((r) => r.personId)),
  );
  const relationOf = (id: string | null) => (id === null ? 'unrelated' : (index.persons.get(id)?.relation ?? 'unrelated'));
  const all = keys
    .map((key, r) => {
      const p = planned.get(key)!;
      const children = p.familyId === null ? [] : (index.childrenOf.get(p.familyId) ?? []);
      const members = [p.a, p.b, ...children.map((c) => c.childId)].filter((id): id is string => id !== null);
      const period = {
        dated: proved.dated[r]!,
        earliest: proved.dated[r]! && !proved.openStart[r]! ? isoOf(proved.earliest[r]!) : null,
        latest: proved.dated[r]! && !proved.openEnd[r]! ? isoOf(proved.latest[r]!) : null,
      };
      const row: HouseRow = {
        key,
        familyId: p.familyId,
        partner1Id: p.a,
        partner2Id: p.b,
        ...period,
        numbers: numbersOf(rows.house.numbers, period),
        children: children.map((c) => ({ personId: c.childId, linkType: c.linkType, weakLink: c.weakLink, bornHere: bornHere.has(c.childId) })),
        diedHere: members.filter((id) => diedHere.has(id)).sort(byId),
        link: { kind: 'none', rowKey: null, personId: null },
        marriedIn: null,
        unrelated: [p.a, p.b].filter((id) => id !== null).every((id) => relationOf(id) === 'unrelated'),
      };
      return { row, sortKey: { dated: period.dated, day: proved.openStart[r]! ? 0 : proved.earliest[r]!, key } };
    })
    .sort((x, y) => compareRows(x.sortKey, y.sortKey))
    .map((x) => x.row);
  const related = options.unrelated ? all : all.filter((row) => !row.unrelated);
  const years = related
    .filter((row) => row.dated)
    .flatMap((row) => [row.earliest, row.latest].filter((d): d is string => d !== null).map((d) => Number(d.slice(0, 4))));
  const inPeriod = related.filter((row) => overlaps(row, options.from, options.to));
  const needsPeriod = inPeriod.length > ROW_LIMIT;
  const shown = needsPeriod ? [] : inPeriod;
  linkRows(index, shown);
  const persons = shown.flatMap((row) => [row.partner1Id, row.partner2Id, ...row.children.map((c) => c.personId)]).filter((id): id is string => id !== null);
  const contents = chartContents(
    index,
    persons,
    shown.map((row) => row.familyId).filter((id): id is string => id !== null),
    options.sheet,
  );
  return {
    kind: 'house',
    house: {
      id: rows.house.id,
      placeId: rows.house.placeId,
      place: rows.house.place,
      numbers: rows.house.numbers.map((n) => ({ number: n.number, from: n.from, to: n.to })),
    },
    from: options.from,
    to: options.to,
    unrelated: options.unrelated,
    firstYear: years.length === 0 ? null : Math.min(...years),
    lastYear: years.length === 0 ? null : Math.max(...years),
    total: inPeriod.length,
    hiddenUnrelated: all.length - related.length,
    needsPeriod,
    rows: shown,
    sheet: options.sheet,
    asOf: rows.asOf,
    livingOn: rows.livingOn,
    ...contents,
  };
}

/** Links each shown row to an earlier one through Family links (the proved succession). */
function linkRows(index: ChartIndex, shown: HouseRow[]): void {
  const ids = [...index.persons.keys()];
  const at = new Map(ids.map((id, i) => [id, i]));
  const of = (id: string | null) => (id === null ? -1 : (at.get(id) ?? -1));
  const children: RowChild[] = shown.flatMap((row, r) =>
    row.familyId === null ? [] : (index.childrenOf.get(row.familyId) ?? []).map((c) => ({ child: of(c.childId), row: r })).filter((c) => c.child >= 0),
  );
  const s = succession(
    shown.map((row) => of(row.partner1Id)),
    shown.map((row) => of(row.partner2Id)),
    ids.map((id) => index.persons.get(id)!.sex),
    children,
  );
  shown.forEach((row, r) => {
    const kind = s.kind[r]!;
    const from = s.from[r]!;
    row.link =
      from < 0 ? { kind: 'none', rowKey: null, personId: null } : { kind: linkKind(kind), rowKey: shown[from]!.key, personId: ids[s.through[r]!] ?? null };
    row.marriedIn = s.marriedIn[r]! >= 0 ? ids[s.marriedIn[r]!]! : null;
  });
}
