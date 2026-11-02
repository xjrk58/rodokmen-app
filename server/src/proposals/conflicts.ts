import type { AcceptBody, Operation } from '@rodokmen/shared';
import { ApiProblem } from '../auth/problem.js';
import type { Db } from '../db/db.js';
import { RECORD_TABLES } from './columns.js';
import { snapshot } from './records.js';
import { findConflicts } from './views.js';

/**
 * Conflicts at accept time (review spec, "Conflicts are resolved by the Editor"): an operation
 * based on an older version of its record is applied only as the Editor chose, field by field.
 */

/** The same operation based on another version of its record, for those that name one. */
function withBaseVersion(op: Operation, baseVersion: number): Operation | null {
  switch (op.op) {
    case 'addName':
    case 'addRole':
    case 'linkChild':
    case 'attachCitation':
    case 'setField':
    case 'setNotes':
    case 'addPlaceName':
    case 'addHouseNumber':
    case 'linkPlaceParish':
    case 'linkPlaceEstate':
    case 'addLabel':
    case 'removeLabel':
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
  if (op.op === 'setNotes') {
    if (!('notes' in choice.fields)) throw new ApiProblem(409, 'conflict', `Operation ${choice.position + 1}: choose a value for notes.`);
    if (currentVersion === null) return null;
    // Keeping the current notes writes them back as they are: no change.
    const current = choice.fields.notes === 'current' ? ((await snapshot(tx, RECORD_TABLES[op.record], op.id))?.notes ?? null) : op.notes;
    return { ...op, notes: typeof current === 'string' ? current : null, baseVersion: currentVersion };
  }
  if (op.op === 'mergePersons') {
    const keep = await snapshot(tx, 'person', op.keepId);
    const gone = await snapshot(tx, 'person', op.mergeId);
    return { ...op, keepBaseVersion: keep?.version ?? op.keepBaseVersion, mergeBaseVersion: gone?.version ?? op.mergeBaseVersion };
  }
  return currentVersion === null ? null : withBaseVersion(op, currentVersion);
}

/** Conflicts: the Editor chooses per field; each choice is stored as an Editor correction. */
export async function resolveConflicts(
  tx: Db,
  effective: Operation[],
  corrected: Map<number, Operation>,
  resolutions: AcceptBody['resolutions'],
): Promise<void> {
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
