import type { LeadChange, LeadDetail, LeadListQuery, LeadSource, LeadView, SearchRecordView } from '@rodokmen/shared';
import { sql } from 'kysely';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import type { Lead } from '../db/lead-types.js';
import { authorRef } from '../proposals/views.js';
import { personSummaries, placeRefs } from '../tree/summaries.js';

/**
 * Reading Research leads (research-leads spec): the views every Member and Agent sees, with the
 * linked Persons and Places, the register, the search records and, for one lead, its history.
 * A link to a Person who was merged into another shows the Person kept.
 */

const iso = (d: Date | string): string => new Date(d).toISOString();
const yearsOf = (from: number | null, to: number | null) => (from !== null && to !== null ? { from, to } : null);

async function accountRefs(db: Db, ids: Iterable<string | null>) {
  const list = [...new Set([...ids].filter((x): x is string => x !== null))];
  if (list.length === 0) return new Map<string, ReturnType<typeof authorRef>>();
  const rows = await db.selectFrom('account').select(['id', 'display_name', 'role']).where('id', 'in', list).execute();
  return new Map(rows.map((a) => [a.id, authorRef(a)]));
}

async function sourceRefs(db: Db, ids: Iterable<string | null>): Promise<Map<string, LeadSource>> {
  const list = [...new Set([...ids].filter((x): x is string => x !== null))];
  if (list.length === 0) return new Map();
  const rows = await db.selectFrom('source').select(['id', 'title', 'repository', 'reference']).where('id', 'in', list).execute();
  return new Map(rows.map((s) => [s.id, { id: s.id, title: s.title, repository: s.repository, reference: s.reference }]));
}

/** The views of many leads, a fixed number of queries for any number of them. */
export async function leadViews(db: Db, clock: Clock, leads: readonly Lead[]): Promise<LeadView[]> {
  if (leads.length === 0) return [];
  const ids = leads.map((l) => l.id);
  const links = await db
    .selectFrom('lead_link as k')
    .leftJoin('person as p', 'p.id', 'k.person_id')
    .select(['k.lead_id', 'k.place_id', sql<string | null>`coalesce(p.merged_into_id, k.person_id)`.as('person_id')])
    .where('k.lead_id', 'in', ids)
    .orderBy('k.lead_id')
    .orderBy('k.sort_order')
    .orderBy('k.id')
    .execute();
  const searches = await db.selectFrom('lead_search').selectAll().where('lead_id', 'in', ids).orderBy('created_at', 'desc').orderBy('id', 'desc').execute();
  const persons = await personSummaries(
    db,
    links.flatMap((k) => (k.person_id ? [k.person_id] : [])),
    clock,
  );
  const places = await placeRefs(
    db,
    links.flatMap((k) => (k.place_id ? [k.place_id] : [])),
  );
  const accounts = await accountRefs(db, [...leads.flatMap((l) => [l.author_id, l.assignee_id]), ...searches.map((s) => s.author_id)]);
  const sources = await sourceRefs(db, [...leads.map((l) => l.source_id), ...searches.map((s) => s.source_id)]);
  return leads.map((l) => {
    const own = links.filter((k) => k.lead_id === l.id);
    const personIds = [...new Set(own.flatMap((k) => (k.person_id ? [k.person_id] : [])))];
    return {
      id: l.id,
      version: l.version,
      question: l.question,
      reason: l.reason,
      archive: l.archive,
      source: l.source_id ? (sources.get(l.source_id) ?? null) : null,
      years: yearsOf(l.years_from, l.years_to),
      pages: l.pages,
      status: l.status,
      outcome: l.outcome,
      persons: personIds.flatMap((id) => persons.get(id) ?? []),
      places: own.flatMap((k) => (k.place_id ? (places.get(k.place_id) ?? []) : [])),
      assignee: l.assignee_id ? (accounts.get(l.assignee_id) ?? null) : null,
      author: accounts.get(l.author_id)!,
      foundBy: l.found_by_proposal_id,
      fromSuggestion: l.suggestion_key,
      searches: searches.filter((s) => s.lead_id === l.id).map((s): SearchRecordView => searchView(s, sources, accounts)),
      createdAt: iso(l.created_at),
      updatedAt: iso(l.updated_at),
    };
  });
}

