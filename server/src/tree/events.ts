import { isoDay, type EventDetail, type FamilyDetail, type MapEventsQuery, type MapEventsResult } from '@rodokmen/shared';
import { sql } from 'kysely';
import type { Db } from '../db/db.js';
import type { TreeDeps } from './persons.js';
import { estatesAt, parishesAt } from './places.js';
import { citationSummariesFor } from './sources.js';
import { displayName, compareEarliestDays, eventSummaries, geoPoint, personSummaries, summarizeEvents } from './summaries.js';

export async function getEvent({ db, clock }: TreeDeps, id: string): Promise<EventDetail | null> {
  const [summary] = await eventSummaries(db, [id]);
  if (!summary) return null;
  const roles = await db
    .selectFrom('event_role')
    .select(['id', 'version', 'person_id', 'role', 'role_detail'])
    .where('event_id', '=', id)
    .orderBy('sort_order')
    .orderBy('id')
    .execute();
  const persons = await personSummaries(db, roles.map((r) => r.person_id), clock);
  const citations = await citationSummariesFor(db, 'event', [id]);
  const placeId = summary.place?.id ?? null;
  const dated = summary.date !== null;
  return {
    ...summary,
    roles: roles.map((r) => ({ id: r.id, version: r.version, role: r.role, roleDetail: r.role_detail, person: persons.get(r.person_id)! })),
    citations: citations.get(id) ?? [],
    parishes: placeId && dated ? await parishesAt(db, placeId, summary.earliest, summary.latest) : [],
    estates: placeId && dated ? await estatesAt(db, placeId, summary.earliest, summary.latest) : [],
  };
}

export async function getFamily({ db, clock }: TreeDeps, id: string): Promise<FamilyDetail | null> {
  const f = await db.selectFrom('family').select(['id', 'version', 'partner1_id', 'partner2_id']).where('id', '=', id).executeTakeFirst();
  if (!f) return null;
  const children = await db.selectFrom('family_child').select(['id', 'version', 'child_id', 'link_type']).where('family_id', '=', id).orderBy('sort_order').orderBy('id').execute();
  const partnerIds = [f.partner1_id, f.partner2_id].filter((x): x is string => x !== null);
  const persons = await personSummaries(db, [...partnerIds, ...children.map((c) => c.child_id)], clock);

  // The Family's Events: those in which every known partner takes part as a partner.
  let events: FamilyDetail['events'] = [];
  if (partnerIds.length > 0) {
    const rows = await db
      .selectFrom('event as e')
      .select(['e.id', 'e.version', 'e.type', 'e.type_detail', 'e.date', 'e.date_earliest', 'e.date_latest', 'e.place_id', 'e.house_id', 'e.description'])
      .where((eb) =>
        eb.and(
          partnerIds.map((pid) =>
            eb.exists(eb.selectFrom('event_role as r').select(sql`1`.as('x')).whereRef('r.event_id', '=', 'e.id').where('r.person_id', '=', pid).where('r.role', '=', 'partner')),
          ),
        ),
      )
      .execute();
    rows.sort((a, b) => compareEarliestDays(a.date_earliest, b.date_earliest) || a.id.localeCompare(b.id));
    events = await summarizeEvents(db, rows);
  }
  return {
    id: f.id,
    version: f.version,
    partners: [
      ...(f.partner1_id ? [{ position: 1 as const, person: persons.get(f.partner1_id)! }] : []),
      ...(f.partner2_id ? [{ position: 2 as const, person: persons.get(f.partner2_id)! }] : []),
    ],
    children: children.map((c) => ({ linkId: c.id, linkVersion: c.version, linkType: c.link_type, person: persons.get(c.child_id)! })),
    events,
  };
}

/**
 * Events for the map: those whose possible date range overlaps the year range and whose
 * House (else Place) lies inside the bounding box. Undated Events are left out.
 */
export async function mapEvents(db: Db, q: MapEventsQuery): Promise<MapEventsResult> {
  const [minLon, minLat, maxLon, maxLat] = q.bbox.split(',').map(Number) as [number, number, number, number];
  const from = isoDay(Math.min(q.from, q.to), 1, 1);
  const to = isoDay(Math.max(q.from, q.to), 12, 31);
  const envelope = sql`ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)`;
  const location = sql`coalesce(h.location, p.location)::geometry`;
  const rows = await db
    .selectFrom('event as e')
    .leftJoin('house as h', 'h.id', 'e.house_id')
    .leftJoin('place as p', (j) => j.on(sql<boolean>`p.id = coalesce(e.place_id, h.place_id)`))
    .select([
      'e.id',
      'e.version',
      'e.type',
      'e.type_detail',
      'e.date',
      'e.date_earliest',
      'e.date_latest',
      'e.place_id',
      'e.house_id',
      'e.description',
      sql<number>`ST_Y(${location})`.as('lat'),
      sql<number>`ST_X(${location})`.as('lon'),
    ])
    .where('e.date_earliest', '<=', to)
    .where('e.date_latest', '>=', from)
    .where(sql<boolean>`${location} && ${envelope}`)
    .where(sql<boolean>`ST_Intersects(${location}, ${envelope})`)
    .orderBy('e.date_earliest')
    .orderBy('e.id')
    .limit(q.limit + 1)
    .execute();
  const truncated = rows.length > q.limit;
  const kept = rows.slice(0, q.limit);
  const summaries = await summarizeEvents(db, kept);
  const roles = kept.length
    ? await db
        .selectFrom('event_role as r')
        .innerJoin('name as n', (j) => j.onRef('n.person_id', '=', 'r.person_id').on('n.is_primary', '=', true))
        .select(['r.event_id', 'r.person_id', 'r.role', 'n.given', 'n.surname'])
        .where('r.event_id', 'in', kept.map((r) => r.id))
        .orderBy('r.sort_order')
        .execute()
    : [];
  return {
    truncated,
    events: summaries.map((s, i) => ({
      id: s.id,
      version: s.version,
      type: s.type,
      date: s.date,
      earliest: s.earliest,
      latest: s.latest,
      location: geoPoint(kept[i]!)!,
      place: s.place,
      house: s.house,
      persons: roles.filter((r) => r.event_id === s.id).map((r) => ({ id: r.person_id, displayName: displayName(r.given, r.surname), role: r.role })),
    })),
  };
}
