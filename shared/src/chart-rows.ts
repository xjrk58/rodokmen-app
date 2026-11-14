/**
 * What the server gathers for a Chart (server/src/charts/), and the cards made from it: the
 * facts on each Person's card, the marriage of each Family, the order keys of children and
 * Families, and the Sources behind the facts shown (tree-charts spec, "What a card shows",
 * "Marks on cards", "What a Sheet holds").
 *
 * This is the unverified shell around the proved rules of shared/src/charts.ts and
 * shared/src/export.ts: it reads dates and picks Events, and the tests cover it. It never
 * depends on the order the rows come in: every choice is by a date, then by an id.
 */
import { compareChildren, compareFamilies, ymdKey, diedYoung, type ChildKey, type FamilyKey } from './charts.js';
import { parseEdtf } from './edtf.js';
import type { ChartFact, ChartFamily, ChartPerson, ChartSource } from './schemas/charts.js';
import type { ChartRows, RowChildLink, RowEvent, RowFamily, RowName, RowPerson, RowSource } from './chart-row-types.js';
import { mayShowOnSheet, sheetCard } from './sheet-reduction.js';

export type { ChartRows, RowChildLink, RowEvent, RowFamily, RowName, RowPerson, RowRole, RowSource } from './chart-row-types.js';

export type SheetOption = 'reduced' | 'nameless' | null;

/** Code-unit order of ids: the same on every device. */
export const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** An ISO day as an integer `yyyymmdd`. */
export function isoKey(iso: string): number {
  const [y = 0, m = 0, d = 0] = iso.split('-').map(Number);
  return ymdKey(y, m, d);
}

/** The earliest and latest day keys of an EDTF date: null for an open end, and both null when undated. */
export function dateKeys(date: string | null): { dated: boolean; earliest: number | null; latest: number | null } {
  if (date === null) return { dated: false, earliest: null, latest: null };
  const parsed = parseEdtf(date);
  return { dated: true, earliest: parsed.earliest === null ? null : isoKey(parsed.earliest), latest: parsed.latest === null ? null : isoKey(parsed.latest) };
}

/** Events by their earliest day (open starts first, undated last), then by id: one order whatever the rows' order. */
export function compareEvents(a: RowEvent, b: RowEvent): number {
  const ka = dateKeys(a.date);
  const kb = dateKeys(b.date);
  if (ka.dated !== kb.dated) return ka.dated ? -1 : 1;
  const ea = ka.earliest ?? 0;
  const eb = kb.earliest ?? 0;
  return ea !== eb ? ea - eb : byId(a.id, b.id);
}

/** The Tree's rows by id, and each Person's Events by Role. */
export class ChartIndex {
  readonly persons = new Map<string, RowPerson>();
  readonly families = new Map<string, RowFamily>();
  /** Each Family's child links, in the Chart's order once {@link sortChildren} has run. */
  readonly childrenOf = new Map<string, RowChildLink[]>();
  /** Each Person's Families as a partner, in the Chart's order. */
  readonly familiesOf = new Map<string, RowFamily[]>();
  readonly sources = new Map<string, RowSource>();
  private readonly eventsOf = new Map<string, Array<{ e: RowEvent; role: string }>>();

  constructor(readonly rows: ChartRows) {
    for (const p of rows.persons) this.persons.set(p.id, p);
    for (const s of rows.sources) this.sources.set(s.id, s);
    for (const e of [...rows.events].sort(compareEvents)) {
      for (const r of e.roles) this.eventsOf.set(r.personId, [...(this.eventsOf.get(r.personId) ?? []), { e, role: r.role }]);
    }
    const families = [...rows.families].sort((a, b) => compareFamilies(this.familyKey(a), this.familyKey(b)));
    for (const f of families) {
      this.families.set(f.id, f);
      this.childrenOf.set(f.id, []);
      for (const p of [f.partner1Id, f.partner2Id]) if (p !== null) this.familiesOf.set(p, [...(this.familiesOf.get(p) ?? []), f]);
    }
    for (const l of rows.childLinks) this.childrenOf.get(l.familyId)?.push(l);
    for (const list of this.childrenOf.values()) list.sort((a, b) => compareChildren(this.childKey(a), this.childKey(b)));
  }

