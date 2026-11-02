import { CREATES, Operation, parseBatchRef, referencesOf, type BatchView, type TempKind } from '@rodokmen/shared';
import { sql } from 'kysely';
import { ApiProblem } from '../auth/problem.js';
import type { Db } from '../db/db.js';
import type { Account, Proposal } from '../db/types.js';
import { blockedProposals } from './batch-state.js';
import { authorRef, loadOperationsOf } from './views.js';

/**
 * Import batches (review spec, "Proposals in an Import batch build on each other"; add-vault-import
 * tasks 2.1 and 2.2). A Proposal of a batch may refer to a record an earlier Proposal of the
 * same batch creates, by a batch reference (`batch:<proposal id>/tmp:x`). It is checked when the
 * Proposal is submitted, stored as a dependency, and resolved when the Proposal is accepted,
 * which may only happen after the Proposals it builds on. While one of them is rejected, it is
 * blocked.
 */

/** Every batch reference in some operations, with the kind of record each must be. */
export function batchRefsOf(ops: readonly Operation[]): Array<{ ref: string; kind: TempKind; proposalId: string; tempId: string; position: number }> {
  return ops.flatMap((op, position) =>
    referencesOf(op).flatMap((r) => {
      const parsed = parseBatchRef(r.ref);
      return parsed ? [{ ref: r.ref, kind: r.kind, position, ...parsed }] : [];
    }),
  );
}

/** The batch a new Proposal joins: it must be the author's own. Locked, so positions are given in turn. */
export async function lockBatch(tx: Db, author: Account, batchId: string) {
  const batch = await tx.selectFrom('import_batch').selectAll().where('id', '=', batchId).forUpdate().executeTakeFirst();
  if (!batch) throw new ApiProblem(404, 'not_found', 'No Import batch with this id.');
  if (batch.author_id !== author.id) throw new ApiProblem(403, 'forbidden', 'Proposals are added only to Import batches you opened.');
  const { next } = await tx
    .selectFrom('proposal')
    .select(sql<number>`coalesce(max(batch_position) + 1, 0)::int`.as('next'))
    .where('batch_id', '=', batchId)
    .executeTakeFirstOrThrow();
  return { batch, next };
}

/**
 * Checks the batch references of a Proposal: each names an earlier Proposal of the same batch,
 * and a record of the right kind that Proposal creates. Returns the Proposals it builds on.
 */
export async function checkBatchRefs(tx: Db, ops: readonly Operation[], batchId: string | null, position: number | null): Promise<string[]> {
  const refs = batchRefsOf(ops);
  if (refs.length === 0) return [];
  if (batchId === null || position === null)
    throw new ApiProblem(400, 'invalid_proposal', `Operation ${refs[0]!.position + 1}: a batch reference is used only in a Proposal of an Import batch.`);
  const ids = [...new Set(refs.map((r) => r.proposalId))];
  const earlier = await tx.selectFrom('proposal').select(['id', 'batch_id', 'batch_position']).where('id', 'in', ids).execute();
  const stored = await loadOperationsOf(tx, ids);
  for (const r of refs) {
    const p = earlier.find((e) => e.id === r.proposalId);
    if (!p || p.batch_id !== batchId || p.batch_position === null || p.batch_position >= position)
      throw new ApiProblem(400, 'invalid_proposal', `Operation ${r.position + 1}: ${r.ref} is not a record of an earlier Proposal of this Import batch.`);
    const creator = (stored.get(r.proposalId) ?? []).find((s) => 'tempId' in s.effective && s.effective.tempId === r.tempId);
    const kind = creator ? CREATES[creator.effective.op] : undefined;
    if (kind !== r.kind)
      throw new ApiProblem(400, 'invalid_proposal', `Operation ${r.position + 1}: ${r.ref} is ${kind ? `a ${kind}` : 'not created there'}, not a ${r.kind}.`);
  }
  return ids;
}

/** Stores what a batch Proposal builds on (again after a correction). */
export async function storeDependencies(tx: Db, proposalId: string, dependsOn: readonly string[]): Promise<void> {
  await tx.deleteFrom('proposal_dependency').where('proposal_id', '=', proposalId).execute();
  if (dependsOn.length)
    await tx
      .insertInto('proposal_dependency')
      .values(dependsOn.map((d) => ({ proposal_id: proposalId, depends_on_id: d })))
      .execute();
}

/** Every string of a JSON value that is a batch reference, replaced by the record it resolves to. */
function replaceRefs(value: unknown, resolved: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return resolved.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => replaceRefs(v, resolved));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceRefs(v, resolved)]));
  return value;
}

