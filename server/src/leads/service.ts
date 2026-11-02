import {
  isoDay,
  LeadStatus,
  leadsOnAccept,
  leadsOnUndo,
  mayHaveStatus,
  type CloseLeadBody,
  type CreateLeadBody,
  type LeadDetail,
  type SearchRecordBody,
  type UpdateLeadBody,
} from '@rodokmen/shared';
import { isDeepStrictEqual } from 'node:util';
import { ApiProblem } from '../auth/problem.js';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import type { Lead } from '../db/lead-types.js';
import type { Account } from '../db/types.js';
import { leadDetail } from './views.js';

/**
 * Writing Research leads (research-leads spec). Leads are plans, not facts, so Members and Agents
 * write them directly, without review ("Leads need no review"), and every change is kept in the
 * lead's history with author and time. A lead closes as not found only with a search record
 * ("What was searched is recorded", the proved mayHaveStatus). A Proposal may name the leads it
 * answers; accepting it marks them found and undoing it reopens them ("Findings link back to
 * leads", the proved leadsOnAccept and leadsOnUndo).
 */

export interface LeadDeps {
  db: Db;
  clock: Clock;
}

type Field = { field: string; before: unknown; after: unknown };

export const SEARCH_NEEDED =
  'A lead closes as not found only with a search record: add the search that was made (which register or archive, the years and pages, and what was found).';

/** The fields of a lead as the API names them. */
// A type, not an interface, so that it reads as a record of fields.
type LeadFieldValues = {
  question: string;
  reason: string;
  archive: string | null;
  sourceId: string | null;
  years: { from: number; to: number } | null;
  pages: string | null;
  personIds: readonly string[];
  placeIds: readonly string[];
  assigneeId: string | null;
  outcome: string | null;
  status: LeadStatus;
};

function fieldsOf(lead: Lead, personIds: readonly string[], placeIds: readonly string[]): LeadFieldValues {
  return {
    question: lead.question,
    reason: lead.reason,
    archive: lead.archive,
    sourceId: lead.source_id,
    years: lead.years_from !== null && lead.years_to !== null ? { from: lead.years_from, to: lead.years_to } : null,
    pages: lead.pages,
    personIds,
    placeIds,
    assigneeId: lead.assignee_id,
    outcome: lead.outcome,
    status: lead.status,
  };
}

/** A lead's fields after an edit: what the edit sets, the rest as they were. */
function edited(before: LeadFieldValues, body: UpdateLeadBody, personIds: string[] | undefined): LeadFieldValues {
  const or = <T>(value: T | undefined, current: T): T => (value === undefined ? current : value);
  return {
    question: or(body.question, before.question),
    reason: or(body.reason, before.reason),
    archive: body.archive === undefined ? before.archive : body.archive?.trim() || null,
    sourceId: or(body.sourceId, before.sourceId),
    years: or(body.years, before.years),
    pages: or(body.pages, before.pages),
    personIds: or(personIds, before.personIds),
    placeIds: or(body.placeIds, before.placeIds),
    assigneeId: or(body.assigneeId, before.assigneeId),
    outcome: or(body.outcome, before.outcome),
    status: or(body.status, before.status),
  };
}

/** The fields that differ, before and after, for the lead's history. */
function changedFields(before: LeadFieldValues, after: LeadFieldValues): Field[] {
  const old: Record<string, unknown> = before;
  const next: Record<string, unknown> = after;
  return Object.entries(next).flatMap(([field, value]) => (isDeepStrictEqual(old[field], value) ? [] : [{ field, before: old[field], after: value }]));
}

async function linksOf(tx: Db, leadId: string): Promise<{ personIds: string[]; placeIds: string[] }> {
  const rows = await tx.selectFrom('lead_link').select(['person_id', 'place_id']).where('lead_id', '=', leadId).orderBy('sort_order').orderBy('id').execute();
  return { personIds: rows.flatMap((r) => (r.person_id ? [r.person_id] : [])), placeIds: rows.flatMap((r) => (r.place_id ? [r.place_id] : [])) };
}

/**
 * The records a lead refers to exist: the register Source, the Persons (a Person merged into
 * another stands for the one kept), the Places and who works on it. Returns the Persons as stored.
 */
