import { capConfidence, Confidence, type Operation, type ReaderInfo } from '@rodokmen/shared';
import { sql } from 'kysely';
import { ApiProblem } from '../auth/problem.js';
import type { Db } from '../db/db.js';
import type { Account } from '../db/types.js';

/**
 * Proposals drafted from readings (scan-reading spec, "The machine's reading is marked and
 * modest"; add-scan-reading task 2.1): the server, not the device, caps their new Citations at
 * normal confidence, and checks the readings and marks they name.
 */
/**
 * Whether a Proposal was drafted by the reader (scan-reading spec, "The machine's reading is
 * marked and modest"): it says so, naming readings of its author that are done, or one of its
 * images was read. Its marks must point at its operations.
 */
export async function readerDrafted(db: Db, author: Account, reader: ReaderInfo | null, ops: readonly Operation[]): Promise<boolean> {
  if (reader) {
    const rows = await db.selectFrom('reading').select(['id', 'author_id', 'status']).where('id', 'in', reader.readingIds).execute();
    for (const id of reader.readingIds) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.author_id !== author.id || r.status !== 'done')
        throw new ApiProblem(400, 'unknown_reading', 'The Proposal names a reading that is not one of yours, or not finished.');
    }
    const outside = reader.marks.find((m) => m.position >= ops.length);
    if (outside)
      throw new ApiProblem(400, 'invalid_proposal', `A "read by AI" mark points at operation ${outside.position + 1}, which the Proposal does not have.`);
    return true;
  }
  const uploadIds = ops.flatMap((o) => (o.op === 'addImage' ? [o.uploadId] : []));
  if (uploadIds.length === 0) return false;
  const read = await db
    .selectFrom('reading')
    .select('id')
    .where(sql<boolean>`upload_ids && ${sql.val(uploadIds)}::uuid[]`)
    .executeTakeFirst();
  return read !== undefined;
}

/** A new Citation of a Proposal the reader drafted has at most normal confidence (capConfidence, shared/src/reading.ts, proved). */
export function capped(op: Operation): Operation {
  return op.op === 'createCitation' ? { ...op, confidence: Confidence.parse(capConfidence(op.confidence, true)) } : op;
}
