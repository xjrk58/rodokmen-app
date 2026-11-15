import { OPERATIONS_VERSION, type ProposalView } from '@rodokmen/shared';
import type { Account } from '../db/types.js';
import { submitProposal, type ProposalDeps } from './service.js';

/**
 * The merges an Editor makes at any time, outside review: each is a direct change of one
 * operation, so it is logged like any accepted Proposal and undone like one.
 */

/** Merging two Persons is an Editor's direct change (review spec, "Merging duplicate Persons"). */
export async function mergePersons(
  deps: ProposalDeps,
  editor: Account,
  keepId: string,
  body: { mergeId: string; keepBaseVersion: number; mergeBaseVersion: number; note: string | null },
): Promise<ProposalView> {
  const op = { op: 'mergePersons', keepId, mergeId: body.mergeId, keepBaseVersion: body.keepBaseVersion, mergeBaseVersion: body.mergeBaseVersion };
  const { view } = await submitProposal(deps, editor, {
    formatVersion: OPERATIONS_VERSION,
    idempotencyKey: `merge-${keepId}-${body.mergeId}-${deps.clock.now().getTime()}`,
    note: body.note,
    direct: true,
    operations: [op],
    answersLeads: [],
    reader: null,
  });
  return view;
}

/**
 * Merging two Events is an Editor's direct change too (review spec, "Merging duplicate Events"): the
 * Event named by the route stays, the other is merged into it.
 */
export async function mergeEvents(
  deps: ProposalDeps,
  editor: Account,
  keepId: string,
  body: { mergeId: string; keepBaseVersion: number; mergeBaseVersion: number; note: string | null },
): Promise<ProposalView> {
  const op = { op: 'mergeEvents', keepId, mergeId: body.mergeId, keepBaseVersion: body.keepBaseVersion, mergeBaseVersion: body.mergeBaseVersion };
  const { view } = await submitProposal(deps, editor, {
    formatVersion: OPERATIONS_VERSION,
    idempotencyKey: `merge-events-${keepId}-${body.mergeId}-${deps.clock.now().getTime()}`,
    note: body.note,
    direct: true,
    operations: [op],
    answersLeads: [],
    reader: null,
  });
  return view;
}
