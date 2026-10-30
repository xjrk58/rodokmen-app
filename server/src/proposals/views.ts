import {
  baseTargetOf,
  describeOperations,
  detectConflict,
  isTempId,
  mayDecide,
  Operation,
  type AuthorRef,
  type CitationPreview,
  type ConflictView,
  type OperationView,
  type ProposalView,
  type RestorableTable,
  type SummaryContext,
  type UploadView,
} from '@rodokmen/shared';
import type { Db } from '../db/db.js';
import type { Account, Proposal, Upload } from '../db/types.js';
import { fieldOf, RECORD_TABLES } from './apply.js';
import { idsIn, labelsFor } from './labels.js';
import { snapshotsMany, type Snapshot } from './records.js';

/**
 * Reading Proposals: their stored operations, conflicts with the current Tree, and the views
 * shown in review, to authors and in the Editor digest.
 */
/** Agents (add-agent-access) will have their own role; until then no account is one. */
export const isAgent = (a: Pick<Account, 'role'>): boolean => (a.role as string) === 'agent';
export const canReview = (a: Pick<Account, 'role'>): boolean => mayDecide(a.role);

export function authorRef(a: Pick<Account, 'id' | 'display_name' | 'role'>): AuthorRef {
  return { id: a.id, displayName: a.display_name, isAgent: isAgent(a) };
}

const iso = (d: Date | string | null): string | null => (d === null ? null : new Date(d).toISOString());

// ---------------------------------------------------------------- stored operations

export interface StoredOperation {
  position: number;
  original: Operation;
  corrected: Operation | null;
  correctedBy: string | null;
  effective: Operation;
}

export async function loadOperations(db: Db, proposalId: string): Promise<StoredOperation[]> {
  return (await loadOperationsOf(db, [proposalId])).get(proposalId) ?? [];
}

/** The operations of many Proposals in one query. */
export async function loadOperationsOf(db: Db, proposalIds: readonly string[]): Promise<Map<string, StoredOperation[]>> {
  const out = new Map<string, StoredOperation[]>();
  if (proposalIds.length === 0) return out;
  const rows = await db.selectFrom('proposal_operation').selectAll().where('proposal_id', 'in', [...proposalIds]).orderBy('proposal_id').orderBy('position').execute();
  for (const r of rows) {
    const original = Operation.parse(r.operation);
    const corrected = r.corrected ? Operation.parse(r.corrected) : null;
    const list = out.get(r.proposal_id) ?? [];
    list.push({ position: r.position, original, corrected, correctedBy: r.corrected_by, effective: corrected ?? original });
    out.set(r.proposal_id, list);
  }
  return out;
}

// ---------------------------------------------------------------- conflicts

interface Target {
  table: RestorableTable;
  record: string;
  id: string;
  base: number;
}

/** The existing records an operation is based on, with the versions it names. */
function targetsOf(op: Operation): Target[] {
  if (op.op === 'mergePersons') {
    return [
      { table: 'person', record: 'person', id: op.keepId, base: op.keepBaseVersion },
      { table: 'person', record: 'person', id: op.mergeId, base: op.mergeBaseVersion },
    ];
  }
  const t = baseTargetOf(op);
  return t && t.baseVersion !== undefined && !isTempId(t.id) ? [{ table: RECORD_TABLES[t.record], record: t.record, id: t.id, base: t.baseVersion }] : [];
}

/** Current rows of every record the operations are based on or set fields of, a query per table. */
async function currentRows(db: Db, ops: readonly Operation[]): Promise<Map<string, Snapshot>> {
  const byTable = new Map<RestorableTable, string[]>();
  for (const op of ops) for (const t of targetsOf(op)) byTable.set(t.table, [...(byTable.get(t.table) ?? []), t.id]);
  const out = new Map<string, Snapshot>();
  for (const [table, ids] of byTable) for (const [id, row] of await snapshotsMany(db, table, ids)) out.set(`${table}:${id}`, row);
  return out;
}

/** Operations based on an older version of an existing record, with the fields side by side. */
export async function findConflicts(db: Db, ops: readonly Operation[]): Promise<Map<number, ConflictView>> {
  return conflictsSync(ops, await currentRows(db, ops), await labelsFor(db, idsIn(ops)));
}

// ---------------------------------------------------------------- views

