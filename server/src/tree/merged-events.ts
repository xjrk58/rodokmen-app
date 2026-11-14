import { EVENT_DESCRIPTION_MAX, mergeOffer, NOTES_MAX, type OfferedEvent } from '@rodokmen/shared';
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
 * `mergeOffer` (shared/src/event-merge.ts); this reads its inputs, only for Events of a type the
 * Person has twice in the same Role.
 */
export async function mergeableEvents(
  db: Db,
  personRoles: readonly PersonEventRole[],
  citationCounts: ReadonlyMap<string, number>,
): Promise<Array<{ keepId: string; mergeId: string }>> {
  const ids = [...new Set(personRoles.map((r) => r.event_id))];
  if (ids.length < 2) return [];
  const events = new Map(
    (
      await db
        .selectFrom('event')
        .select(['id', 'type', 'type_detail', 'date', 'place_id', 'house_id', 'description', 'notes', 'created_at'])
        .where('id', 'in', ids)
        .execute()
    ).map((e) => [e.id, e]),
  );
  const kindOf = (r: PersonEventRole) => `${events.get(r.event_id)?.type ?? ''}:${r.role}`;
  const counts = new Map<string, number>();
  for (const r of personRoles) counts.set(kindOf(r), (counts.get(kindOf(r)) ?? 0) + 1);
  const candidates = personRoles.filter((r) => events.has(r.event_id) && (counts.get(kindOf(r)) ?? 0) > 1);
  if (candidates.length < 2) return [];
  const roles = await db
    .selectFrom('event_role')
    .select(['event_id', 'person_id', 'role'])
    .where(
      'event_id',
      'in',
      candidates.map((c) => c.event_id),
    )
    .execute();
  const offered = (r: PersonEventRole): OfferedEvent => {
    const e = events.get(r.event_id)!;
    return {
      facts: {
        type: e.type,
        typeDetail: e.type_detail ?? '',
        date: e.date ?? '',
        placeId: e.place_id ?? '',
        houseId: e.house_id ?? '',
        description: e.description ?? '',
        notes: e.notes ?? '',
      },
      roles: roles.filter((x) => x.event_id === r.event_id).map((x) => ({ personId: x.person_id, role: x.role })),
      role: r.role,
      citations: citationCounts.get(r.event_id) ?? 0,
      createdAt: new Date(e.created_at).getTime(),
    };
  };
  const pairs: Array<{ keepId: string; mergeId: string }> = [];
  for (const [i, a] of candidates.entries()) {
    for (const b of candidates.slice(i + 1)) {
      if (a.event_id === b.event_id || kindOf(a) !== kindOf(b)) continue;
      const offer = mergeOffer(offered(a), offered(b), EVENT_DESCRIPTION_MAX, NOTES_MAX);
      if (offer.offered) pairs.push(offer.keepFirst ? { keepId: a.event_id, mergeId: b.event_id } : { keepId: b.event_id, mergeId: a.event_id });
    }
  }
  return pairs;
}