  /** The Events a Person has a Role in, in date order, of the given types and Role. */
  eventsWith(personId: string, types: readonly string[], role: string): RowEvent[] {
    return (this.eventsOf.get(personId) ?? []).filter((x) => x.role === role && types.includes(x.e.type)).map((x) => x.e);
  }

  /** A Family's marriage: the first marriage Event in which its partners have the Role partner. */
  marriageOf(f: RowFamily): RowEvent | null {
    const partners = [f.partner1Id, f.partner2Id].filter((p): p is string => p !== null);
    if (partners.length === 0) return null;
    const own = this.eventsWith(partners[0]!, ['marriage'], 'partner');
    return own.find((e) => partners.every((p) => e.roles.some((r) => r.personId === p && r.role === 'partner'))) ?? null;
  }

  familyKey(f: RowFamily): FamilyKey {
    const m = this.marriageOf(f);
    const k = dateKeys(m?.date ?? null);
    return { dated: k.dated, day: k.earliest ?? 0, id: f.id };
  }

  childKey(l: RowChildLink): ChildKey {
    const births = this.eventsWith(l.childId, ['birth', 'baptism'], 'child').map((e) => dateKeys(e.date));
    const dated = births.filter((k) => k.dated);
    const day = dated.length === 0 ? 0 : Math.min(...dated.map((k) => k.earliest ?? 0));
    return { dated: dated.length > 0, day, recorded: l.order, id: l.childId };
  }

  living(id: string): boolean {
    // Unknown means Living, as in an Export: a fact is shown only when nobody Living took part.
    return this.persons.get(id)?.living ?? true;
  }
}

const FACT_TYPES = ['birth', 'baptism', 'death', 'burial', 'marriage'] as const;

function factOf(e: RowEvent): ChartFact {
  return {
    eventId: e.id,
    // Only births, baptisms, deaths, burials and marriages become facts on a card.
    type: FACT_TYPES.find((t) => t === e.type) ?? 'birth',
    date: e.date,
    placeId: e.placeId,
    place: e.place,
    houseId: e.houseId,
    houseNumber: e.houseNumber,
  };
}

/** The first of the Events, else the first of the others: a birth else a baptism, a death else a burial. */
const firstOf = (main: readonly RowEvent[], other: readonly RowEvent[]): RowEvent | null => main[0] ?? other[0] ?? null;

/** The card's facts from the Person's Events that may be shown. */
function cardFacts(events: readonly RowEvent[]) {
  const of = (type: string) => events.filter((e) => e.type === type);
  const born = firstOf(of('birth'), of('baptism'));
  const died = firstOf(of('death'), of('burial'));
  // Died young: the earliest day of the birth (else the baptism), the latest day of the death (else the burial).
  const birthDays = (of('birth').length > 0 ? of('birth') : of('baptism')).map((e) => dateKeys(e.date)).filter((k) => k.earliest !== null);
  const deathEvents = of('death').length > 0 ? of('death') : of('burial');
  const deathDays = deathEvents.map((e) => dateKeys(e.date));
  const birthKey = birthDays.length === 0 ? null : Math.min(...birthDays.map((k) => k.earliest ?? 0));
  const deathKnown = deathDays.length > 0 && deathDays.every((k) => k.latest !== null);
  const deathKey = deathKnown ? Math.max(...deathDays.map((k) => k.latest ?? 0)) : 0;
  const young = birthKey !== null && diedYoung(true, Math.floor(birthKey / 10000), Math.floor(birthKey / 100) % 100, birthKey % 100, deathKnown, deathKey);
  const yearDays = [...of('birth'), ...of('baptism')].map((e) => dateKeys(e.date).earliest).filter((k): k is number => k !== null);
  const birthYear = yearDays.length === 0 ? null : Math.floor(Math.min(...yearDays) / 10000);
  return { born, died, diedYoung: young, birthYear };
}

/** The surname of the birth Name, when the primary Name is a married name with another surname. */
function birthSurnameOf(names: readonly RowName[]): string | null {
  const primary = names.find((n) => n.primary);
  if (!primary || primary.type !== 'married') return null;
  const birth = names
    .filter((n) => n.type === 'birth' && n.surname !== '' && n.surname !== primary.surname)
    .sort((a, b) => a.order - b.order || byId(a.id, b.id))[0];
  return birth?.surname ?? null;
}

