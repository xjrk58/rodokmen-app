import type { AcceptBatchBody, AcceptBatchResult } from '@rodokmen/shared';
import { ApiProblem } from '../auth/problem.js';
import type { Account } from '../db/types.js';
import { messageOf } from '../errors.js';
import { refreshSuggestions } from '../leads/gaps.js';
import { recomputeRelations } from '../tree/relation.js';
import { blockedProposals, dependenciesOf } from './batch-state.js';
import { batchViews } from './batches.js';
import { acceptInTransaction, finishMoves, lockPending, transaction, type ProposalDeps } from './service.js';

/**
 * Accepts every pending Proposal of an Import batch, in batch order (review spec, "Accept a
 * whole Import batch"; the Owner only, see mayDo). Each is accepted in its own transaction, logged
 * as accepted by the Owner; one that fails stays pending and is listed, and so does every one that
 * builds on it, while the rest go on. The relation to the family and the gap finder run once, at
 * the end. `proposals` is the count the Owner's confirmation stated.
 */
export async function acceptBatch(deps: ProposalDeps, owner: Account, batchId: string, body: AcceptBatchBody): Promise<AcceptBatchResult> {
  const [batch] = await batchViews(deps.db, { id: batchId });
  if (!batch) throw new ApiProblem(404, 'not_found', 'No Import batch with this id.');
  const pendingNow = batch.counts.pending + batch.counts.blocked;
  if (body.proposals !== pendingNow)
    throw new ApiProblem(409, 'batch_changed', `The batch has ${pendingNow} pending Proposals now, not ${body.proposals}. Look at it again before accepting.`);
  const rows = await deps.db
    .selectFrom('proposal')
    .selectAll()
    .where('batch_id', '=', batchId)
    .where('status', '=', 'pending')
    .orderBy('batch_position')
    .execute();
  const blocked = await blockedProposals(deps.db, { batchId });
  const dependsOn = await dependenciesOf(
    deps.db,
    rows.map((p) => p.id),
  );
  const result: AcceptBatchResult = { accepted: [], failed: [], blocked: [] };
  const left = new Set<string>();
  const touched = new Set<string>();
  for (const p of rows) {
    const position = p.batch_position ?? 0;
    const blockedBy = blocked.get(p.id) ?? (dependsOn.get(p.id) ?? []).find((d) => left.has(d));
    if (blockedBy) {
      result.blocked.push({ id: p.id, position, blockedBy });
      left.add(p.id);
      continue;
    }
    try {
      const accepted = await transaction(
        deps.db,
        async (tx) => acceptInTransaction(tx, deps, await lockPending(tx, p.id), owner, { note: body.note, corrections: [], resolutions: [] }, touched),
        deps,
      );
      await finishMoves(deps, accepted.moves);
      result.accepted.push(p.id);
    } catch (error) {
      if (!(error instanceof ApiProblem)) deps.log?.(`could not accept Proposal ${p.id} of Import batch ${batchId}`, error);
      result.failed.push({ id: p.id, position, message: error instanceof ApiProblem ? error.message : messageOf(error) });
      left.add(p.id);
    }
  }
  // Once for the whole batch (tree-model spec, "Relation follows the evidence"; research-leads spec, "Gap finder suggests leads").
  const now = deps.clock.now();
  await deps.db.transaction().execute(async (tx) => {
    const relation = await recomputeRelations(tx);
    await refreshSuggestions(tx, now, { personIds: [...touched, ...relation.changedIds] });
  });
  return result;
}
