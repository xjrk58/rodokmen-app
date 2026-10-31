import type { FamilyRootList, Operation } from '@rodokmen/shared';
import { v7 as uuidv7 } from 'uuid';
import { ApiProblem } from '../auth/problem.js';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import type { Account } from '../db/types.js';
import { familyRootIds } from '../tree/relation.js';
import { personSummaries } from '../tree/summaries.js';
import { acceptInTransaction, finishMoves, insertProposal, transaction, type ProposalDeps } from './service.js';

/** The Family roots with their summaries, the first marked first. */
export async function familyRootList(deps: { db: Db; clock: Clock }): Promise<FamilyRootList> {
  const ids = await familyRootIds(deps.db);
  const summaries = await personSummaries(deps.db, ids, deps.clock);
  return { items: ids.flatMap((id) => summaries.get(id) ?? []) };
}

/**
 * The Owner marks or unmarks a Family root (tree-model spec, "Family roots"). It is a direct
 * change of the Owner, logged like any other (a Proposal of kind "direct" with one setFamilyRoot
 * operation, accepted at once), so the Person's history shows it and only the Owner can undo it;
 * every relation to the family is recomputed in the same transaction. Marking a root again, or
 * unmarking a Person who is none, changes nothing and logs nothing.
 */
export async function setFamilyRoot(deps: ProposalDeps, owner: Account, personId: string, familyRoot: boolean): Promise<FamilyRootList> {
  const result = await transaction(
    deps.db,
    async (tx) => {
      const person = await tx.selectFrom('person').select(['id', 'merged_into_id']).where('id', '=', personId).forUpdate().executeTakeFirst();
      if (!person) throw new ApiProblem(404, 'not_found', 'No Person with this id.');
      if (person.merged_into_id) throw new ApiProblem(409, 'person_merged', 'This Person was merged into another; mark the remaining Person.');
      const marked = await tx.selectFrom('family_root').select('id').where('person_id', '=', personId).executeTakeFirst();
      if ((marked !== undefined) === familyRoot) return { moves: [] };
      const ops: Operation[] = [{ op: 'setFamilyRoot', personId, familyRoot }];
      const created = await insertProposal(
        tx,
        deps.clock.now(),
        owner,
        { kind: 'direct', note: null, idempotencyKey: `family-root-${personId}-${uuidv7()}` },
        ops,
      );
      return acceptInTransaction(tx, deps, created.proposal, owner, { note: null, corrections: [], resolutions: [] });
    },
    deps,
  );
  await finishMoves(deps, result.moves);
  return familyRootList(deps);
}
