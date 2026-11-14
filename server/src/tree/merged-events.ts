import { agree, EVENT_DESCRIPTION_MAX, mergeOffer, NOTES_MAX, whereAgrees, type EventFacts, type EventRole, type OfferedEvent } from '@rodokmen/shared';
import { sql } from 'kysely';
import type { Db } from '../db/db.js';

/** How many merges a redirect follows at most (an Event merged, its kept Event merged again …). */
const MAX_STEPS = 10;

/**
 * The Event a merged Event now stands for (tree-read-api spec, "A merged Event answers with the
 * kept one"), or null when the id names no merged Event. A merge deletes the merged Event, so this
 * reads the log: the latest accepted `mergeEvents` operation that names it as `mergeId`, in a
 * Proposal not undone, and its `keepId`, following later merges of that Event in turn. An Event
 * whose merge was undone exists again and is never looked up here.
 */
export async function eventMergedInto(db: Db, id: string): Promise<string | null> {
  let current = id;
  for (let step = 0; step < MAX_STEPS; step++) {
    const merge = await db
      .selectFrom('proposal_operation as o')
      .innerJoin('proposal as p', 'p.id', 'o.proposal_id')
      .select(sql<string | null>`coalesce(o.corrected, o.operation)->>'keepId'`.as('keep_id'))
      .where('o.op', '=', 'mergeEvents')
      .where('o.target_table', '=', 'event')
      .where('o.target_id', '=', current)
      .where('p.status', '=', 'accepted')
      .where('p.undone_by_proposal_id', 'is', null)
      .orderBy('p.decided_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!merge?.keep_id) return null;
    const kept = await db.selectFrom('event').select('id').where('id', '=', merge.keep_id).executeTakeFirst();
    if (kept) return kept.id;
    current = merge.keep_id;
  }
  return null;
}

/** One of a Person's Events on their page: which Event, and the Person's Role in it. */
interface PersonEventRole {
  event_id: string;
  role: string;
}

/**
 * The pairs of a Person's Events the person page offers an Editor to merge (family-view spec,
 * "Merge duplicate Events from the person page"), each with the Event to keep first. The rule is
 * `mergeOffer` (shared/src/event-merge.ts); this reads its inputs. A Person can take part in
 * hundreds of Events in one Role (a priest, a godparent), so only pairs of one type and Role that
 * agree on date and Place, which the rule requires anyway, are read further: the Roles of their
 * Events, once each, in one query.
 */
export async function mergeableEvents(
  db: Db,
  personRoles: readonly PersonEventRole[],
  citationCounts: ReadonlyMap<string, number>,
): Promise<Array<{ keepId: string; mergeId: string }>> {
  const ids = [...new Set(personRoles.map((r) => r.event_id))];
  if (ids.length < 2) return [];
  const rows = await db
    .selectFrom('event')
    .select(['id', 'type', 'type_detail', 'date', 'place_id', 'house_id', 'description', 'notes', 'created_at'])
    .where('id', 'in', ids)
    .execute();
  const events = new Map(
    rows.map((e) => {
      const facts: EventFacts = {
        type: e.type,
        typeDetail: e.type_detail ?? '',
        date: e.date ?? '',
        placeId: e.place_id ?? '',
        houseId: e.house_id ?? '',
        description: e.description ?? '',
        notes: e.notes ?? '',
      };
      return [e.id, { facts, createdAt: new Date(e.created_at).getTime() }];
    }),
  );
  // The Person's Events by type and Role; within each, the pairs that agree on date and Place.
  const kinds = new Map<string, PersonEventRole[]>();
  for (const r of personRoles) {
    const e = events.get(r.event_id);
    if (e) kinds.set(`${e.facts.type}:${r.role}`, [...(kinds.get(`${e.facts.type}:${r.role}`) ?? []), r]);
  }
  const candidates: Array<[PersonEventRole, PersonEventRole]> = [];
  for (const list of kinds.values()) {
    for (const [i, a] of list.entries()) {
      for (const b of list.slice(i + 1)) {
        const [fa, fb] = [events.get(a.event_id)!.facts, events.get(b.event_id)!.facts];
        if (a.event_id !== b.event_id && agree(fa.date, fb.date) && whereAgrees(fa, fb)) candidates.push([a, b]);
      }
    }
  }
  if (candidates.length === 0) return [];
  const wanted = [...new Set(candidates.flatMap(([a, b]) => [a.event_id, b.event_id]))];
  const roles = new Map<string, EventRole[]>();
  for (const x of await db.selectFrom('event_role').select(['event_id', 'person_id', 'role']).where('event_id', 'in', wanted).execute())
    roles.set(x.event_id, [...(roles.get(x.event_id) ?? []), { personId: x.person_id, role: x.role }]);
  const offered = (r: PersonEventRole): OfferedEvent => {
    const e = events.get(r.event_id)!;
    return { facts: e.facts, roles: roles.get(r.event_id) ?? [], role: r.role, citations: citationCounts.get(r.event_id) ?? 0, createdAt: e.createdAt };
  };
  const pairs: Array<{ keepId: string; mergeId: string }> = [];
  for (const [a, b] of candidates) {
    const offer = mergeOffer(offered(a), offered(b), EVENT_DESCRIPTION_MAX, NOTES_MAX);
    if (offer.offered) pairs.push(offer.keepFirst ? { keepId: a.event_id, mergeId: b.event_id } : { keepId: b.event_id, mergeId: a.event_id });
  }
  return pairs;
}
