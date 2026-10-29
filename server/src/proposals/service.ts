import {
  baseTargetOf,
  checkOperations,
  describeOperations,
  EVIDENCE_MESSAGE,
  isTempId,
  Operation,
  OPERATIONS_VERSION,
  permissionsFor,
  type AcceptBody,
  type AuthorRef,
  type CitationPreview,
  type ConflictView,
  type OperationView,
  type ProposalView,
  type SubmitProposalBody,
  type UploadView,
} from '@rodokmen/shared';
import type { Db } from '../db/db.js';
import type { Account, Proposal, Upload } from '../db/types.js';
import { ApiProblem } from '../auth/problem.js';
import type { Mailer } from '../mail/mailer.js';
import { outcomeEmail } from '../mail/templates.js';
import type { ImageStorage } from '../storage/images.js';
import type { Clock } from '../tree/summaries.js';
import { applyOperations, fieldOf, RECORD_TABLES, translateDbError, type UploadMove } from './apply.js';
import { idsIn, labelsFor } from './labels.js';
import { snapshot } from './records.js';

export interface ProposalDeps {
  db: Db;
  clock: Clock;
  images: ImageStorage;
  mailer: Mailer;
  publicOrigin: string;
  log?: (msg: string, error?: unknown) => void;
}

/** Agents (add-agent-access) will have their own role; until then no account is one. */
export const isAgent = (a: Pick<Account, 'role'>): boolean => (a.role as string) === 'agent';
export const canReview = (a: Pick<Account, 'role'>): boolean => permissionsFor(a.role).review;

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
  const rows = await db.selectFrom('proposal_operation').selectAll().where('proposal_id', '=', proposalId).orderBy('position').execute();
  return rows.map((r) => {
    const original = Operation.parse(r.operation);
    const corrected = r.corrected ? Operation.parse(r.corrected) : null;
    return { position: r.position, original, corrected, correctedBy: r.corrected_by, effective: corrected ?? original };
  });
}

function targetColumns(op: Operation): { target_table: string | null; target_id: string | null; base_version: number | null } {
  const t = baseTargetOf(op);
  if (op.op === 'mergePersons') return { target_table: 'person', target_id: op.mergeId, base_version: op.mergeBaseVersion };
  if (op.op === 'restoreRecord') return { target_table: op.table, target_id: op.id, base_version: op.baseVersion };
  if (!t) return { target_table: null, target_id: null, base_version: null };
  return { target_table: RECORD_TABLES[t.record], target_id: t.id, base_version: t.baseVersion ?? null };
}

// ---------------------------------------------------------------- conflicts