export function uploadView(u: Pick<Upload, 'id' | 'status' | 'content_type' | 'declared_type' | 'byte_size' | 'declared_size' | 'width' | 'height'>): UploadView {
  return {
    id: u.id,
    status: u.status,
    contentType: u.content_type ?? u.declared_type,
    byteSize: u.byte_size ?? u.declared_size,
    width: u.width,
    height: u.height,
    url: `/api/uploads/${u.id}`,
    fullUrl: `/api/uploads/${u.id}?full=true`,
  };
}

async function accountsById(db: Db, ids: Iterable<string | null>): Promise<Map<string, Pick<Account, 'id' | 'display_name' | 'role'>>> {
  const list = [...new Set([...ids].filter((x): x is string => x !== null))];
  if (list.length === 0) return new Map();
  return new Map((await db.selectFrom('account').select(['id', 'display_name', 'role']).where('id', 'in', list).execute()).map((a) => [a.id, a]));
}

/**
 * Full views of Proposals for review and for their authors: every operation as a sentence,
 * compared with the current Tree, conflicts, and Citations with their images. The data of all
 * Proposals is loaded together, a fixed number of queries per call.
 */
export async function proposalViews(db: Db, rows: Proposal[]): Promise<ProposalView[]> {
  if (rows.length === 0) return [];
  const accounts = await accountsById(db, rows.flatMap((p) => [p.author_id, p.decided_by]));
  const stored = await loadOperationsOf(db, rows.map((p) => p.id));
  const allOps = [...stored.values()].flat();
  const labels = await labelsFor(db, idsIn(allOps.map((s) => [s.original, s.corrected])));
  const effectiveAll = allOps.map((s) => s.effective);
  const current = await currentRows(db, effectiveAll);
  const support = await citationSupport(db, effectiveAll);

  return rows.map((p) => {
    const ops = stored.get(p.id) ?? [];
    const effective = ops.map((s) => s.effective);
    const summaries = describeOperations(effective, labels);
    const originalSummaries = describeOperations(
      ops.map((s) => s.original),
      labels,
    );
    // Conflicts matter only while the Proposal waits for a decision.
    const conflicts = p.status === 'pending' ? conflictsSync(effective, current, labels) : new Map<number, ConflictView>();
    const operations: OperationView[] = ops.map((s) => {
      const op = s.effective;
      const row = op.op === 'setField' ? current.get(`${RECORD_TABLES[op.record]}:${op.id}`) : undefined;
      return {
        position: s.position,
        operation: op,
        summary: summaries[s.position]!,
        corrected: s.corrected !== null,
        original: s.corrected ? s.original : null,
        originalSummary: s.corrected ? originalSummaries[s.position]! : null,
        current: op.op === 'setField' && row ? Object.fromEntries(Object.keys(op.set).map((f) => [f, fieldOf(row, f)])) : null,
        conflict: conflicts.get(s.position) ?? null,
      };
    });
    const author = accounts.get(p.author_id)!;
    const decider = p.decided_by ? accounts.get(p.decided_by) : undefined;
    return {
      id: p.id,
      version: p.version,
      kind: p.kind,
      status: p.status,
      author: authorRef(author),
      note: p.note,
      submittedAt: iso(p.submitted_at)!,
      decidedAt: iso(p.decided_at),
      decidedBy: decider ? authorRef(decider) : null,
      decisionNote: p.decision_note,
      undoes: p.undoes_proposal_id,
      undoneBy: p.undone_by_proposal_id,
      operations,
      citations: citationPreviews(effective, support, labels),
      conflicts: conflicts.size,
    };
  });
}

/** Conflicts of operations against rows already loaded; the rule itself is detectConflict (shared/src/rules.ts). */
function conflictsSync(ops: readonly Operation[], rows: Map<string, Snapshot>, labels: SummaryContext): Map<number, ConflictView> {
  const out = new Map<number, ConflictView>();
  for (const [position, op] of ops.entries()) {
    for (const target of targetsOf(op)) {
      const current = rows.get(`${target.table}:${target.id}`) ?? null;
      const proposed = op.op === 'setField' ? Object.entries(op.set).map(([field, value]) => ({ field, value })) : [];
      const conflict = detectConflict(
        target.base,
        current?.version ?? null,
        proposed,
        current ? proposed.map((p) => ({ field: p.field, value: fieldOf(current, p.field) })) : [],
      );
      if (!conflict) continue;
      out.set(position, { record: target.record, id: target.id, label: { cs: labels.label(target.id, 'cs'), en: labels.label(target.id, 'en') }, ...conflict });
      break;
    }
  }
  return out;
}