function searchView(
  s: { id: string; source_id: string | null; source_title: string | null; archive: string | null; years_from: number | null; years_to: number | null } & {
    pages: string | null;
    searched_on: string;
    searched_by: string;
    found: boolean;
    note: string | null;
    author_id: string;
    created_at: Date;
  },
  sources: Map<string, LeadSource>,
  accounts: Map<string, ReturnType<typeof authorRef>>,
): SearchRecordView {
  // A Source that went (its Proposal was undone) still names what was searched, by the title it had.
  const source = s.source_id ? (sources.get(s.source_id) ?? null) : null;
  const gone = !source && s.source_title ? { id: s.source_id ?? s.id, title: s.source_title, repository: null, reference: null } : null;
  return {
    id: s.id,
    source: source ?? gone,
    archive: s.archive,
    years: yearsOf(s.years_from, s.years_to),
    pages: s.pages,
    searchedOn: s.searched_on,
    searchedBy: s.searched_by,
    found: s.found,
    note: s.note,
    author: accounts.get(s.author_id)!,
    createdAt: iso(s.created_at),
  };
}

/** One lead with its history, newest change first; null when there is none. */
export async function leadDetail(db: Db, clock: Clock, id: string): Promise<LeadDetail | null> {
  const lead = await db.selectFrom('lead').selectAll().where('id', '=', id).executeTakeFirst();
  if (!lead) return null;
  const [view] = await leadViews(db, clock, [lead]);
  const events = await db.selectFrom('lead_event').selectAll().where('lead_id', '=', id).orderBy('id', 'desc').execute();
  const accounts = await accountRefs(
    db,
    events.map((e) => e.author_id),
  );
  const history: LeadChange[] = events.map((e) => ({
    at: iso(e.at),
    author: accounts.get(e.author_id)!,
    kind: e.kind,
    proposalId: e.proposal_id,
    fields: e.fields,
  }));
  return { ...view!, history };
}

/**
 * Leads by status, Person, Place, archive and who works on them (research-leads spec, "Leads where
 * people look"): open and in-progress leads first, then the closed ones, newest change first.
 */
export async function listLeads(db: Db, clock: Clock, q: LeadListQuery): Promise<{ items: LeadView[]; total: number }> {
  let query = db.selectFrom('lead as l');
  if (q.status) query = query.where('l.status', 'in', q.status);
  if (q.assigneeId) query = query.where('l.assignee_id', '=', q.assigneeId);
  if (q.personId) {
    const personId = q.personId;
    // A lead about a Person merged into this one is about this one too.
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('lead_link as k')
          .innerJoin('person as p', 'p.id', 'k.person_id')
          .select(sql`1`.as('x'))
          .whereRef('k.lead_id', '=', 'l.id')
          .where((w) => w.or([w('p.id', '=', personId), w('p.merged_into_id', '=', personId)])),
      ),
    );
  }
  if (q.placeId) {
    const placeId = q.placeId;
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('lead_link as k')
          .select(sql`1`.as('x'))
          .whereRef('k.lead_id', '=', 'l.id')
          .where('k.place_id', '=', placeId),
      ),
    );
  }
  if (q.archive) {
    const pattern = `%${q.archive.replace(/[\\%_]/g, '\\$&')}%`;
    query = query.where((eb) =>
      eb.or([
        sql<boolean>`rdk_fold(coalesce(l.archive, '')) like rdk_fold(${pattern})`,
        eb.exists(
          eb
            .selectFrom('source as s')
            .select(sql`1`.as('x'))
            .whereRef('s.id', '=', 'l.source_id')
            .where(sql<boolean>`rdk_fold(coalesce(s.repository, '')) like rdk_fold(${pattern})`),
        ),
      ]),
    );
  }
  const { total } = await query.select((eb) => eb.fn.countAll<number>().as('total')).executeTakeFirstOrThrow();
  const rows = await query
    .selectAll('l')
    .orderBy(sql`case when l.status in ('open', 'in_progress') then 0 else 1 end`)
    .orderBy('l.updated_at', 'desc')
    .orderBy('l.id', 'desc')
    .limit(q.limit)
    .offset(q.offset)
    .execute();
  return { items: await leadViews(db, clock, rows), total };
}
