/**
 * The decision rules of Proposals and review, as small pure functions: no I/O, no `await`, no
 * regular expressions, plain arrays and records. The server gathers the inputs from the
 * database and calls these, so the rules can be checked on their own (and later proved).
 */

// ---------------------------------------------------------------- who may decide

/**
 * Who may accept, reject, merge and undo (review spec, "Contributors never accept or merge"):
 * Editors and the Owner. Contributors and Agents never may; any other role neither.
 */
export function mayDecide(role: string): boolean {
  return role === 'editor' || role === 'owner';
}

// ---------------------------------------------------------------- evidence

/** Operations that bring a Citation into a Proposal. */
export function isCitationOperation(op: string): boolean {
  return op === 'createCitation' || op === 'attachCitation';
}

/** Operations that change no facts and so need no evidence: merges and the server's undo steps. */
export function isFactFreeOperation(op: string): boolean {
  return op === 'mergePersons' || op === 'restoreRecord';
}

/**
 * The evidence rule (proposals spec, "Evidence is required"): a Proposal includes at least one
 * Citation, created or attached. A Citation of a Family account Source is a Citation like any
 * other, so it counts. Proposals made only of merges and undo steps change no facts and are
 * exempt. An empty Proposal has no evidence.
 */
export function satisfiesEvidenceRule(ops: readonly string[]): boolean {
  if (ops.length === 0) return false;
  let factFree = true;
  for (const op of ops) {
    if (isCitationOperation(op)) return true;
    if (!isFactFreeOperation(op)) factFree = false;
  }
  return factFree;
}

// ---------------------------------------------------------------- conflicts

export interface FieldValue {
  field: string;
  value: unknown;
}

export interface FieldConflictResult {
  field: string;
  proposed: unknown;
  current: unknown;
}

export interface ConflictResult {
  baseVersion: number;
  /** Null when the record no longer exists. */
  currentVersion: number | null;
  /** The fields the operation sets, with the Proposal's value next to the current one. */
  fields: FieldConflictResult[];
}

/** The value of a field in a list of field values, or null when it is not there. */
export function valueOf(values: readonly FieldValue[], field: string): unknown {
  for (const v of values) if (v.field === field) return v.value;
  return null;
}

/**
 * Conflict detection (proposals spec, "Proposals record what they were based on"; review spec,
 * "Conflicts are resolved by the Editor"): an operation is in conflict when the version it was
 * based on is not the record's current version, or the record is gone. Then every field it
 * sets is listed with its current value, for the Editor to choose. Returns null when there is
 * no conflict.
 */
export function detectConflict(baseVersion: number, currentVersion: number | null, proposed: readonly FieldValue[], current: readonly FieldValue[]): ConflictResult | null {
  if (currentVersion !== null && currentVersion === baseVersion) return null;
  const fields: FieldConflictResult[] = [];
  if (currentVersion !== null) {
    for (const p of proposed) fields.push({ field: p.field, proposed: p.value, current: valueOf(current, p.field) });
  }
  return { baseVersion, currentVersion, fields };
}

// ---------------------------------------------------------------- undo

export interface RecordKey {
  table: string;
  id: string;
}

export const sameRecord = (a: RecordKey, b: RecordKey): boolean => a.table === b.table && a.id === b.id;

/** A record that refers to another one (by a foreign key). */
export interface Dependency {
  /** The record the undo would delete. */
  of: RecordKey;
  /** The record that refers to it. */
  dependent: RecordKey;
}

/** An accepted Proposal that created or changed a record, from the log. */
export interface LoggedTouch {
  proposalId: string;
  /** When it was accepted, as milliseconds since the epoch. */
  acceptedAt: number;
  record: RecordKey;
  /** True when that Proposal has itself been undone. */
  undone: boolean;
}

export interface UndoBlockers {
  /** Later accepted Proposals to undo first, newest first, each once. */
  blockedBy: string[];
  /** True when a dependent record was attached by nothing in the log. */
  unlogged: boolean;
}

/**
 * The undo dependency check (tree-history spec, "Undo a whole Proposal"): deleting a record
 * that later accepted Proposals attached records to (a Name or Role of a Person the undone
 * Proposal created, a child linked to its Family …) would cascade into them unseen. Dependents
 * that this undo deletes itself do not count. The result names the Proposals that attached the
 * remaining dependents, newest first, so the Editor undoes those first; an empty `blockedBy`
 * and `unlogged` false mean the undo may go ahead.
 */
export function undoBlockers(undoneProposalId: string, deletions: readonly RecordKey[], dependencies: readonly Dependency[], touches: readonly LoggedTouch[]): UndoBlockers {
  const remaining: RecordKey[] = [];
  for (const d of dependencies) {
    let deletedToo = false;
    for (const x of deletions) if (sameRecord(x, d.dependent)) deletedToo = true;
    let isDeletion = false;
    for (const x of deletions) if (sameRecord(x, d.of)) isDeletion = true;
    if (isDeletion && !deletedToo) remaining.push(d.dependent);
  }
  const found: LoggedTouch[] = [];
  let unlogged = false;
  for (const r of remaining) {
    let logged = false;
    for (const t of touches) {
      if (!sameRecord(t.record, r) || t.proposalId === undoneProposalId || t.undone) continue;
      logged = true;
      let seen = false;
      for (const f of found) if (f.proposalId === t.proposalId) seen = true;
      if (!seen) found.push(t);
    }
    if (!logged) unlogged = true;
  }
  // Newest first (insertion sort: the lists are short).
  const sorted: LoggedTouch[] = [];
  for (const t of found) {
    let i = 0;
    while (i < sorted.length && sorted[i]!.acceptedAt >= t.acceptedAt) i += 1;
    sorted.splice(i, 0, t);
  }
  return { blockedBy: sorted.map((t) => t.proposalId), unlogged };
}
