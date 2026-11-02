/**
 * How operations refer to records (proposals spec): an existing record by its id, a record
 * created earlier in the same Proposal by its temporary id (`tmp:child`), and a record an earlier
 * Proposal of the same Import batch creates (review spec, "Proposals in an Import batch build on
 * each other").
 */
import { z } from 'zod';
import { Id } from './common.js';

/** A record created earlier in the same Proposal. */
export const TempId = z
  .string()
  .regex(/^tmp:[A-Za-z0-9_-]{1,40}$/, 'a temporary id looks like tmp:child')
  .meta({ id: 'TempId', description: 'Temporary id of a record created earlier in the same Proposal, such as tmp:child' });

/**
 * A record created by an earlier Proposal of the same Import batch (review spec, "Proposals in an
 * Import batch build on each other"): that Proposal's id and the temporary id it gave the record.
 * It resolves to the record once that Proposal is accepted.
 */
export const BatchRef = z
  .string()
  .regex(
    /^batch:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/tmp:[A-Za-z0-9_-]{1,40}$/,
    'a batch reference looks like batch:<proposal id>/tmp:child',
  )
  .meta({ id: 'BatchRef', description: 'A record created by an earlier Proposal of the same Import batch: batch:<proposal id>/<its temporary id>' });

/** An existing record (its id), one created in the same Proposal (its temporary id), or one an earlier Proposal of the same Import batch creates. */
export const Ref = z.union([Id, TempId, BatchRef]).meta({ id: 'Ref' });

export const isTempId = (ref: string): boolean => ref.startsWith('tmp:');
export const isBatchRef = (ref: string): boolean => ref.startsWith('batch:');
/** A record that does not exist yet: created in this Proposal, or by an earlier one of its Import batch. */
export const isNewRef = (ref: string): boolean => isTempId(ref) || isBatchRef(ref);

/** The Proposal and temporary id of a batch reference. */
export function parseBatchRef(ref: string): { proposalId: string; tempId: string } | null {
  if (!isBatchRef(ref)) return null;
  const [proposalId, tempId] = ref.slice('batch:'.length).split('/');
  return proposalId && tempId ? { proposalId, tempId } : null;
}
