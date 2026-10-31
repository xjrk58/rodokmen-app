import {
  isoDay,
  parseRelationFilter,
  type EventDetail,
  type FamilyDetail,
  type MapEventsQuery,
  type MapEventsResult,
  type PlaceEvents,
} from '@rodokmen/shared';
import { sql } from 'kysely';
import type { Db } from '../db/db.js';
import type { TreeDeps } from './persons.js';
import { estatesAt, parishesAt } from './places.js';
import { citationSummariesFor } from './sources.js';
import { displayName, compareEarliestDays, eventSummaries, personSummaries, placeRefs, summarizeEvents } from './summaries.js';

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
  const persons = await personSummaries(
    db,
    roles.map((r) => r.person_id),
    clock,
  );
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
  const children = await db
    .selectFrom('family_child')
    .select(['id', 'version', 'child_id', 'link_type'])
    .where('family_id', '=', id)
    .orderBy('sort_order')
    .orderBy('id')
    .execute();
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
            eb.exists(
              eb
                .selectFrom('event_role as r')
                .select(sql`1`.as('x'))
                .whereRef('r.event_id', '=', 'e.id')
                .where('r.person_id', '=', pid)
                .where('r.role', '=', 'partner'),
            ),
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
 * House (else Place) lies inside the bounding box. Undated Events are left out. With a relation
 * filter, only Events in which someone of those relations takes part (tree-read-api spec, "Filter
 * by relation to the family"); every Person of an Event comes with their relation.
 */
export async function mapEvents(db: Db, q: MapEventsQuery): Promise<MapEventsResult> {
  // MapEventsQuery checked that bbox is four numbers.
  const [minLon = 0, minLat = 0, maxLon = 0, maxLat = 0] = q.bbox.split(',').map(Number);
  const from = isoDay(Math.min(q.from, q.to), 1, 1);
  const to = isoDay(Math.max(q.from, q.to), 12, 31);
  const envelope = sql`ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)`;
  const location = sql`coalesce(h.location, p.location)::geometry`;
  // MapEventsQuery checked that the filter names at least one relation.
  const relations = parseRelationFilter(q.relation);
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
    .$if(relations !== null, (w) =>
      w.where((eb) =>
        eb.exists(
          eb
            .selectFrom('event_role as fr')
            .innerJoin('person as fp', 'fp.id', 'fr.person_id')
            .select(sql`1`.as('x'))
            .whereRef('fr.event_id', '=', 'e.id')
            .where('fp.relation', 'in', relations ?? []),
        ),
      ),
    )
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
        .innerJoin('person as rp', 'rp.id', 'r.person_id')
        .select(['r.event_id', 'r.person_id', 'r.role', 'n.given', 'n.surname', 'rp.relation'])
        .where(
          'r.event_id',
          'in',
          kept.map((r) => r.id),
        )
        .orderBy('r.sort_order')
        .execute()
    : [];
  // Every kept row has a location: the query only keeps rows whose House or Place lies in the area.
  const locations = new Map(kept.map((r) => [r.id, { lat: r.lat, lon: r.lon }]));
  return {
    truncated,
    events: summaries.map((s) => ({
      id: s.id,
      version: s.version,
      type: s.type,
      date: s.date,
      earliest: s.earliest,
      latest: s.latest,
      location: locations.get(s.id)!,
      place: s.place,
      house: s.house,
      persons: roles
        .filter((r) => r.event_id === s.id)
        .map((r) => ({ id: r.person_id, displayName: displayName(r.given, r.surname), role: r.role, relation: r.relation })),
    })),
  };
}

/**
 * The Events at a Place and at its Houses, with who took part (family-map spec, "Family here"):
 * the place sheet groups them by Person. Ordered by the earliest date each could be.
 */
export async function placeEvents({ db, clock }: TreeDeps, placeId: string, limit: number): Promise<PlaceEvents | null> {
  const place = (await placeRefs(db, [placeId])).get(placeId);
  if (!place) return null;
  const rows = await db
    .selectFrom('event as e')
    .leftJoin('house as h', 'h.id', 'e.house_id')
    .select(['e.id', 'e.version', 'e.type', 'e.type_detail', 'e.date', 'e.date_earliest', 'e.date_latest', 'e.place_id', 'e.house_id', 'e.description'])
    .where((eb) => eb.or([eb('e.place_id', '=', placeId), eb('h.place_id', '=', placeId)]))
    .orderBy(sql`e.date_earliest asc nulls last`)
    .orderBy('e.id')
    .limit(limit + 1)
    .execute();
  const kept = rows.slice(0, limit);
  const summaries = await summarizeEvents(db, kept);
  const roles = kept.length
    ? await db
        .selectFrom('event_role')
        .select(['event_id', 'person_id', 'role', 'role_detail'])
        .where(
          'event_id',
          'in',
          kept.map((r) => r.id),
        )
        .orderBy('sort_order')
        .orderBy('id')
        .execute()
    : [];
  const persons = await personSummaries(
    db,
    roles.map((r) => r.person_id),
    clock,
  );
  return {
    place,
    truncated: rows.length > limit,
    events: summaries.map((e) => ({
      ...e,
      persons: roles.filter((r) => r.event_id === e.id).map((r) => ({ role: r.role, roleDetail: r.role_detail, person: persons.get(r.person_id)! })),
    })),
  };
}