interface CitationSupport {
  uploads: Map<string, Upload>;
  sources: Map<string, { title: string; type: string }>;
  citations: Map<string, { page: string | null; transcription: string; confidence: CitationPreview['confidence']; title: string; type: string }>;
}

/** Uploads, Sources and Citations the operations refer to, three queries for any number of Proposals. */
async function citationSupport(db: Db, ops: readonly Operation[]): Promise<CitationSupport> {
  const uploadIds = ops.flatMap((o) => (o.op === 'addImage' ? [o.uploadId] : []));
  const sourceIds = ops.flatMap((o) => (o.op === 'createCitation' && !isTempId(o.sourceId) ? [o.sourceId] : []));
  const citationIds = ops.flatMap((o) => (o.op === 'attachCitation' && !isTempId(o.citationId) ? [o.citationId] : []));
  return {
    uploads: new Map(uploadIds.length ? (await db.selectFrom('upload').selectAll().where('id', 'in', uploadIds).execute()).map((u) => [u.id, u]) : []),
    sources: new Map(sourceIds.length ? (await db.selectFrom('source').select(['id', 'title', 'type']).where('id', 'in', sourceIds).execute()).map((x) => [x.id, x]) : []),
    citations: new Map(
      citationIds.length
        ? (
            await db
              .selectFrom('citation as c')
              .innerJoin('source as s', 's.id', 'c.source_id')
              .select(['c.id', 'c.page', 'c.transcription', 'c.confidence', 's.title', 's.type'])
              .where('c.id', 'in', citationIds)
              .execute()
          ).map((x) => [x.id, x])
        : [],
    ),
  };
}

function citationPreviews(ops: readonly Operation[], support: CitationSupport, labels: SummaryContext): CitationPreview[] {
  const sources = new Map(ops.flatMap((o) => (o.op === 'createSource' ? [[o.tempId, o] as const] : [])));
  const imagesOf = (ref: string) =>
    ops.flatMap((o) => {
      const upload = o.op === 'addImage' && o.citationId === ref ? support.uploads.get(o.uploadId) : undefined;
      return o.op === 'addImage' && upload ? [{ ...uploadView(upload), kind: o.kind }] : [];
    });
  // A new Citation, described by its operation.
  const created = (o: Extract<Operation, { op: 'createCitation' }>): CitationPreview => {
    const source = isTempId(o.sourceId) ? sources.get(o.sourceId) : support.sources.get(o.sourceId);
    return { ref: o.tempId, sourceTitle: source?.title ?? labels.label(o.sourceId, 'en'), sourceType: source?.type ?? 'other', page: o.page, transcription: o.transcription, confidence: o.confidence, images: imagesOf(o.tempId) };
  };
  // An existing Citation attached again, described by its stored record.
  const existing = (id: string): CitationPreview => {
    const c = support.citations.get(id);
    return { ref: id, sourceTitle: c?.title ?? labels.label(id, 'en'), sourceType: c?.type ?? 'other', page: c?.page ?? null, transcription: c?.transcription ?? null, confidence: c?.confidence ?? null, images: imagesOf(id) };
  };
  const out: CitationPreview[] = [];
  const seen = new Set<string>();
  for (const o of ops) {
    if (o.op === 'createCitation') {
      seen.add(o.tempId);
      out.push(created(o));
    } else if (o.op === 'attachCitation' && !isTempId(o.citationId) && !seen.has(o.citationId)) {
      seen.add(o.citationId);
      out.push(existing(o.citationId));
    }
  }
  return out;
}

/** What the Editor digest lists per pending Proposal: cheaper than a full view. */
export async function proposalDigestLines(db: Db, rows: Proposal[]): Promise<Array<{ id: string; author: AuthorRef; submittedAt: Date; note: string | null; first: Record<'cs' | 'en', string>; changes: number }>> {
  const accounts = await accountsById(db, rows.map((p) => p.author_id));
  const stored = await loadOperationsOf(db, rows.map((p) => p.id));
  const firsts = rows.map((p) => stored.get(p.id)?.[0]?.effective).filter((o): o is Operation => o !== undefined);
  const labels = await labelsFor(db, idsIn(firsts));
  return rows.map((p) => {
    const ops = (stored.get(p.id) ?? []).map((s) => s.effective);
    const [first] = describeOperations(ops.slice(0, 1), labels);
    return { id: p.id, author: authorRef(accounts.get(p.author_id)!), submittedAt: new Date(p.submitted_at), note: p.note?.trim() || null, first: first ?? { cs: '', en: '' }, changes: ops.length };
  });
}
