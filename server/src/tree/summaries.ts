import { compareByEarliest, isLiving, livingFactsFromEvents, parseEdtf, type EventSummary, type GeoPoint, type HouseRef, type PersonSummary, type PlaceRef } from '@rodokmen/shared';
import { sql } from 'kysely';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import { dayOrNull } from './dates.js';


/** Latitude and longitude of a geography(Point) column, for a select list. */
export const lat = (column: string) => sql<number | null>`ST_Y(${sql.ref(column)}::geometry)`;
export const lon = (column: string) => sql<number | null>`ST_X(${sql.ref(column)}::geometry)`;

/** A LIKE pattern that finds the text anywhere, with LIKE's own characters taken literally. */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, '\\$&')}%`;
}

export function geoPoint(row: { lat: number | null; lon: number | null }): GeoPoint | null {
  return row.lat === null || row.lon === null ? null : { lat: row.lat, lon: row.lon };
}

export function displayName(given: string, surname: string): string {
  return `${given} ${surname}`.trim();
}

/** Summaries (primary Name, Living, birth and death) of many Persons in two queries. */
export async function personSummaries(db: Db, ids: readonly string[], clock: Clock): Promise<Map<string, PersonSummary>> {
  const out = new Map<string, PersonSummary>();
  if (ids.length === 0) return out;
  const unique = [...new Set(ids)];
  const persons = await db
    .selectFrom('person as p')
    .innerJoin('name as n', (j) => j.onRef('n.person_id', '=', 'p.id').on('n.is_primary', '=', true))
    .select(['p.id', 'p.version', 'p.sex', 'n.given', 'n.surname'])
    .where('p.id', 'in', unique)
    .execute();
  const vital = await db
    .selectFrom('event_role as r')
    .innerJoin('event as e', 'e.id', 'r.event_id')
    .select(['r.person_id', 'e.type', 'r.role', 'e.date'])
    .where('r.person_id', 'in', unique)
    .where((eb) =>
      eb.or([
        eb.and([eb('e.type', 'in', ['birth', 'baptism']), eb('r.role', '=', 'child')]),
        eb.and([eb('e.type', 'in', ['death', 'burial']), eb('r.role', '=', 'deceased')]),
      ]),
    )
    .execute();
  const byPerson = new Map<string, typeof vital>();
  for (const v of vital) {
    const list = byPerson.get(v.person_id) ?? [];
    list.push(v);
    byPerson.set(v.person_id, list);
  }
  const today = clock.now();
  const earliestOf = (dates: Array<string | null>): string | null => {
    const parsed = dates.filter((d): d is string => d !== null).map(parseEdtf).sort(compareByEarliest);
    return parsed[0]?.input ?? null;
  };
  for (const p of persons) {
    const events = byPerson.get(p.id) ?? [];
    out.set(p.id, {
      id: p.id,
      version: p.version,
      sex: p.sex,
      given: p.given,
      surname: p.surname,
      displayName: displayName(p.given, p.surname),
      living: isLiving(livingFactsFromEvents(events), today),
      birth: earliestOf(events.filter((e) => e.type === 'birth' || e.type === 'baptism').map((e) => e.date)),
      death: earliestOf(events.filter((e) => e.type === 'death' || e.type === 'burial').map((e) => e.date)),
    });
  }
  return out;
}

export async function placeRefs(db: Db, ids: readonly string[]): Promise<Map<string, PlaceRef>> {
  const out = new Map<string, PlaceRef>();
  if (ids.length === 0) return out;
  const rows = await db
    .selectFrom('place as p')
    .innerJoin('place_name as n', (j) => j.onRef('n.place_id', '=', 'p.id').on('n.is_primary', '=', true))
    .select(['p.id', 'p.version', 'n.name', lat('p.location').as('lat'), lon('p.location').as('lon')])
    .where('p.id', 'in', [...new Set(ids)])
    .execute();
  for (const r of rows) out.set(r.id, { id: r.id, version: r.version, name: r.name, location: geoPoint(r) });
  return out;
}

export interface HouseNumberRow {
  house_id: string;
  number: string;
  valid_from: string;
  valid_to: string;
}

/** Which number a House carried for a date range: the one whose period overlaps it; null when unclear. */
export function numberAt(numbers: readonly HouseNumberRow[], earliest: string | null, latest: string | null): string | null {
  if (numbers.length === 1) return numbers[0]!.number;
  if (earliest === null && latest === null) return null;
  const from = earliest ?? '-infinity';
  const to = latest ?? 'infinity';
  const overlap = numbers.filter((n) => dayLe(n.valid_from, to) && dayLe(from, n.valid_to));
  return overlap.length === 1 ? overlap[0]!.number : null;
}

/** Compares stored days, where '-infinity' < any day < 'infinity'. */
export function dayLe(a: string, b: string): boolean {
  const rank = (d: string) => (d === '-infinity' ? '0000' : d === 'infinity' ? '9999-99-99' : d);
  return rank(a) <= rank(b);
}

export async function houseNumbers(db: Db, houseIds: readonly string[]): Promise<Map<string, HouseNumberRow[]>> {
  const out = new Map<string, HouseNumberRow[]>();
  if (houseIds.length === 0) return out;
  const rows = await db
    .selectFrom('house_number')
    .select(['house_id', 'number', 'valid_from', 'valid_to'])
    .where('house_id', 'in', [...new Set(houseIds)])
    .orderBy('valid_from')
    .execute();
  for (const r of rows) out.set(r.house_id, [...(out.get(r.house_id) ?? []), r]);
  return out;
}

interface EventRow {
  id: string;
  version: number;
  type: EventSummary['type'];
  type_detail: string | null;
  date: string | null;
  date_earliest: string | null;
  date_latest: string | null;
  place_id: string | null;
  house_id: string | null;
  description: string | null;
}

/** Event summaries with Place and House (number at the Event date), in the order of `ids`. */
export async function eventSummaries(db: Db, ids: readonly string[]): Promise<EventSummary[]> {
  if (ids.length === 0) return [];
  const rows: EventRow[] = await db
    .selectFrom('event')
    .select(['id', 'version', 'type', 'type_detail', 'date', 'date_earliest', 'date_latest', 'place_id', 'house_id', 'description'])
    .where('id', 'in', [...new Set(ids)])
    .execute();
  return summarizeEvents(db, rows, ids);
}

export async function summarizeEvents(db: Db, rows: EventRow[], order?: readonly string[]): Promise<EventSummary[]> {
  const houseIds = rows.map((r) => r.house_id).filter((x): x is string => x !== null);
  const houses = houseIds.length
    ? await db
        .selectFrom('house')
        .select(['id', 'version', 'place_id', lat('location').as('lat'), lon('location').as('lon')])
        .where('id', 'in', [...new Set(houseIds)])
        .execute()
    : [];
  const houseById = new Map(houses.map((h) => [h.id, h]));
  const numbers = await houseNumbers(db, houseIds);
  const placeIds = [...rows.map((r) => r.place_id), ...houses.map((h) => h.place_id)].filter((x): x is string => x !== null);
  const places = await placeRefs(db, placeIds);
  const byId = new Map(
    rows.map((r): [string, EventSummary] => {
      const h = r.house_id ? houseById.get(r.house_id) : undefined;
      const house: HouseRef | null = h
        ? { id: h.id, version: h.version, placeId: h.place_id, number: numberAt(numbers.get(h.id) ?? [], dayOrNull(r.date_earliest), dayOrNull(r.date_latest)), location: geoPoint(h) }
        : null;
      const placeId = r.place_id ?? h?.place_id ?? null;
      return [
        r.id,
        {
          id: r.id,
          version: r.version,
          type: r.type,
          typeDetail: r.type_detail,
          date: r.date,
          earliest: dayOrNull(r.date_earliest),
          latest: dayOrNull(r.date_latest),
          place: placeId ? (places.get(placeId) ?? null) : null,
          house,
          description: r.description,
        },
      ];
    }),
  );
  const ids = order ?? rows.map((r) => r.id);
  return ids.map((id) => byId.get(id)).filter((e): e is EventSummary => e !== undefined);
}

/**
 * Orders stored earliest days (date_earliest): open starts first, undated last, so that lists of
 * Events read from the earliest known one. Unlike compareByEarliest in shared/src/edtf.ts, which
 * ranks parsed dates and puts undated (null) first; the server only gives it dated values.
 */
export function compareEarliestDays(a: string | null, b: string | null): number {
  const rank = (day: string | null) => (day === null ? 2 : day === '-infinity' ? 0 : 1);
  return rank(a) - rank(b) || (a !== null && b !== null && a !== b ? (a < b ? -1 : 1) : 0);
}