/** Operations based on an older version of an existing record, with the fields side by side. */
export async function findConflicts(db: Db, ops: readonly Operation[]): Promise<Map<number, ConflictView>> {
  const out = new Map<number, ConflictView>();
  const labels = await labelsFor(db, idsIn(ops));
  const label = (id: string) => ({ cs: labels.label(id, 'cs'), en: labels.label(id, 'en') });
  for (const [position, op] of ops.entries()) {
    const targets: Array<{ table: (typeof RECORD_TABLES)[keyof typeof RECORD_TABLES]; record: string; id: string; base: number }> = [];
    const t = baseTargetOf(op);
    if (t && t.baseVersion !== undefined && !isTempId(t.id)) targets.push({ table: RECORD_TABLES[t.record], record: t.record, id: t.id, base: t.baseVersion });
    if (op.op === 'mergePersons') {
      targets.push({ table: 'person', record: 'person', id: op.keepId, base: op.keepBaseVersion }, { table: 'person', record: 'person', id: op.mergeId, base: op.mergeBaseVersion });
    }
    for (const target of targets) {
      const current = await snapshot(db, target.table, target.id, false);
      if (current && current.version === target.base) continue;
      const fields =
        op.op === 'setField' && current ? Object.entries(op.set).map(([field, proposed]) => ({ field, proposed, current: fieldOf(current, field) })) : [];
      out.set(position, { record: target.record, id: target.id, label: label(target.id), baseVersion: target.base, currentVersion: current?.version ?? null, fields });
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- views

export function uploadView(u: Pick<Upload, 'id' | 'status' | 'content_type' | 'declared_type' | 'byte_size' | 'declared_size' | 'width' | 'height'>): UploadView {
  return {
    id: u.id,
    status: u.status,
    contentType: (u.content_type ?? u.declared_type) as UploadView['contentType'],
    byteSize: u.byte_size ?? u.declared_size,
    width: u.width,
    height: u.height,
    url: `/api/uploads/${u.id}`,
    fullUrl: `/api/uploads/${u.id}?full=true`,
  };
}

export async function proposalViews(db: Db, rows: Proposal[]): Promise<ProposalView[]> {
  if (rows.length === 0) return [];
  const accountIds = [...new Set(rows.flatMap((p) => [p.author_id, p.decided_by]).filter((x): x is string => x !== null))];
  const accounts = new Map((await db.selectFrom('account').select(['id', 'display_name', 'role']).where('id', 'in', accountIds).execute()).map((a) => [a.id, a]));
  const out: ProposalView[] = [];
  for (const p of rows) {
    const stored = await loadOperations(db, p.id);
    const effective = stored.map((s) => s.effective);
    const labels = await labelsFor(db, idsIn(stored.map((s) => [s.original, s.corrected])));
    const summaries = describeOperations(effective, labels);
    const originalSummaries = describeOperations(
      stored.map((s) => s.original),
      labels,
    );
    const conflicts = p.status === 'pending' ? await findConflicts(db, effective) : new Map<number, ConflictView>();

    const operations: OperationView[] = [];
    for (const s of stored) {
      let current: Record<string, unknown> | null = null;
      if (s.effective.op === 'setField') {
        const row = await snapshot(db, RECORD_TABLES[s.effective.record], s.effective.id, false);
        if (row) current = Object.fromEntries(Object.keys(s.effective.set).map((f) => [f, fieldOf(row, f)]));
      }
      operations.push({
        position: s.position,
        operation: s.effective as unknown as Record<string, unknown>,
        summary: summaries[s.position]!,
        corrected: s.corrected !== null,
        original: s.corrected ? (s.original as unknown as Record<string, unknown>) : null,
        originalSummary: s.corrected ? originalSummaries[s.position]! : null,
        current,
        conflict: conflicts.get(s.position) ?? null,
      });
    }

    const author = accounts.get(p.author_id)!;
    const decider = p.decided_by ? accounts.get(p.decided_by) : undefined;
    out.push({
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
      citations: await citationPreviews(db, effective, labels.label.bind(labels)),
      conflicts: conflicts.size,
    });
  }
  return out;
}

async function citationPreviews(db: Db, ops: readonly Operation[], label: (id: string, l: 'cs' | 'en') => string): Promise<CitationPreview[]> {
  const out: CitationPreview[] = [];
  const sources = new Map(ops.flatMap((o) => (o.op === 'createSource' ? [[o.tempId, o] as const] : [])));
  const uploadIds = ops.flatMap((o) => (o.op === 'addImage' ? [o.uploadId] : []));
  const uploads = new Map(uploadIds.length ? (await db.selectFrom('upload').selectAll().where('id', 'in', uploadIds).execute()).map((u) => [u.id, u]) : []);
  const imagesOf = (ref: string) =>
    ops.flatMap((o) => (o.op === 'addImage' && o.citationId === ref && uploads.has(o.uploadId) ? [{ ...uploadView(uploads.get(o.uploadId)!), kind: o.kind }] : []));
  const seen = new Set<string>();
  for (const o of ops) {
    if (o.op === 'createCitation') {
      seen.add(o.tempId);
      const tempSource = isTempId(o.sourceId) ? sources.get(o.sourceId) : undefined;
      const dbSource = tempSource ? undefined : await db.selectFrom('source').select(['title', 'type']).where('id', '=', o.sourceId).executeTakeFirst();
      out.push({
        ref: o.tempId,
        sourceTitle: tempSource?.title ?? dbSource?.title ?? label(o.sourceId, 'en'),
        sourceType: tempSource?.type ?? dbSource?.type ?? 'other',
        page: o.page,
        transcription: o.transcription,
        confidence: o.confidence,
        images: imagesOf(o.tempId),
      });
    } else if (o.op === 'attachCitation' && !isTempId(o.citationId) && !seen.has(o.citationId)) {
      seen.add(o.citationId);
      const c = await db
        .selectFrom('citation as c')
        .innerJoin('source as s', 's.id', 'c.source_id')
        .select(['c.page', 'c.transcription', 'c.confidence', 's.title', 's.type'])
        .where('c.id', '=', o.citationId)
        .executeTakeFirst();
      out.push({
        ref: o.citationId,
        sourceTitle: c?.title ?? label(o.citationId, 'en'),
        sourceType: c?.type ?? 'other',
        page: c?.page ?? null,
        transcription: c?.transcription ?? null,
        confidence: c?.confidence ?? null,
        images: imagesOf(o.citationId),
      });
    }
  }
  return out;
}

export async function getProposalRow(db: Db, id: string): Promise<Proposal> {
  const p = await db.selectFrom('proposal').selectAll().where('id', '=', id).executeTakeFirst();
  if (!p) throw new ApiProblem(404, 'not_found', 'No Proposal with this id.');
  return p;
}

/** Until accepted, only the author and the Editors see a Proposal (proposals spec). */
export function assertCanSee(member: Account, p: Proposal): void {
  if (p.author_id !== member.id && !canReview(member)) throw new ApiProblem(404, 'not_found', 'No Proposal with this id.');
}

// ---------------------------------------------------------------- submit

function issuesProblem(issues: ReturnType<typeof checkOperations>['issues'], language: 'cs' | 'en'): ApiProblem {
  if (issues.some((i) => i.code === 'not_allowed')) return new ApiProblem(403, 'not_allowed', issues.find((i) => i.code === 'not_allowed')!.message);
  if (issues.length === 1 && issues[0]!.code === 'evidence_missing') return new ApiProblem(400, 'evidence_missing', EVIDENCE_MESSAGE[language]);
  return new ApiProblem(400, 'invalid_proposal', issues.map((i) => i.message).join('\n'));
}

interface Created {
  proposal: Proposal;
  created: boolean;
}

/** Stores a new Proposal and its operations; with an idempotency key already used, returns that Proposal. */
async function insertProposal(
  tx: Db,
  now: Date,
  author: Account,
  fields: { kind: Proposal['kind']; note: string | null; idempotencyKey: string; undoes?: string },
  ops: readonly Operation[],
): Promise<Created> {
  const inserted = await tx
    .insertInto('proposal')
    .values({
      kind: fields.kind,
      author_id: author.id,
      note: fields.note,
      format_version: OPERATIONS_VERSION,
      idempotency_key: fields.idempotencyKey,
      submitted_at: now,
      undoes_proposal_id: fields.undoes ?? null,
    })
    .onConflict((oc) => oc.columns(['author_id', 'idempotency_key']).doNothing())
    .returningAll()
    .executeTakeFirst();
  if (!inserted) {
    const existing = await tx.selectFrom('proposal').selectAll().where('author_id', '=', author.id).where('idempotency_key', '=', fields.idempotencyKey).executeTakeFirstOrThrow();
    return { proposal: existing, created: false };
  }
  await tx
    .insertInto('proposal_operation')
    .values(ops.map((op, position) => ({ proposal_id: inserted.id, position, op: op.op, operation: JSON.stringify(op), ...targetColumns(op) })))
    .execute();
  const uploadIds = ops.flatMap((o) => (o.op === 'addImage' ? [o.uploadId] : []));
  for (const uploadId of uploadIds) {
    const r = await tx
      .updateTable('upload')
      .set({ proposal_id: inserted.id })
      .where('id', '=', uploadId)
      .where('author_id', '=', author.id)
      .where('status', '=', 'ready')
      .where('proposal_id', 'is', null)
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw new ApiProblem(409, 'upload_unusable', 'An image of this Proposal is not uploaded yet, is not yours, or belongs to another Proposal. Upload it again.');
  }
  return { proposal: inserted, created: true };
}

/**
 * Submits a Proposal (proposals spec). An Editor's direct change is a Proposal created and
 * accepted in the same transaction, so it is logged exactly like any accepted Proposal.
 */
export async function submitProposal(deps: ProposalDeps, author: Account, body: SubmitProposalBody): Promise<{ view: ProposalView; created: boolean }> {
  const editor = canReview(author);
  if (body.direct && !editor) throw new ApiProblem(403, 'forbidden', 'Only Editors change the Tree directly. Submit a Proposal for review instead.');
  const { operations, issues } = checkOperations(body.operations, { editor });
  if (issues.length) throw issuesProblem(issues, author.language);
  const now = deps.clock.now();
  const result = await transaction(deps.db, async (tx) => {
    const created = await insertProposal(tx, now, author, { kind: body.direct ? 'direct' : 'contribution', note: body.note, idempotencyKey: body.idempotencyKey }, operations);
    if (!created.created || !body.direct) return { ...created, moves: [] as UploadMove[] };
    const accepted = await acceptInTransaction(tx, deps, created.proposal, author, { note: null, corrections: [], resolutions: [] });
    return { proposal: accepted.proposal, created: true, moves: accepted.moves };
  }, deps);
  await finishMoves(deps, result.moves);
  const [view] = await proposalViews(deps.db, [result.proposal]);
  return { view: view!, created: result.created };
}

/** Runs a transaction; rule violations found at commit become API problems. Copied images are removed again on failure. */
async function transaction<T extends { moves?: UploadMove[] }>(db: Db, fn: (tx: Db) => Promise<T>, deps: ProposalDeps): Promise<T> {
  const copied: UploadMove[] = [];
  try {
    return await db.transaction().execute(async (tx) => {
      const out = await fn(tx);
      for (const m of out.moves ?? []) {
        await deps.images.copy(m.from.original, m.to.original);
        await deps.images.copy(m.from.display, m.to.display);
        copied.push(m);
      }
      return out;
    });
  } catch (error) {
    for (const m of copied) {
      await deps.images.delete(m.to.original).catch(() => undefined);
      await deps.images.delete(m.to.display).catch(() => undefined);
    }
    throw translateDbError(error);
  }
}

/** After commit: the pending copies of accepted images are no longer needed. */
async function finishMoves(deps: ProposalDeps, moves: readonly UploadMove[]): Promise<void> {
  for (const m of moves) {
    await deps.images.delete(m.from.original).catch((e) => deps.log?.('could not delete a pending image', e));
    await deps.images.delete(m.from.display).catch((e) => deps.log?.('could not delete a pending image', e));
  }
}

// ---------------------------------------------------------------- accept and reject

/** Applies a pending Proposal in the caller's transaction and writes its log entry. */
async function acceptInTransaction(tx: Db, deps: ProposalDeps, proposal: Proposal, editor: Account, body: AcceptBody): Promise<{ proposal: Proposal; moves: UploadMove[] }> {
  const now = deps.clock.now();
  const stored = await loadOperations(tx, proposal.id);
  const effective = stored.map((s) => s.effective);

  // Editor corrections: a replacement of the same kind of operation, recorded as the Editor's.
  const corrected = new Map<number, Operation>();
  for (const c of body.corrections) {
    const s = stored[c.position];
    if (!s) throw new ApiProblem(400, 'invalid_correction', `There is no operation ${c.position + 1} to correct.`);
    const parsed = Operation.safeParse(c.operation);
    if (!parsed.success) throw new ApiProblem(400, 'invalid_correction', `Correction of operation ${c.position + 1}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    if (parsed.data.op !== s.original.op) throw new ApiProblem(400, 'invalid_correction', `Operation ${c.position + 1} is ${s.original.op}; a correction cannot turn it into ${parsed.data.op}.`);
    effective[c.position] = parsed.data;
    corrected.set(c.position, parsed.data);
  }
  if (corrected.size > 0) {
    const { issues } = checkOperations(effective, { editor: true, allowRestore: proposal.kind === 'undo' });
    if (issues.length) throw issuesProblem(issues, editor.language);
  }

  // Conflicts: the Editor chooses per field; the choice is stored as an Editor correction.
  const conflicts = await findConflicts(tx, effective);
  for (const r of body.resolutions) {
    const conflict = conflicts.get(r.position);
    if (!conflict) continue;
    const op = effective[r.position]!;
    let resolved: Operation;
    if (op.op === 'setField') {
      const missing = Object.keys(op.set).filter((f) => !(f in r.fields));
      if (missing.length) throw new ApiProblem(409, 'conflict', `Operation ${r.position + 1}: choose a value for ${missing.join(', ')}.`);
      const set = Object.fromEntries(Object.entries(op.set).filter(([f]) => r.fields[f] === 'proposal'));
      resolved = { ...op, set, baseVersion: conflict.currentVersion ?? op.baseVersion };
    } else if (op.op === 'mergePersons') {
      const keep = await snapshot(tx, 'person', op.keepId);
      const gone = await snapshot(tx, 'person', op.mergeId);
      resolved = { ...op, keepBaseVersion: keep?.version ?? op.keepBaseVersion, mergeBaseVersion: gone?.version ?? op.mergeBaseVersion };
    } else if (conflict.currentVersion !== null && 'baseVersion' in op) {
      resolved = { ...op, baseVersion: conflict.currentVersion } as Operation;
    } else {
      continue;
    }
    effective[r.position] = resolved;
    corrected.set(r.position, resolved);
    conflicts.delete(r.position);
  }
  if (conflicts.size > 0) {
    const [position, c] = [...conflicts.entries()][0]!;
    const what = c.currentVersion === null ? 'no longer exists' : 'was changed since the Proposal was written';
    throw new ApiProblem(409, 'conflict', `Operation ${position + 1}: ${c.label.en} ${what}. Choose per field before accepting.`);
  }

  for (const [position, op] of corrected) {
    await tx
      .updateTable('proposal_operation')
      .set({ corrected: JSON.stringify(op), corrected_by: editor.id, corrected_at: now })
      .where('proposal_id', '=', proposal.id)
      .where('position', '=', position)
      .execute();
  }

  const applied = await applyOperations(tx, effective, { proposalId: proposal.id, authorId: proposal.author_id });
  const entry = await tx
    .insertInto('log_entry')
    .values({ proposal_id: proposal.id, kind: proposal.kind, author_id: proposal.author_id, accepted_by: editor.id, accepted_at: now, citation_ids: applied.citationIds } as never)
    .returning('id')
    .executeTakeFirstOrThrow();
  const changes = applied.changes.list();
  if (changes.length) {
    await tx
      .insertInto('log_change')
      .values(
        changes.map((c, seq) => ({
          log_entry_id: entry.id,
          seq,
          record_table: c.table,
          record_id: c.id,
          before: c.before ? JSON.stringify(c.before) : null,
          after: c.after ? JSON.stringify(c.after) : null,
        })),
      )
      .execute();
  }
  for (const m of applied.uploads) await tx.updateTable('upload').set({ image_id: m.imageId }).where('id', '=', m.uploadId).execute();
  const updated = await tx
    .updateTable('proposal')
    .set({ status: 'accepted', decided_at: now, decided_by: editor.id, decision_note: body.note })
    .where('id', '=', proposal.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  return { proposal: updated, moves: applied.uploads };
}

async function lockPending(tx: Db, id: string): Promise<Proposal> {
  const p = await tx.selectFrom('proposal').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  if (!p) throw new ApiProblem(404, 'not_found', 'No Proposal with this id.');
  if (p.status !== 'pending') throw new ApiProblem(409, 'already_decided', `This Proposal was already ${p.status}.`);
  return p;
}

export async function acceptProposal(deps: ProposalDeps, editor: Account, id: string, body: AcceptBody): Promise<ProposalView> {
  const result = await transaction(deps.db, async (tx) => acceptInTransaction(tx, deps, await lockPending(tx, id), editor, body), deps);
  await finishMoves(deps, result.moves);
  await sendOutcome(deps, result.proposal);
  return (await proposalViews(deps.db, [result.proposal]))[0]!;
}

export async function rejectProposal(deps: ProposalDeps, editor: Account, id: string, note: string | null): Promise<ProposalView> {
  const now = deps.clock.now();
  const updated = await deps.db.transaction().execute(async (tx) => {
    await lockPending(tx, id);
    return tx
      .updateTable('proposal')
      .set({ status: 'rejected', decided_at: now, decided_by: editor.id, decision_note: note && note.trim() ? note.trim() : null })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
  await sendOutcome(deps, updated);
  return (await proposalViews(deps.db, [updated]))[0]!;
}

/**
 * Tells the author the outcome in their language (notifications spec), unless they muted
 * outcome emails, decided it themselves, or are an Agent (Agents read outcomes from the API).
 */
async function sendOutcome(deps: ProposalDeps, p: Proposal): Promise<void> {
  if (p.kind !== 'contribution' || p.decided_by === p.author_id) return;
  const author = await deps.db.selectFrom('account').selectAll().where('id', '=', p.author_id).executeTakeFirstOrThrow();
  if (!author.outcome_emails || author.disabled_at || isAgent(author)) return;
  const [view] = await proposalViews(deps.db, [p]);
  try {
    await deps.mailer.send(
      outcomeEmail({
        to: author.email,
        language: author.language,
        displayName: author.display_name,
        accepted: p.status === 'accepted',
        editorName: view!.decidedBy?.displayName ?? '',
        note: p.decision_note,
        changes: view!.operations.map((o) => o.summary[author.language]),
        link: `${deps.publicOrigin}/#work/mine/${p.id}`,
      }),
    );
  } catch (error) {
    deps.log?.('could not send the outcome email', error);
  }
}

// ---------------------------------------------------------------- merge

/** Merging two Persons is an Editor's direct change (review spec, "Merging duplicate Persons"). */
export async function mergePersons(deps: ProposalDeps, editor: Account, keepId: string, body: { mergeId: string; keepBaseVersion: number; mergeBaseVersion: number; note: string | null }): Promise<ProposalView> {
  const op = { op: 'mergePersons', keepId, mergeId: body.mergeId, keepBaseVersion: body.keepBaseVersion, mergeBaseVersion: body.mergeBaseVersion };
  const { view } = await submitProposal(deps, editor, { formatVersion: OPERATIONS_VERSION, idempotencyKey: `merge-${keepId}-${body.mergeId}-${deps.clock.now().getTime()}`, note: body.note, direct: true, operations: [op] });
  return view;
}

export { insertProposal, acceptInTransaction, transaction, finishMoves };
