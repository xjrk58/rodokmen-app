import {
  foldForSearch,
  parseEdtf,
  type EstateDetail,
  type HouseDetail,
  type HouseSummary,
  type ParishDetail,
  type PlaceDetail,
  type PlaceSummary,
} from '@rodokmen/shared';
import { sql } from 'kysely';
import type { Db } from '../db/db.js';
import { periodOf } from './dates.js';
import { containsPattern, compareEarliestDays, geoPoint, lat, lon, placeRefs, summarizeEvents } from './summaries.js';

function placeSummary(r: {
  id: string;
  version: number;
  type: PlaceSummary['type'];
  name: string;
  lat: number | null;
  lon: number | null;
  municipality_code: string | null;
  municipality_name: string | null;
}): PlaceSummary {
  return {
    id: r.id,
    version: r.version,
    type: r.type,
    name: r.name,
    location: geoPoint(r),
    municipality: r.municipality_code && r.municipality_name ? { code: r.municipality_code, name: r.municipality_name } : null,
  };
}

function basePlaceQuery(db: Db) {
  return db
    .selectFrom('place as p')
    .innerJoin('place_name as pn', (j) => j.onRef('pn.place_id', '=', 'p.id').on('pn.is_primary', '=', true))
    .select(['p.id', 'p.version', 'p.type', 'pn.name', lat('p.location').as('lat'), lon('p.location').as('lon'), 'p.municipality_code', 'p.municipality_name']);
}

/** Places by any of their names, ignoring case and diacritics. */
export async function searchPlaces(db: Db, q: { q?: string | undefined; limit: number; offset: number }): Promise<PlaceSummary[]> {
  let query = basePlaceQuery(db);
  if (q.q) {
    const needle = containsPattern(foldForSearch(q.q));
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('place_name as other')
          .select(sql`1`.as('x'))
          .whereRef('other.place_id', '=', 'p.id')
          .where('other.search_text', 'like', sql<string>`rdk_fold(${needle})`),
      ),
    );
  }
  const rows = await query.orderBy('pn.name').orderBy('p.id').limit(q.limit).offset(q.offset).execute();
  return rows.map(placeSummary);
}

async function housesOf(db: Db, where: { placeId?: string; houseIds?: string[] }): Promise<HouseSummary[]> {
  let q = db.selectFrom('house as h').select(['h.id', 'h.version', 'h.place_id', 'h.note', lat('h.location').as('lat'), lon('h.location').as('lon')]);
  if (where.placeId) q = q.where('h.place_id', '=', where.placeId);
  if (where.houseIds) {
    if (where.houseIds.length === 0) return [];
    q = q.where('h.id', 'in', where.houseIds);
  }
  const houses = await q.execute();
  if (houses.length === 0) return [];
  const numbers = await db
    .selectFrom('house_number')
    .select(['id', 'version', 'house_id', 'number', 'period_from', 'period_to', 'valid_from'])
    .where(
      'house_id',
      'in',
      houses.map((h) => h.id),
    )
    .orderBy('valid_from')
    .execute();
  const out = houses.map((h) => ({
    id: h.id,
    version: h.version,
    placeId: h.place_id,
    location: geoPoint(h),
    note: h.note,
    numbers: numbers
      .filter((n) => n.house_id === h.id)
      .map((n) => ({ id: n.id, version: n.version, houseId: n.house_id, number: n.number, period: periodOf(n) })),
  }));
  // Order by the current (latest) house number, numerically.
  const current = (h: HouseSummary) => Number.parseInt(h.numbers.at(-1)?.number ?? '0', 10);
  return out.sort((a, b) => current(a) - current(b) || a.id.localeCompare(b.id));
}

export async function getPlace(db: Db, id: string): Promise<PlaceDetail | null> {
  const row = await basePlaceQuery(db).select('p.notes').where('p.id', '=', id).executeTakeFirst();
  if (!row) return null;
  const names = await db.selectFrom('place_name').selectAll().where('place_id', '=', id).orderBy('is_primary', 'desc').orderBy('valid_from').execute();
  const parishes = await db
    .selectFrom('place_parish as l')
    .innerJoin('parish as x', 'x.id', 'l.parish_id')
    .select(['l.id as linkId', 'l.version as linkVersion', 'l.period_from', 'l.period_to', 'x.id', 'x.version', 'x.name'])
    .where('l.place_id', '=', id)
    .orderBy('l.valid_from')
    .execute();
  const estates = await db
    .selectFrom('place_estate as l')
    .innerJoin('estate as x', 'x.id', 'l.estate_id')
    .select(['l.id as linkId', 'l.version as linkVersion', 'l.period_from', 'l.period_to', 'x.id', 'x.version', 'x.name'])
    .where('l.place_id', '=', id)
    .orderBy('l.valid_from')
    .execute();
  return {
    ...placeSummary(row),
    names: names.map((n) => ({
      id: n.id,
      version: n.version,
      placeId: n.place_id,
      name: n.name,
      language: n.language,
      primary: n.is_primary,
      period: periodOf(n),
    })),
    parishes: parishes.map((p) => ({
      linkId: p.linkId,
      linkVersion: p.linkVersion,
      period: periodOf(p),
      parish: { id: p.id, version: p.version, name: p.name },
    })),
    estates: estates.map((e) => ({
      linkId: e.linkId,
      linkVersion: e.linkVersion,
      period: periodOf(e),
      estate: { id: e.id, version: e.version, name: e.name },
    })),
    houses: await housesOf(db, { placeId: id }),
    notes: row.notes,
  };
}

