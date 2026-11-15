import {
  buildKinshipGraph,
  KinshipSearch,
  kinshipPaths,
  kinshipShort,
  type Kinship,
  type KinshipData,
  type KinshipGraph,
  type KinshipShort,
  type PersonSummary,
} from '@rodokmen/shared';
import { sql } from 'kysely';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import { familyLinks } from './relation.js';
import { personSummaries } from './summaries.js';

/**
 * Kinship on the server (kinship spec; design.md, "Computed on the server from a copy of the
 * Family links kept in memory"): gathers the Family links with their link types, the Persons'
 * sex and the marriage Events, keeps them in memory per state of the Tree, and answers with the
 * rules of shared/ (proved in kinship.ts, listed by kinship-paths.ts). Nothing about kinship is
 * stored, and none of it goes into an Export.
 *
 * The state of the Tree is the newest accepted change (every Proposal, direct change, merge,
 * undo and Family root writes a log entry) and the newest erasure, which deletes records without
 * one. A request reads it with one query; when it changed, the link copy is rebuilt once, and
 * requests that arrive meanwhile wait for the same rebuild. Each server process keeps its own.
 */

export interface LinkCopy {
  key: string;
  graph: KinshipGraph;
  asOf: Kinship['asOf'];
}

const copies = new WeakMap<Db, { key: string; copy: Promise<LinkCopy> }>();

/** The state of the Tree a link copy belongs to: how many log entries and erasures, and the newest of each. */
async function treeState(db: Db): Promise<{ key: string; asOf: Kinship['asOf'] }> {
  const { rows } = await sql<{ entries: number; newest: string | null; at: Date | null; erasures: number; erased: Date | null }>`
    select (select count(*) from log_entry) as entries,
      newest.id as newest, newest.accepted_at as at,
      (select count(*) from erasure) as erasures,
      (select max(erased_at) from erasure) as erased
    from (select 1) as one
    left join lateral (select id, accepted_at from log_entry order by accepted_at desc, id desc limit 1) as newest on true`.execute(db);
  const r = rows[0]!;
  const at = r.at ? new Date(r.at).toISOString() : null;
  const erased = r.erased ? new Date(r.erased).toISOString() : '';
  return { key: `${r.entries}|${r.newest ?? ''}|${r.erasures}|${erased}`, asOf: { logEntryId: r.newest, at } };
}

/** The Family links of the Tree as kinship reads them (shared/src/kinship-graph.ts). */
export async function gatherKinshipData(db: Db): Promise<KinshipData> {
  const persons = await db.selectFrom('person').select(['id', 'sex']).where('merged_into_id', 'is', null).execute();
  const families = await sql<{ id: string; partner1_id: string | null; partner2_id: string | null; married: boolean }>`
    select f.id, f.partner1_id, f.partner2_id,
      exists (
        select 1 from event e
        join event_role r1 on r1.event_id = e.id and r1.person_id = f.partner1_id and r1.role = 'partner'
        join event_role r2 on r2.event_id = e.id and r2.person_id = f.partner2_id and r2.role = 'partner'
        where e.type = 'marriage'
      ) as married
    from family f`.execute(db);
  const links = await familyLinks(db);
  const partnerConfidences = new Map(links.filter((l) => l.kind === 'partner').map((l) => [l.recordId, l.confidences]));
  const familyOf = new Map(families.rows.map((f) => [f.id, f]));
  const childLinks = new Map<string, KinshipData['childLinks'][number] & { confidences1: string[]; confidences2: string[] }>();
  for (const l of links) {
    if (l.kind !== 'parent' || l.linkType === null) continue;
    const f = familyOf.get(l.familyId);
    if (!f) continue;
    const link = childLinks.get(l.recordId) ?? { id: l.recordId, familyId: l.familyId, childId: l.b, type: l.linkType, confidences1: [], confidences2: [] };
    if (l.a === f.partner1_id) link.confidences1 = [...l.confidences];
    else if (l.a === f.partner2_id) link.confidences2 = [...l.confidences];
    childLinks.set(l.recordId, link);
  }
  return {
    persons: persons.map((p) => ({ id: p.id, sex: p.sex })),
    families: families.rows.map((f) => ({
      id: f.id,
      partner1: f.partner1_id,
      partner2: f.partner2_id,
      married: f.married,
      confidences: partnerConfidences.get(f.id) ?? [],
    })),
    childLinks: [...childLinks.values()],
  };
}

/** The link copy for the Tree as it is now: the kept one, or one rebuilt once for all requests that ask meanwhile. */
export async function linkCopy(db: Db): Promise<LinkCopy> {
  const state = await treeState(db);
  const cached = copies.get(db);
  if (cached?.key === state.key) return cached.copy;
  const copy = gatherKinshipData(db).then((data) => ({ key: state.key, graph: buildKinshipGraph(data), asOf: state.asOf }));
  copies.set(db, { key: state.key, copy });
  // A failed rebuild is not kept: the next request tries again.
  copy.catch(() => {
    if (copies.get(db)?.copy === copy) copies.delete(db);
  });
  return copy;
}

/**
 * The kinship of `toId` to `fromId`, with the Persons its paths name. Null when either is not a
 * Person of the Tree (merged Persons are followed by the route before).
 */
export async function kinshipBetween(deps: { db: Db; clock: Clock }, fromId: string, toId: string): Promise<Kinship | null> {
  const copy = await linkCopy(deps.db);
  const from = copy.graph.index.get(fromId);
  const to = copy.graph.index.get(toId);
  if (from === undefined || to === undefined) return null;
  const r = kinshipPaths(new KinshipSearch(copy.graph, from), to);
  const ids = new Set([fromId, toId]);
  for (const p of r.paths) for (const id of [...p.commonAncestors, ...p.steps.map((s) => s.person)]) ids.add(id);
  for (const s of r.connection?.steps ?? []) ids.add(s.person);
  const summaries = await personSummaries(deps.db, [...ids], deps.clock);
  const persons = [...ids]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap((id) => {
      const s = summaries.get(id);
      return s ? [s] : [];
    });
  return { from: fromId, to: toId, asOf: copy.asOf, paths: r.paths, more: r.more, connection: r.connection, persons };
}

/**
 * Fills the short form of kinship on Person summaries for a reader with an own Person
 * (`fromId`): the first path's term and marks, and how many others. A Person with no kinship
 * gets null. The reader's chains are computed once for all of them.
 */
export async function fillKinship(db: Db, fromId: string, summaries: readonly PersonSummary[]): Promise<void> {
  if (summaries.length === 0) return;
  const copy = await linkCopy(db);
  const from = copy.graph.index.get(fromId);
  if (from === undefined) return;
  const search = new KinshipSearch(copy.graph, from);
  const known = new Map<string, KinshipShort | null>();
  for (const summary of summaries) {
    if (!known.has(summary.id)) {
      const to = copy.graph.index.get(summary.id);
      const s = to === undefined ? null : kinshipShort(search, to);
      known.set(
        summary.id,
        s && { kind: s.first.kind, term: s.first.term, possible: s.first.possible, line: s.first.line, degree: s.first.degree, others: s.others, more: s.more },
      );
    }
    summary.kinship = known.get(summary.id) ?? null;
  }
}
