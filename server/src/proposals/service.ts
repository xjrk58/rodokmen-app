import {
  baseTargetOf,
  checkOperations,
  EVIDENCE_MESSAGE,
  Operation,
  OPERATIONS_VERSION,
  type AcceptBody,
  type ProposalView,
  type SubmitProposalBody,
} from '@rodokmen/shared';
import type { Db } from '../db/db.js';
import type { Account, Proposal } from '../db/types.js';
import { ApiProblem } from '../auth/problem.js';
import type { Mailer } from '../mail/mailer.js';
import { outcomeEmail } from '../mail/templates.js';
import type { ImageStorage } from '../storage/images.js';
import type { Clock } from '../tree/summaries.js';
import { applyOperations, RECORD_TABLES, translateDbError, type ApplyResult, type UploadMove } from './apply.js';
import { snapshot } from './records.js';
import { canReview, findConflicts, isAgent, loadOperations, proposalViews, type StoredOperation } from './views.js';

/** Writing Proposals: submit, accept (with corrections and conflict choices), reject and merge. */
export interface ProposalDeps {
  db: Db;
  clock: Clock;
  images: ImageStorage;
  mailer: Mailer;
  publicOrigin: string;
  log?: (msg: string, error?: unknown) => void;
}

function targetColumns(op: Operation): { target_table: string | null; target_id: string | null; base_version: number | null } {
  const t = baseTargetOf(op);
  if (op.op === 'mergePersons') return { target_table: 'person', target_id: op.mergeId, base_version: op.mergeBaseVersion };
  if (op.op === 'restoreRecord') return { target_table: op.table, target_id: op.id, base_version: op.baseVersion };
  if (!t) return { target_table: null, target_id: null, base_version: null };
  return { target_table: RECORD_TABLES[t.record], target_id: t.id, base_version: t.baseVersion ?? null };
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

/**
 * Runs a transaction; rule violations found at commit become API problems. Accepted images are
 * copied to images/ before the commit; on failure every copy made so far is removed again.
 */
async function transaction<T extends { moves?: UploadMove[] }>(db: Db, fn: (tx: Db) => Promise<T>, deps: ProposalDeps): Promise<T> {
  const copied: string[] = [];
  try {
    return await db.transaction().execute(async (tx) => {
      const out = await fn(tx);
      for (const m of out.moves ?? []) {
        for (const kind of ['original', 'display'] as const) {
          await deps.images.copy(m.from[kind], m.to[kind]);
          copied.push(m.to[kind]);
        }
      }
      return out;
    });
  } catch (error) {
    for (const key of copied) await deps.images.delete(key).catch((e: unknown) => deps.log?.(`could not remove ${key} after a failed accept`, e));
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

/**
 * Editor corrections: a replacement of the same kind of operation, recorded as the Editor's.
 * Returns the operations as they will be applied, and the corrected ones by position.
 */
function applyCorrections(stored: readonly StoredOperation[], body: AcceptBody, proposal: Proposal, editor: Account): { effective: Operation[]; corrected: Map<number, Operation> } {
  const effective = stored.map((s) => s.effective);
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
  return { effective, corrected };
}

/** The same operation based on another version of its record, for those that name one. */
function withBaseVersion(op: Operation, baseVersion: number): Operation | null {
  switch (op.op) {
    case 'addName':
    case 'addRole':
    case 'linkChild':
    case 'attachCitation':
    case 'setField':
      return { ...op, baseVersion };
    default:
      return null;
  }
}

/** One conflict resolved by the Editor's choice: the operation to apply instead, or null to leave it. */
async function resolved(tx: Db, op: Operation, choice: AcceptBody['resolutions'][number], currentVersion: number | null): Promise<Operation | null> {
  if (op.op === 'setField') {
    const missing = Object.keys(op.set).filter((f) => !(f in choice.fields));
    if (missing.length) throw new ApiProblem(409, 'conflict', `Operation ${choice.position + 1}: choose a value for ${missing.join(', ')}.`);
    const set = Object.fromEntries(Object.entries(op.set).filter(([f]) => choice.fields[f] === 'proposal'));
    return { ...op, set, baseVersion: currentVersion ?? op.baseVersion };
  }
  if (op.op === 'mergePersons') {
    const keep = await snapshot(tx, 'person', op.keepId);
    const gone = await snapshot(tx, 'person', op.mergeId);
    return { ...op, keepBaseVersion: keep?.version ?? op.keepBaseVersion, mergeBaseVersion: gone?.version ?? op.mergeBaseVersion };
  }
  return currentVersion === null ? null : withBaseVersion(op, currentVersion);
}

/** Conflicts: the Editor chooses per field; each choice is stored as an Editor correction. */
async function resolveConflicts(tx: Db, effective: Operation[], corrected: Map<number, Operation>, resolutions: AcceptBody['resolutions']): Promise<void> {
  const conflicts = await findConflicts(tx, effective);
  for (const r of resolutions) {
    const conflict = conflicts.get(r.position);
    const op = effective[r.position];
    if (!conflict || !op) continue;
    const next = await resolved(tx, op, r, conflict.currentVersion);
    if (!next) continue;
    effective[r.position] = next;
    corrected.set(r.position, next);
    conflicts.delete(r.position);
  }
  const [first] = conflicts.entries();
  if (first) {
    const [position, c] = first;
    const what = c.currentVersion === null ? 'no longer exists' : 'was changed since the Proposal was written';
    throw new ApiProblem(409, 'conflict', `Operation ${position + 1}: ${c.label.en} ${what}. Choose per field before accepting.`);
  }
}

/** The log entry of an accepted Proposal, with every changed record before and after. */
async function writeLog(tx: Db, proposal: Proposal, editor: Account, now: Date, applied: ApplyResult): Promise<void> {
  const entry = await tx
    .insertInto('log_entry')
    .values({ proposal_id: proposal.id, kind: proposal.kind, author_id: proposal.author_id, accepted_by: editor.id, accepted_at: now, citation_ids: applied.citationIds })
    .returning('id')
    .executeTakeFirstOrThrow();
  const changes = applied.changes.list();
  if (changes.length === 0) return;
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

/**
 * Uploads follow their images: moved to images/ on accept; an undo that removes or brings
 * back an image marks its upload orphaned (files kept 30 days) or in use again.
 */
async function followUploads(tx: Db, applied: ApplyResult, now: Date): Promise<void> {
  for (const m of applied.uploads) {
    await tx.updateTable('upload').set({ image_id: m.imageId, storage_key: m.to.original, display_key: m.to.display, orphaned_at: null }).where('id', '=', m.uploadId).execute();
  }
  for (const c of applied.changes.list().filter((x) => x.table === 'image')) {
    const removed = c.after === null ? c.before?.storage_key : undefined;
    const restored = c.before === null && !applied.uploads.some((m) => m.imageId === c.id) ? c.after?.storage_key : undefined;
    if (typeof removed === 'string') {
      await tx.updateTable('upload').set({ orphaned_at: now }).where('storage_key', '=', removed).execute();
    } else if (typeof restored === 'string') {
      await tx.updateTable('upload').set({ image_id: c.id, orphaned_at: null }).where('storage_key', '=', restored).where('status', '!=', 'deleted').execute();
    }
  }
}

/** Applies a pending Proposal in the caller's transaction and writes its log entry. */
async function acceptInTransaction(tx: Db, deps: ProposalDeps, proposal: Proposal, editor: Account, body: AcceptBody): Promise<{ proposal: Proposal; moves: UploadMove[] }> {
  const now = deps.clock.now();
  const { effective, corrected } = applyCorrections(await loadOperations(tx, proposal.id), body, proposal, editor);
  await resolveConflicts(tx, effective, corrected, body.resolutions);
  for (const [position, op] of corrected) {
    await tx
      .updateTable('proposal_operation')
      .set({ corrected: JSON.stringify(op), corrected_by: editor.id, corrected_at: now })
      .where('proposal_id', '=', proposal.id)
      .where('position', '=', position)
      .execute();
  }
  const applied = await applyOperations(tx, effective, { proposalId: proposal.id, authorId: proposal.author_id });
  await writeLog(tx, proposal, editor, now, applied);
  await followUploads(tx, applied, now);
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
  return afterDecision(deps, result.proposal);
}

export async function rejectProposal(deps: ProposalDeps, editor: Account, id: string, note: string | null): Promise<ProposalView> {
  const now = deps.clock.now();
  const updated = await deps.db.transaction().execute(async (tx) => {
    await lockPending(tx, id);
    return tx
      .updateTable('proposal')
      .set({ status: 'rejected', decided_at: now, decided_by: editor.id, decision_note: note || null })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
  return afterDecision(deps, updated);
}

/** The decided Proposal's view, and the outcome email built from it. */
async function afterDecision(deps: ProposalDeps, p: Proposal): Promise<ProposalView> {
  const [view] = await proposalViews(deps.db, [p]);
  await sendOutcome(deps, p, view!);
  return view!;
}

/**
 * Tells the author the outcome in their language (notifications spec), unless they muted
 * outcome emails, decided it themselves, or are an Agent (Agents read outcomes from the API).
 * The decision is already committed: a failure here is logged, never returned to the Editor.
 */
async function sendOutcome(deps: ProposalDeps, p: Proposal, view: ProposalView): Promise<void> {
  if (p.kind !== 'contribution' || p.decided_by === p.author_id) return;
  try {
    const author = await deps.db.selectFrom('account').selectAll().where('id', '=', p.author_id).executeTakeFirstOrThrow();
    if (!author.outcome_emails || author.disabled_at || isAgent(author)) return;
    await deps.mailer.send(
      outcomeEmail({
        to: author.email,
        language: author.language,
        displayName: author.display_name,
        accepted: p.status === 'accepted',
        editorName: view.decidedBy?.displayName ?? '',
        note: p.decision_note,
        changes: view.operations.map((o) => o.summary[author.language]),
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