async function checkReferences(
  tx: Db,
  refs: { sourceId?: string | null; personIds?: readonly string[]; placeIds?: readonly string[]; assigneeId?: string | null },
): Promise<string[] | undefined> {
  if (refs.sourceId) {
    const s = await tx.selectFrom('source').select('id').where('id', '=', refs.sourceId).executeTakeFirst();
    if (!s) throw new ApiProblem(400, 'unknown_record', 'There is no Source with this id.');
  }
  if (refs.placeIds?.length) {
    const found = await tx
      .selectFrom('place')
      .select('id')
      .where('id', 'in', [...refs.placeIds])
      .execute();
    if (found.length !== refs.placeIds.length) throw new ApiProblem(400, 'unknown_record', 'A Place of this lead does not exist.');
  }
  if (refs.assigneeId) {
    const a = await tx.selectFrom('account').select(['id', 'disabled_at']).where('id', '=', refs.assigneeId).executeTakeFirst();
    if (!a || a.disabled_at) throw new ApiProblem(400, 'unknown_record', 'Nobody with this id can work on the lead.');
  }
  if (refs.personIds === undefined) return undefined;
  if (refs.personIds.length === 0) return [];
  const rows = await tx
    .selectFrom('person')
    .select(['id', 'merged_into_id'])
    .where('id', 'in', [...refs.personIds])
    .execute();
  const byId = new Map(rows.map((r) => [r.id, r.merged_into_id ?? r.id]));
  const out: string[] = [];
  for (const id of refs.personIds) {
    const kept = byId.get(id);
    if (!kept) throw new ApiProblem(400, 'unknown_record', 'A Person of this lead does not exist.');
    if (!out.includes(kept)) out.push(kept);
  }
  return out;
}

async function writeLinks(tx: Db, leadId: string, personIds: readonly string[], placeIds: readonly string[]): Promise<void> {
  await tx.deleteFrom('lead_link').where('lead_id', '=', leadId).execute();
  const rows = [
    ...personIds.map((person_id, i) => ({ lead_id: leadId, person_id, place_id: null, sort_order: i })),
    ...placeIds.map((place_id, i) => ({ lead_id: leadId, person_id: null, place_id, sort_order: i })),
  ];
  if (rows.length) await tx.insertInto('lead_link').values(rows).execute();
}

async function logChange(
  tx: Db,
  e: {
    leadId: string;
    author: string;
    at: Date;
    kind: 'created' | 'edited' | 'searched' | 'closed' | 'answered' | 'reopened';
    proposalId?: string;
    fields: Field[];
  },
) {
  await tx
    .insertInto('lead_event')
    .values({ lead_id: e.leadId, author_id: e.author, at: e.at, kind: e.kind, proposal_id: e.proposalId ?? null, fields: JSON.stringify(e.fields) })
    .execute();
}

/** Today in the server's clock, as an ISO day: the date of a search made now. */
const today = (clock: Clock) => {
  const d = clock.now();
  return isoDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};

/** Records one search on a lead, keeping the Source's title so the record says what was searched even if the Source goes. */
async function insertSearch(tx: Db, deps: LeadDeps, author: Account, leadId: string, body: SearchRecordBody): Promise<Field[]> {
  let title: string | null = null;
  if (body.sourceId) {
    const s = await tx.selectFrom('source').select('title').where('id', '=', body.sourceId).executeTakeFirst();
    if (!s) throw new ApiProblem(400, 'unknown_record', 'There is no Source with this id.');
    title = s.title;
  }
  const row = {
    lead_id: leadId,
    source_id: body.sourceId,
    source_title: title,
    archive: body.archive?.trim() || null,
    years_from: body.years?.from ?? null,
    years_to: body.years?.to ?? null,
    pages: body.pages,
    searched_on: body.searchedOn ?? today(deps.clock),
    searched_by: body.searchedBy ?? author.display_name,
    found: body.found,
    note: body.note,
    author_id: author.id,
    created_at: deps.clock.now(),
  };
  const inserted = await tx.insertInto('lead_search').values(row).returning('id').executeTakeFirstOrThrow();
  return [
    {
      field: 'search',
      before: null,
      after: { id: inserted.id, sourceId: row.source_id, archive: row.archive, years: body.years, pages: row.pages, found: row.found },
    },
  ];
}

async function searchCount(tx: Db, leadId: string): Promise<number> {
  const { n } = await tx
    .selectFrom('lead_search')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('lead_id', '=', leadId)
    .executeTakeFirstOrThrow();
  return n;
}

/** The rule (mayHaveStatus, proved) for a status a lead is about to get. */
function checkStatus(status: string, searches: number): void {
  if (!mayHaveStatus(status, searches)) throw new ApiProblem(400, 'search_needed', SEARCH_NEEDED);
}

async function lockLead(tx: Db, id: string, baseVersion: number): Promise<Lead> {
  const lead = await tx.selectFrom('lead').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  if (!lead) throw new ApiProblem(404, 'not_found', 'No lead with this id.');
  if (lead.version !== baseVersion)
    throw new ApiProblem(409, 'conflict', 'This lead was changed since you read it. Read it again and make your change on the current version.');
  return lead;
}

async function detail(deps: LeadDeps, id: string): Promise<LeadDetail> {
  return (await leadDetail(deps.db, deps.clock, id))!;
}