/** What a card shows of a Person: everything on screen, or their Sheet view on a Sheet. */
function shownOf(index: ChartIndex, p: RowPerson | undefined, id: string, sheet: SheetOption) {
  const candidates = [...index.eventsWith(id, ['birth', 'baptism'], 'child'), ...index.eventsWith(id, ['death', 'burial'], 'deceased')];
  const names = p?.names ?? [];
  const all = cardFacts(candidates);
  if (sheet === null) return { name: names.find((n) => n.primary) ?? null, birthSurname: birthSurnameOf(names), facts: all, birthYear: all.birthYear };
  const reduced = sheetCard(p ?? null, id, names, candidates, all.birthYear, sheet === 'nameless', (pid) => index.living(pid));
  return { name: reduced.name, birthSurname: reduced.birthSurname, facts: cardFacts(reduced.events), birthYear: reduced.birthYear };
}

/** A Person's card, and the Events whose facts it shows (for the Sources). */
export function cardOf(index: ChartIndex, id: string, sheet: SheetOption): { card: ChartPerson; shown: RowEvent[] } {
  const p = index.persons.get(id);
  const living = p?.living ?? true;
  const shown = shownOf(index, p, id, sheet);
  const { born, died } = shown.facts;
  const card: ChartPerson = {
    id,
    sex: p?.sex ?? 'unknown',
    relation: p?.relation ?? 'unrelated',
    familyRoot: p?.familyRoot ?? false,
    living,
    given: shown.name?.given ?? '',
    surname: shown.name?.surname ?? '',
    birthSurname: shown.birthSurname,
    born: born && factOf(born),
    died: died && factOf(died),
    birthYear: shown.birthYear,
    diedYoung: shown.facts.diedYoung,
    reduced: sheet !== null && living,
    nameless: sheet === 'nameless' && living,
  };
  return { card, shown: [born, died].filter((e): e is RowEvent => e !== null) };
}

/** A Family on the Chart, its children in the Chart's order, and its marriage when it may be shown. */
export function familyOf(index: ChartIndex, id: string, sheet: SheetOption): { family: ChartFamily; shown: RowEvent[] } {
  const f = index.families.get(id)!;
  const marriage = index.marriageOf(f);
  // On a Sheet, a marriage in which a Living person took part is left out, as in an Export.
  const mayShow = marriage !== null && (sheet === null || mayShowOnSheet(marriage, (pid) => index.living(pid)));
  const children = (index.childrenOf.get(id) ?? []).map((l) => ({ personId: l.childId, linkType: l.linkType, weakLink: l.weakLink }));
  const family: ChartFamily = {
    id,
    partner1Id: f.partner1Id,
    partner2Id: f.partner2Id,
    marriage: mayShow ? factOf(marriage) : null,
    weakLink: f.weakLink,
    children,
  };
  return { family, shown: mayShow ? [marriage] : [] };
}

/** The Sources cited for the facts shown, by title in code units, then by id. */
export function sourcesOf(index: ChartIndex, shown: readonly RowEvent[]): ChartSource[] {
  const ids = new Set(shown.flatMap((e) => e.sourceIds));
  return [...ids]
    .map((sid) => index.sources.get(sid))
    .filter((s): s is RowSource => s !== undefined)
    .map((s) => ({ id: s.id, title: s.title }))
    .sort((a, b) => byId(a.title, b.title) || byId(a.id, b.id));
}

/** Every Person and Family the Chart names, with the Sources behind what it shows. */
export function chartContents(index: ChartIndex, personIds: Iterable<string>, familyIds: Iterable<string>, sheet: SheetOption) {
  const shown: RowEvent[] = [];
  const persons = [...new Set(personIds)].sort(byId).map((id) => {
    const c = cardOf(index, id, sheet);
    shown.push(...c.shown);
    return c.card;
  });
  const families = [...new Set(familyIds)].sort(byId).map((id) => {
    const f = familyOf(index, id, sheet);
    shown.push(...f.shown);
    return f.family;
  });
  return { persons, families, sources: sourcesOf(index, shown) };
}