/**
 * The House of a Place that carried a house number (čp.) at a date. After a renumbering the
 * same number can belong to another House, so the date decides.
 */
export async function findHousesByNumber(db: Db, placeId: string, number: string, at: string): Promise<HouseSummary[]> {
  const parsed = parseEdtf(at);
  const rows = await db
    .selectFrom('house_number as n')
    .innerJoin('house as h', 'h.id', 'n.house_id')
    .select('h.id')
    .where('h.place_id', '=', placeId)
    .where('n.number', '=', number)
    .where('n.valid_from', '<=', parsed.latest ?? 'infinity')
    .where('n.valid_to', '>=', parsed.earliest ?? '-infinity')
    .execute();
  return housesOf(db, { houseIds: [...new Set(rows.map((r) => r.id))] });
}

export async function getHouse(db: Db, id: string): Promise<HouseDetail | null> {
  const [house] = await housesOf(db, { houseIds: [id] });
  if (!house) return null;
  const place = (await placeRefs(db, [house.placeId])).get(house.placeId)!;
  const events = await db
    .selectFrom('event')
    .select(['id', 'version', 'type', 'type_detail', 'date', 'date_earliest', 'date_latest', 'place_id', 'house_id', 'description'])
    .where('house_id', '=', id)
    .execute();
  events.sort((a, b) => compareEarliestDays(a.date_earliest, b.date_earliest) || a.id.localeCompare(b.id));
  const { notes } = await db.selectFrom('house').select('notes').where('id', '=', id).executeTakeFirstOrThrow();
  return { ...house, place, events: await summarizeEvents(db, events), notes };
}

/** Parishes a Place belonged to during a date range (an Event's earliest..latest). */
export async function parishesAt(db: Db, placeId: string, earliest: string | null, latest: string | null) {
  return db
    .selectFrom('place_parish as l')
    .innerJoin('parish as x', 'x.id', 'l.parish_id')
    .select(['x.id', 'x.version', 'x.name'])
    .where('l.place_id', '=', placeId)
    .where('l.valid_from', '<=', latest ?? 'infinity')
    .where('l.valid_to', '>=', earliest ?? '-infinity')
    .orderBy('l.valid_from')
    .execute();
}

/** Estates a Place was part of during a date range. */
export async function estatesAt(db: Db, placeId: string, earliest: string | null, latest: string | null) {
  return db
    .selectFrom('place_estate as l')
    .innerJoin('estate as x', 'x.id', 'l.estate_id')
    .select(['x.id', 'x.version', 'x.name'])
    .where('l.place_id', '=', placeId)
    .where('l.valid_from', '<=', latest ?? 'infinity')
    .where('l.valid_to', '>=', earliest ?? '-infinity')
    .orderBy('l.valid_from')
    .execute();
}

async function linkedPlaces(db: Db, table: 'place_parish' | 'place_estate', column: 'parish_id' | 'estate_id', id: string) {
  const links = await db
    .selectFrom(table)
    .select(['id', 'place_id', 'period_from', 'period_to', 'valid_from'])
    .where(column, '=', id)
    .orderBy('valid_from')
    .execute();
  const places = await placeRefs(
    db,
    links.map((l) => l.place_id),
  );
  return links.map((l) => ({ linkId: l.id, period: periodOf(l), place: places.get(l.place_id)! }));
}

export async function getParish(db: Db, id: string): Promise<ParishDetail | null> {
  const p = await db.selectFrom('parish').select(['id', 'version', 'name', 'seat_place_id', 'notes']).where('id', '=', id).executeTakeFirst();
  if (!p) return null;
  return {
    id: p.id,
    version: p.version,
    name: p.name,
    seatPlaceId: p.seat_place_id,
    places: await linkedPlaces(db, 'place_parish', 'parish_id', id),
    notes: p.notes,
  };
}

export async function getEstate(db: Db, id: string): Promise<EstateDetail | null> {
  const e = await db.selectFrom('estate').select(['id', 'version', 'name', 'notes']).where('id', '=', id).executeTakeFirst();
  if (!e) return null;
  return { id: e.id, version: e.version, name: e.name, places: await linkedPlaces(db, 'place_estate', 'estate_id', id), notes: e.notes };
}