/**
 * Writes a new lead at once (research-leads spec, "Research leads", "Leads need no review"):
 * every Member sees it at once, with its author. Searches already made come with it, so a lead
 * may start closed as not found when it carries the search that found nothing.
 */
export async function createLead(deps: LeadDeps, author: Account, body: CreateLeadBody, from?: { suggestionKey: string }): Promise<LeadDetail> {
  const id = await deps.db.transaction().execute(async (tx) => {
    const personIds = (await checkReferences(tx, body))!;
    checkStatus(body.status, body.searches.length);
    const now = deps.clock.now();
    const lead = await tx
      .insertInto('lead')
      .values({
        question: body.question,
        reason: body.reason,
        archive: body.archive?.trim() || null,
        source_id: body.sourceId,
        years_from: body.years?.from ?? null,
        years_to: body.years?.to ?? null,
        pages: body.pages,
        status: body.status,
        outcome: body.outcome,
        assignee_id: body.assigneeId,
        author_id: author.id,
        suggestion_key: from?.suggestionKey ?? null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await writeLinks(tx, lead.id, personIds, body.placeIds);
    const fields = Object.entries(fieldsOf(lead, personIds, body.placeIds)).flatMap(([field, after]: [string, unknown]) =>
      after === null || (Array.isArray(after) && after.length === 0) ? [] : [{ field, before: null, after }],
    );
    await logChange(tx, { leadId: lead.id, author: author.id, at: now, kind: 'created', fields });
    for (const s of body.searches)
      await logChange(tx, { leadId: lead.id, author: author.id, at: now, kind: 'searched', fields: await insertSearch(tx, deps, author, lead.id, s) });
    return lead.id;
  });
  return detail(deps, id);
}

/** The kind of change a new status makes: closing, reopening, or an ordinary edit. */
function changeKind(before: LeadStatus, after: LeadStatus): 'edited' | 'closed' | 'reopened' {
  const closed = (s: LeadStatus) => s === 'found' || s === 'not_found';
  if (closed(after) && before !== after) return 'closed';
  if (closed(before) && !closed(after)) return 'reopened';
  return 'edited';
}

/**
 * Changes a lead's fields at once, against the version the writer saw. Every change is kept in
 * the lead's history. A lead that leaves "found" no longer links to the Proposal that found it.
 */
export async function updateLead(deps: LeadDeps, author: Account, id: string, body: UpdateLeadBody): Promise<LeadDetail> {
  await deps.db.transaction().execute(async (tx) => {
    const lead = await lockLead(tx, id, body.baseVersion);
    const links = await linksOf(tx, id);
    const before = fieldsOf(lead, links.personIds, links.placeIds);
    const after = edited(before, body, await checkReferences(tx, body));
    const fields = changedFields(before, after);
    if (fields.length === 0) return;
    if (after.status !== before.status) checkStatus(after.status, await searchCount(tx, id));
    const now = deps.clock.now();
    await tx
      .updateTable('lead')
      .set({
        question: after.question,
        reason: after.reason,
        archive: after.archive,
        source_id: after.sourceId,
        years_from: after.years?.from ?? null,
        years_to: after.years?.to ?? null,
        pages: after.pages,
        assignee_id: after.assigneeId,
        outcome: after.outcome,
        status: after.status,
        // A lead that leaves "found" no longer links to the Proposal that found it.
        found_by_proposal_id: after.status === 'found' ? lead.found_by_proposal_id : null,
        updated_at: now,
      })
      .where('id', '=', id)
      .execute();
    if (fields.some((f) => f.field === 'personIds' || f.field === 'placeIds')) await writeLinks(tx, id, after.personIds, after.placeIds);
    await logChange(tx, { leadId: id, author: author.id, at: now, kind: changeKind(before.status, after.status), fields });
  });
  return detail(deps, id);
}

/** Records one more search on a lead (research-leads spec, "What was searched is recorded"). */
export async function addSearch(deps: LeadDeps, author: Account, id: string, body: SearchRecordBody): Promise<LeadDetail> {
  await deps.db.transaction().execute(async (tx) => {
    const lead = await tx.selectFrom('lead').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
    if (!lead) throw new ApiProblem(404, 'not_found', 'No lead with this id.');
    const now = deps.clock.now();
    const fields = await insertSearch(tx, deps, author, id, body);
    await tx.updateTable('lead').set({ updated_at: now }).where('id', '=', id).execute();
    await logChange(tx, { leadId: id, author: author.id, at: now, kind: 'searched', fields });
  });
  return detail(deps, id);
}

/**
 * Closes a lead as found or not found, with the outcome and the search that closes it, in one
 * step (research-leads spec, scenario "Negative result"). Not found needs at least one search
 * record, the one given here or an earlier one; otherwise nothing is stored.
 */
export async function closeLead(deps: LeadDeps, author: Account, id: string, body: CloseLeadBody): Promise<LeadDetail> {
  await deps.db.transaction().execute(async (tx) => {
    const lead = await lockLead(tx, id, body.baseVersion);
    const now = deps.clock.now();
    if (body.search)
      await logChange(tx, { leadId: id, author: author.id, at: now, kind: 'searched', fields: await insertSearch(tx, deps, author, id, body.search) });
    checkStatus(body.status, await searchCount(tx, id));
    await tx
      .updateTable('lead')
      .set({
        status: body.status,
        outcome: body.outcome ?? lead.outcome,
        found_by_proposal_id: body.status === 'found' ? lead.found_by_proposal_id : null,
        updated_at: now,
      })
      .where('id', '=', id)
      .execute();
    const fields: Field[] = [{ field: 'status', before: lead.status, after: body.status }];
    if (body.outcome !== null && body.outcome !== lead.outcome) fields.push({ field: 'outcome', before: lead.outcome, after: body.outcome });
    await logChange(tx, { leadId: id, author: author.id, at: now, kind: 'closed', fields });
  });
  return detail(deps, id);
}

// ---------------------------------------------------------------- Proposals that answer leads

/** The leads a submitted Proposal names must exist; stored with it once it is created. */
export async function checkAnsweredLeads(tx: Db, leadIds: readonly string[]): Promise<void> {
  if (leadIds.length === 0) return;
  const found = await tx
    .selectFrom('lead')
    .select('id')
    .where('id', 'in', [...leadIds])
    .execute();
  if (found.length !== leadIds.length) throw new ApiProblem(400, 'unknown_lead', 'A Research lead this Proposal answers does not exist.');
}

export async function storeAnsweredLeads(tx: Db, proposalId: string, leadIds: readonly string[]): Promise<void> {
  if (leadIds.length)
    await tx
      .insertInto('proposal_lead')
      .values(leadIds.map((lead_id) => ({ proposal_id: proposalId, lead_id })))
      .execute();
}

type LeadRow = { id: string; status: LeadStatus; found_by_proposal_id: string | null };
const stateOf = (l: LeadRow) => ({ id: l.id, status: l.status, foundBy: l.found_by_proposal_id ?? '' });

/** Writes the leads whose state the rule changed, each with its history entry. */
async function writeStates(
  tx: Db,
  rows: readonly LeadRow[],
  next: ReadonlyArray<{ id: string; status: string; foundBy: string }>,
  e: { author: string; at: Date; proposalId: string; kind: 'answered' | 'reopened' },
) {
  for (const [i, before] of rows.entries()) {
    const after = next[i]!;
    if (after.status === before.status && after.foundBy === (before.found_by_proposal_id ?? '')) continue;
    await tx
      .updateTable('lead')
      .set({ status: LeadStatus.parse(after.status), found_by_proposal_id: after.foundBy || null, updated_at: e.at })
      .where('id', '=', before.id)
      .execute();
    await logChange(tx, {
      leadId: before.id,
      author: e.author,
      at: e.at,
      kind: e.kind,
      proposalId: e.proposalId,
      fields: [{ field: 'status', before: before.status, after: after.status }],
    });
  }
}

/**
 * In the transaction that accepts a Proposal: the leads it names become found, linked to it
 * (research-leads spec, "Lead answered"; leadsOnAccept in shared/src/leads.ts).
 */
export async function markAnsweredLeads(tx: Db, proposalId: string, acceptedBy: string, at: Date): Promise<void> {
  const answers = (await tx.selectFrom('proposal_lead').select('lead_id').where('proposal_id', '=', proposalId).execute()).map((r) => r.lead_id);
  if (answers.length === 0) return;
  const rows = await tx.selectFrom('lead').select(['id', 'status', 'found_by_proposal_id']).where('id', 'in', answers).orderBy('id').forUpdate().execute();
  await writeStates(tx, rows, leadsOnAccept(rows.map(stateOf), answers, proposalId), { author: acceptedBy, at, proposalId, kind: 'answered' });
}

/** In the transaction that undoes a Proposal: the leads it marked found open again (leadsOnUndo). */
export async function reopenAnsweredLeads(tx: Db, proposalId: string, undoneBy: string, at: Date): Promise<void> {
  const rows = await tx
    .selectFrom('lead')
    .select(['id', 'status', 'found_by_proposal_id'])
    .where('found_by_proposal_id', '=', proposalId)
    .orderBy('id')
    .forUpdate()
    .execute();
  if (rows.length === 0) return;
  await writeStates(tx, rows, leadsOnUndo(rows.map(stateOf), proposalId), { author: undoneBy, at, proposalId, kind: 'reopened' });
}
