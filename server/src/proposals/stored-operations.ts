import { Operation } from '@rodokmen/shared';
import type { Db } from '../db/db.js';

/**
 * A Proposal's operations as stored: as written, as an Editor corrected them, and the one
 * that counts. Apart from views.ts so that labels.ts can read them without importing it.
 */
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
  const rows = await db
    .selectFrom('proposal_operation')
    .selectAll()
    .where('proposal_id', 'in', [...proposalIds])
    .orderBy('proposal_id')
    .orderBy('position')
    .execute();
  for (const r of rows) {
    const original = Operation.parse(r.operation);
    const corrected = r.corrected ? Operation.parse(r.corrected) : null;
    const list = out.get(r.proposal_id) ?? [];
    list.push({ position: r.position, original, corrected, correctedBy: r.corrected_by, effective: corrected ?? original });
    out.set(r.proposal_id, list);
  }
  return out;
}