/**
 * Resolves the batch references of a Proposal about to be accepted (review spec, "Out of order"):
 * each must name a Proposal accepted before it. A pending one is to be decided first; a rejected
 * one blocks it until it is rejected too or corrected. Returns the operations with record ids.
 */
export async function resolveBatchRefs(tx: Db, proposal: Proposal, effective: Operation[]): Promise<Operation[]> {
  const refs = batchRefsOf(effective);
  await storeDependencies(tx, proposal.id, await checkBatchRefs(tx, effective, proposal.batch_id, proposal.batch_position));
  if (refs.length === 0) return effective;
  const ids = [...new Set(refs.map((r) => r.proposalId))];
  const earlier = await tx.selectFrom('proposal').select(['id', 'status', 'batch_position']).where('id', 'in', ids).orderBy('batch_position').execute();
  const pending = earlier.find((p) => p.status === 'pending');
  if (pending)
    throw new ApiProblem(
      409,
      'batch_order',
      `This Proposal builds on Proposal ${pending.id} (number ${(pending.batch_position ?? 0) + 1} of the Import batch), which is still pending. Decide that one first.`,
    );
  const rejected = earlier.find((p) => p.status === 'rejected');
  if (rejected)
    throw new ApiProblem(
      409,
      'batch_blocked',
      `This Proposal builds on Proposal ${rejected.id}, which was rejected. Correct it so that it no longer does, or reject it too.`,
    );
  const temps = await tx.selectFrom('proposal_temp').selectAll().where('proposal_id', 'in', ids).execute();
  const resolved = new Map(temps.map((t) => [`batch:${t.proposal_id}/${t.temp_id}`, t.record_id]));
  const missing = refs.find((r) => !resolved.has(r.ref));
  if (missing) throw new ApiProblem(409, 'record_missing', `Operation ${missing.position + 1}: the record ${missing.ref} no longer exists.`);
  return effective.map((op) => Operation.parse(replaceRefs(op, resolved)));
}

/** Keeps the records an accepted batch Proposal created, for the batch references of later ones. */
export async function storeTemps(tx: Db, proposal: Proposal, temps: ReadonlyMap<string, string>): Promise<void> {
  if (proposal.batch_id === null || temps.size === 0) return;
  await tx
    .insertInto('proposal_temp')
    .values([...temps].map(([tempId, recordId]) => ({ proposal_id: proposal.id, temp_id: tempId, record_id: recordId })))
    .execute();
}

/** Import batches with their progress (review spec, "Batch view in the review queue"). */
export async function batchViews(db: Db, where: { id?: string; authorId?: string } = {}): Promise<BatchView[]> {
  let q = db.selectFrom('import_batch as b').innerJoin('account as a', 'a.id', 'b.author_id').selectAll('b').select(['a.display_name', 'a.role']);
  if (where.id) q = q.where('b.id', '=', where.id);
  if (where.authorId) q = q.where('b.author_id', '=', where.authorId);
  const batches = await q.orderBy('b.created_at', 'desc').orderBy('b.id', 'desc').execute();
  if (batches.length === 0) return [];
  const ids = batches.map((b) => b.id);
  const counts = await db
    .selectFrom('proposal')
    .select(['batch_id', 'status', (eb) => eb.fn.countAll<number>().as('n')])
    .where('batch_id', 'in', ids)
    .groupBy(['batch_id', 'status'])
    .execute();
  const changes = await db
    .selectFrom('proposal_operation as o')
    .innerJoin('proposal as p', 'p.id', 'o.proposal_id')
    .select(['p.batch_id', (eb) => eb.fn.countAll<number>().as('n')])
    .where('p.batch_id', 'in', ids)
    .where('p.status', '=', 'pending')
    .groupBy('p.batch_id')
    .execute();
  const out: BatchView[] = [];
  for (const b of batches) {
    const n = (status: string) => counts.find((c) => c.batch_id === b.id && c.status === status)?.n ?? 0;
    const blocked = (await blockedProposals(db, { batchId: b.id })).size;
    out.push({
      id: b.id,
      version: b.version,
      name: b.name,
      author: authorRef({ id: b.author_id, display_name: b.display_name, role: b.role }),
      createdAt: new Date(b.created_at).toISOString(),
      vaultCommit: b.vault_commit,
      note: b.note,
      counts: {
        total: n('pending') + n('accepted') + n('rejected'),
        pending: n('pending') - blocked,
        blocked,
        accepted: n('accepted'),
        rejected: n('rejected'),
      },
      pendingChanges: changes.find((c) => c.batch_id === b.id)?.n ?? 0,
    });
  }
  return out;
}
