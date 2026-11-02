/**
 * The decision rules of Proposals and review, as small pure functions: no I/O, no `await`, no
 * regular expressions, plain arrays and records. The server gathers the inputs from the
 * database and calls these, so the rules can be checked on their own.
 *
 * The four rules are proved with LemmaScript (ADR 0009, docs/verification.md): each function
 * marked `//@ verify` meets its `//@` specification, which states the requirement's scenarios,
 * checked by `pnpm --filter @rodokmen/shared verify`. Which inputs the server gathers, and
 * what it does with the answer, are not proved; the tests cover them.
 */

// ---------------------------------------------------------------- who may decide

/**
 * Who may accept, reject, merge and undo (review spec, "Contributors never accept or merge"):
 * Editors and the Owner. Contributors and Agents never may; any other role neither.
 */
export function mayDecide(role: string): boolean {
  //@ verify
  //@ contract review: Contributors never accept or merge
  //@ contract review: Decide on the whole Proposal
  // Scenario "Contributor tries to accept": Contributors and Agents never decide.
  //@ ensures role === 'contributor' ==> !\result
  //@ ensures role === 'agent' ==> !\result
  // Editors decide on a Proposal, and so does the Owner, who is an Editor too.
  //@ ensures role === 'editor' ==> \result
  //@ ensures role === 'owner' ==> \result
  // No other role decides, whatever it is called.
  //@ ensures \result ==> role === 'editor' || role === 'owner'
  return role === 'editor' || role === 'owner';
}

// ---------------------------------------------------------------- what a role may do

/**
 * What a role may do (agent-access spec, "Read and propose only"). Every API route names its
 * action (server/src/auth/plugin.ts asks this function for each request; that wiring is
 * tested, not proved):
 *
 * - `read`: read the Tree, your own Proposals, history and images;
 * - `propose`: submit Proposals and upload their images;
 * - `review`: see the review queue; `accept`, `reject`, `merge`, `undo`; `directEdit`: change the Tree at once;
 * - `ownAccount`: your own sessions, passkeys and email settings;
 * - `manageAccounts`: Members, invitations, roles, Agents and their tokens;
 * - `markFamilyRoots`: mark and unmark Family roots (tree-model spec, "Family roots");
 * - `manageSettings`: the Tree's settings, such as the switch and daily limit of scan reading
 *   (scan-reading spec, "The Owner switches it on").
 *
 * Agents read and propose, and nothing else. Members of every role read, propose and manage
 * their own account; Editors and the Owner also decide on Proposals and edit directly; only the
 * Owner manages accounts, marks Family roots and changes the settings. An unknown role or action
 * is refused.
 */
export function mayDo(role: string, action: string): boolean {
  //@ verify
  //@ contract agent-access: Read and propose only
  //@ contract tree-model: Family roots
  //@ contract scan-reading: The Owner switches it on
  // An Agent token allows reading the Tree and submitting Proposals ...
  //@ ensures role === 'agent' && action === 'read' ==> \result
  //@ ensures role === 'agent' && action === 'propose' ==> \result
  // ... and nothing else.
  //@ ensures role === 'agent' && \result ==> action === 'read' || action === 'propose'
  // Scenario "Agent tries to accept its own Proposal": refused, as are rejecting, merging, undoing, direct edits and account management.
  //@ ensures role === 'agent' && action === 'accept' ==> !\result
  //@ ensures role === 'agent' && action === 'reject' ==> !\result
  //@ ensures role === 'agent' && action === 'merge' ==> !\result
  //@ ensures role === 'agent' && action === 'undo' ==> !\result
  //@ ensures role === 'agent' && action === 'directEdit' ==> !\result
  //@ ensures role === 'agent' && action === 'review' ==> !\result
  //@ ensures role === 'agent' && action === 'ownAccount' ==> !\result
  //@ ensures role === 'agent' && action === 'manageAccounts' ==> !\result
  //@ ensures role === 'agent' && action === 'markFamilyRoots' ==> !\result
  //@ ensures role === 'agent' && action === 'manageSettings' ==> !\result
  // An Agent is never allowed what a Contributor is refused.
  //@ ensures role === 'agent' && \result ==> mayDo('contributor', action)
  // Deciding on Proposals is exactly the review rule (review spec, "Contributors never accept or merge").
  //@ ensures action === 'accept' || action === 'reject' || action === 'merge' || action === 'undo' ==> \result === mayDecide(role)
  // Only the Owner manages accounts; a role or action not listed is refused.
  //@ ensures action === 'manageAccounts' ==> \result === (role === 'owner')
  // Only the Owner marks Family roots (tree-model spec, "Family roots").
  //@ ensures action === 'markFamilyRoots' ==> \result === (role === 'owner')
  // Only the Owner switches scan reading on and sets its daily limit (scan-reading spec, "The Owner switches it on").
  //@ ensures action === 'manageSettings' ==> \result === (role === 'owner')
  //@ ensures \result ==> role === 'agent' || role === 'contributor' || role === 'editor' || role === 'owner'
  if (role === 'agent') return action === 'read' || action === 'propose';
  const member = role === 'contributor' || role === 'editor' || role === 'owner';
  if (action === 'read' || action === 'propose' || action === 'ownAccount') return member;
  if (action === 'review' || action === 'accept' || action === 'reject' || action === 'merge' || action === 'undo' || action === 'directEdit') {
    return mayDecide(role);
  }
  if (action === 'manageAccounts' || action === 'markFamilyRoots' || action === 'manageSettings') return role === 'owner';
  return false;
}

// ---------------------------------------------------------------- rate limits

/** The outcome of one request against a fixed window: the window after it, and when to retry if refused. */
export interface WindowDecision {
  allowed: boolean;
  /** Start of the window, as milliseconds since the epoch. */
  windowStart: number;
  /** Requests allowed in the window, this one included when allowed. */
  count: number;
  /** When refused: the end of the window, after which the request may be made again. */
  retryAt: number;
}

/**
 * The fixed-window limit (agent-access spec, "Rate limits"): a window opens with the first
 * request after the previous one ended and lasts `windowMs`; within it at most `limit` requests
 * are allowed. Each allowed request counts once and a refused one changes nothing, so the count
 * kept between requests (in PostgreSQL, the trust boundary together with the clock) is the
 * number allowed in the window, and one window never allows more than the limit. A refused
 * request learns the end of the window, which is later than now.
 */
export function fixedWindow(windowStart: number, count: number, limit: number, windowMs: number, now: number): WindowDecision {
  //@ verify
  //@ contract agent-access: Rate limits
  //@ requires limit > 0
  // One window never allows more than the limit.
  //@ ensures \result.allowed ==> \result.count <= limit
  // Scenario "Runaway agent": within the window, the request after the limit (the 61st Proposal within one hour) is refused ...
  //@ ensures now < windowStart + windowMs && count >= limit ==> !\result.allowed
  // ... with the time after which it may be made again: the end of the window, later than now.
  //@ ensures !\result.allowed ==> \result.retryAt === windowStart + windowMs && \result.retryAt > now
  // A refused request leaves the window as it was; an allowed one counts once.
  //@ ensures !\result.allowed ==> \result.windowStart === windowStart && \result.count === count
  //@ ensures \result.allowed && now < windowStart + windowMs ==> \result.windowStart === windowStart && \result.count === count + 1
  // Below the limit, a request within the window is allowed.
  //@ ensures now < windowStart + windowMs && count < limit ==> \result.allowed
  // Once the window is over, the next request opens a new one and is its first.
  //@ ensures now >= windowStart + windowMs ==> \result.allowed && \result.windowStart === now && \result.count === 1
  if (now >= windowStart + windowMs) return { allowed: true, windowStart: now, count: 1, retryAt: now };
  if (count < limit) return { allowed: true, windowStart, count: count + 1, retryAt: now };
  return { allowed: false, windowStart, count, retryAt: windowStart + windowMs };
}

// ---------------------------------------------------------------- evidence

/** Operations that bring a Citation into a Proposal. */
export function isCitationOperation(op: string): boolean {
  //@ verify
  return op === 'createCitation' || op === 'attachCitation';
}

/** Operations that change no facts and so need no evidence: merges, the server's undo steps, and marking Family roots. */
export function isFactFreeOperation(op: string): boolean {
  //@ verify
  return op === 'mergePersons' || op === 'restoreRecord' || op === 'setFamilyRoot';
}

/**
 * The evidence rule (proposals spec, "Evidence is required"): a Proposal includes at least one
 * Citation, created or attached. A Citation of a Family account Source is a Citation like any
 * other, so it counts. Proposals made only of merges and undo steps change no facts and are
 * exempt. An empty Proposal has no evidence.
 */
export function satisfiesEvidenceRule(ops: readonly string[]): boolean {
  //@ verify
  //@ contract proposals: Evidence is required
  // A Citation, created or attached, is evidence (one of a Family account Source like any other).
  //@ ensures exists(i: nat, i < ops.length && isCitationOperation(ops[i])) ==> \result
  // Scenario "Missing evidence": a Proposal that changes facts and has no Citation is refused.
  //@ ensures forall(i: nat, i < ops.length ==> !isCitationOperation(ops[i])) && exists(i: nat, i < ops.length && !isFactFreeOperation(ops[i])) ==> !\result
  // Merges and undo steps alone change no facts; an empty Proposal has no evidence.
  //@ ensures ops.length > 0 && forall(i: nat, i < ops.length ==> isFactFreeOperation(ops[i])) ==> \result
  //@ ensures ops.length === 0 ==> !\result
  if (ops.length === 0) return false;
  let factFree = true;
  for (const op of ops) {
    //@ invariant forall(j: nat, j < _op_idx ==> !isCitationOperation(ops[j]))
    //@ invariant factFree === forall(j: nat, j < _op_idx ==> isFactFreeOperation(ops[j]))
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

/**
 * The value of a field in a list of field values, or null when it is not there. LemmaScript
 * cannot model null as a value of `unknown`, so to the proofs this is an opaque function.
 */
//@ extern
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
export function detectConflict(
  baseVersion: number,
  currentVersion: number | null,
  proposed: readonly FieldValue[],
  current: readonly FieldValue[],
): ConflictResult | null {
  //@ verify
  //@ contract proposals: Proposals record what they were based on
  //@ contract review: Conflicts are resolved by the Editor
  // Based on the record as it is now: nothing to resolve.
  //@ ensures currentVersion !== null && currentVersion === baseVersion ==> \result === null
  // Scenario "Record changed in the meantime": changed since, or gone, means a conflict; nothing is overwritten silently.
  //@ ensures currentVersion !== null && currentVersion !== baseVersion ==> \result !== null
  //@ ensures currentVersion === null ==> \result !== null
  // The conflict records the version the Proposal was based on and the current one.
  //@ ensures \result !== null ==> \result.baseVersion === baseVersion && \result.currentVersion === currentVersion
  // Scenario "Two Proposals for the same date": every field the Proposal sets, with its value and the current value side by side.
  //@ ensures \result !== null && currentVersion !== null ==> \result.fields.length === proposed.length && forall(i: nat, i < proposed.length ==> \result.fields[i].field === proposed[i].field && \result.fields[i].proposed === proposed[i].value && \result.fields[i].current === valueOf(current, proposed[i].field))
  //@ ensures \result !== null && currentVersion === null ==> \result.fields.length === 0
  if (currentVersion !== null && currentVersion === baseVersion) return null;
  const fields: FieldConflictResult[] = [];
  if (currentVersion !== null) {
    for (const p of proposed) {
      //@ invariant fields.length === _p_idx
      //@ invariant forall(j: nat, j < _p_idx ==> fields[j].field === proposed[j].field && fields[j].proposed === proposed[j].value && fields[j].current === valueOf(current, proposed[j].field))
      fields.push({ field: p.field, proposed: p.value, current: valueOf(current, p.field) });
    }
  }
  return { baseVersion, currentVersion, fields };
}

// ---------------------------------------------------------------- undo

export interface RecordKey {
  table: string;
  id: string;
}

export function sameRecord(a: RecordKey, b: RecordKey): boolean {
  //@ verify
  return a.table === b.table && a.id === b.id;
}

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
// The predicates below name what the undo rule talks about. The code uses isDeletion,
// leavesDependent, blocksUndo, isLogged and hasProposal; the specifications also use
// isLeftBehind, isBlocking, isBlockingProposal and leavesUnlogged.

/** Whether the undo deletes this record. */
export function isDeletion(deletions: readonly RecordKey[], r: RecordKey): boolean {
  //@ verify
  return deletions.some((x) => sameRecord(x, r));
}

/** Whether a dependency is left behind: the undo deletes the record but not the one referring to it. */
export function leavesDependent(deletions: readonly RecordKey[], d: Dependency): boolean {
  //@ verify
  return isDeletion(deletions, d.of) && !isDeletion(deletions, d.dependent);
}

/** Whether a logged change to this record is by another Proposal that still stands. */
export function blocksUndo(t: LoggedTouch, r: RecordKey, undoneProposalId: string): boolean {
  //@ verify
  // A change by the undone Proposal itself, or by one already undone, never blocks.
  //@ ensures t.proposalId === undoneProposalId ==> !\result
  //@ ensures t.undone ==> !\result
  //@ ensures \result ==> sameRecord(t.record, r)
  return sameRecord(t.record, r) && t.proposalId !== undoneProposalId && !t.undone;
}

/** Whether a standing Proposal other than the undone one logged a change to this record. */
export function isLogged(touches: readonly LoggedTouch[], r: RecordKey, undoneProposalId: string): boolean {
  //@ verify
  return touches.some((t) => blocksUndo(t, r, undoneProposalId));
}

/** Whether the undo would leave this record behind, referring to a record it deletes. */
export function isLeftBehind(deletions: readonly RecordKey[], dependencies: readonly Dependency[], r: RecordKey): boolean {
  //@ verify
  return dependencies.some((d) => leavesDependent(deletions, d) && sameRecord(d.dependent, r));
}

/** Whether a logged change blocks the undo: a standing Proposal changed a record the undo would leave behind. */
export function isBlocking(t: LoggedTouch, undoneProposalId: string, deletions: readonly RecordKey[], dependencies: readonly Dependency[]): boolean {
  //@ verify
  return dependencies.some((d) => leavesDependent(deletions, d) && blocksUndo(t, d.dependent, undoneProposalId));
}

/** Whether a Proposal has a logged change that blocks the undo. */
export function isBlockingProposal(
  id: string,
  undoneProposalId: string,
  deletions: readonly RecordKey[],
  dependencies: readonly Dependency[],
  touches: readonly LoggedTouch[],
): boolean {
  //@ verify
  return touches.some((t) => t.proposalId === id && isBlocking(t, undoneProposalId, deletions, dependencies));
}

/** Whether the undo would leave behind a record that no standing Proposal logged. */
export function leavesUnlogged(
  undoneProposalId: string,
  deletions: readonly RecordKey[],
  dependencies: readonly Dependency[],
  touches: readonly LoggedTouch[],
): boolean {
  //@ verify
  return dependencies.some((d) => leavesDependent(deletions, d) && !isLogged(touches, d.dependent, undoneProposalId));
}

/** Whether a list of changes already has one by this Proposal. */
function hasProposal(found: readonly LoggedTouch[], id: string): boolean {
  //@ verify
  return found.some((f) => f.proposalId === id);
}

/** The records an undo would leave behind with a reference to one it deletes, in order. */
function leftBehind(deletions: readonly RecordKey[], dependencies: readonly Dependency[]): RecordKey[] {
  //@ verify
  //@ ensures forall(m: nat, m < \result.length ==> isLeftBehind(deletions, dependencies, \result[m]))
  //@ ensures forall(k: nat, k < dependencies.length && leavesDependent(deletions, dependencies[k]) ==> \result.includes(dependencies[k].dependent))
  const remaining: RecordKey[] = [];
  for (const d of dependencies) {
    //@ invariant forall(m: nat, m < remaining.length ==> isLeftBehind(deletions, dependencies, remaining[m]))
    //@ invariant forall(k: nat, k < _d_idx && leavesDependent(deletions, dependencies[k]) ==> remaining.includes(dependencies[k].dependent))
    if (leavesDependent(deletions, d)) remaining.push(d.dependent);
  }
  return remaining;
}

/** What the log says about the records left behind. */
interface LoggedBlockers {
  /** One logged change per standing Proposal that changed one of them, in log order. */
  readonly found: LoggedTouch[];
  /** True when one of them was changed by no standing Proposal. */
  readonly unlogged: boolean;
}

function loggedBlockers(
  undoneProposalId: string,
  deletions: readonly RecordKey[],
  dependencies: readonly Dependency[],
  remaining: readonly RecordKey[],
  touches: readonly LoggedTouch[],
): LoggedBlockers {
  //@ verify
  //@ requires forall(m: nat, m < remaining.length ==> isLeftBehind(deletions, dependencies, remaining[m]))
  //@ ensures forall(m: nat, m < \result.found.length ==> isBlocking(\result.found[m], undoneProposalId, deletions, dependencies) && touches.includes(\result.found[m]))
  //@ ensures forall(q: nat, forall(j: nat, q < remaining.length && j < touches.length && blocksUndo(touches[j], remaining[q], undoneProposalId) ==> hasProposal(\result.found, touches[j].proposalId)))
  //@ ensures forall(m: nat, forall(m2: nat, m < m2 && m2 < \result.found.length ==> \result.found[m].proposalId !== \result.found[m2].proposalId))
  //@ ensures forall(q: nat, q < remaining.length && !isLogged(touches, remaining[q], undoneProposalId) ==> \result.unlogged)
  //@ ensures \result.unlogged ==> leavesUnlogged(undoneProposalId, deletions, dependencies, touches)
  const found: LoggedTouch[] = [];
  let unlogged = false;
  for (const r of remaining) {
    //@ invariant forall(m: nat, m < found.length ==> isBlocking(found[m], undoneProposalId, deletions, dependencies) && touches.includes(found[m]))
    //@ invariant forall(q: nat, forall(j: nat, q < _r_idx && j < touches.length && blocksUndo(touches[j], remaining[q], undoneProposalId) ==> hasProposal(found, touches[j].proposalId)))
    //@ invariant forall(m: nat, forall(m2: nat, m < m2 && m2 < found.length ==> found[m].proposalId !== found[m2].proposalId))
    //@ invariant forall(q: nat, q < _r_idx && !isLogged(touches, remaining[q], undoneProposalId) ==> unlogged)
    //@ invariant unlogged ==> leavesUnlogged(undoneProposalId, deletions, dependencies, touches)
    for (const t of touches) {
      //@ invariant forall(m: nat, m < found.length ==> isBlocking(found[m], undoneProposalId, deletions, dependencies) && touches.includes(found[m]))
      //@ invariant forall(q: nat, forall(j: nat, q < _r_idx && j < touches.length && blocksUndo(touches[j], remaining[q], undoneProposalId) ==> hasProposal(found, touches[j].proposalId)))
      //@ invariant forall(j: nat, j < _t_idx && blocksUndo(touches[j], r, undoneProposalId) ==> hasProposal(found, touches[j].proposalId))
      //@ invariant forall(m: nat, forall(m2: nat, m < m2 && m2 < found.length ==> found[m].proposalId !== found[m2].proposalId))
      if (!blocksUndo(t, r, undoneProposalId)) continue;
      if (!hasProposal(found, t.proposalId)) found.push(t);
    }
    if (!isLogged(touches, r, undoneProposalId)) unlogged = true;
  }
  return { found, unlogged };
}

/** Newest first (insertion sort: the lists are short). */
function newestFirst(found: readonly LoggedTouch[]): LoggedTouch[] {
  //@ verify
  //@ requires forall(n: nat, forall(n2: nat, n < n2 && n2 < found.length ==> found[n].proposalId !== found[n2].proposalId))
  //@ ensures forall(m: nat, m < \result.length ==> found.includes(\result[m]))
  //@ ensures forall(n: nat, n < found.length ==> \result.includes(found[n]))
  //@ ensures forall(m: nat, forall(m2: nat, m < m2 && m2 < \result.length ==> \result[m].proposalId !== \result[m2].proposalId && \result[m].acceptedAt >= \result[m2].acceptedAt))
  let sorted: LoggedTouch[] = [];
  for (const next of found) {
    //@ invariant forall(m: nat, m < sorted.length ==> exists(n: nat, n < _next_idx && sorted[m] === found[n]))
    //@ invariant forall(n: nat, n < _next_idx ==> sorted.includes(found[n]))
    //@ invariant forall(m: nat, forall(m2: nat, m < m2 && m2 < sorted.length ==> sorted[m].proposalId !== sorted[m2].proposalId && sorted[m].acceptedAt >= sorted[m2].acceptedAt))
    let i = 0;
    while (i < sorted.length && sorted[i]!.acceptedAt >= next.acceptedAt) {
      //@ invariant 0 <= i && i <= sorted.length
      //@ invariant forall(m: nat, m < i ==> sorted[m].acceptedAt >= next.acceptedAt)
      //@ decreases sorted.length - i
      i += 1;
    }
    sorted = [...sorted.slice(0, i), next, ...sorted.slice(i)];
  }
  return sorted;
}

export function undoBlockers(
  undoneProposalId: string,
  deletions: readonly RecordKey[],
  dependencies: readonly Dependency[],
  touches: readonly LoggedTouch[],
): UndoBlockers {
  //@ verify
  //@ contract tree-history: Undo a whole Proposal
  // Complete: every standing later Proposal that changed a record the undo would leave behind is named.
  //@ ensures forall(j: nat, j < touches.length && isBlocking(touches[j], undoneProposalId, deletions, dependencies) ==> \result.blockedBy.includes(touches[j].proposalId))
  // Sound: only such Proposals are named, so never the undone one and never one already undone.
  //@ ensures forall(i: nat, i < \result.blockedBy.length ==> isBlockingProposal(\result.blockedBy[i], undoneProposalId, deletions, dependencies, touches))
  //@ ensures !\result.blockedBy.includes(undoneProposalId)
  // Each once.
  //@ ensures forall(i: nat, forall(i2: nat, i < i2 && i2 < \result.blockedBy.length ==> \result.blockedBy[i] !== \result.blockedBy[i2]))
  // A record left behind that no standing Proposal logged also blocks: deleting it would go unlogged.
  //@ ensures \result.unlogged === leavesUnlogged(undoneProposalId, deletions, dependencies, touches)
  // An undo that deletes nothing is never blocked.
  //@ ensures deletions.length === 0 ==> \result.blockedBy.length === 0 && !\result.unlogged
  const remaining = leftBehind(deletions, dependencies);
  const logged = loggedBlockers(undoneProposalId, deletions, dependencies, remaining, touches);
  const sorted = newestFirst(logged.found);
  const ids = sorted.map((t) => t.proposalId);
  return { blockedBy: ids, unlogged: logged.unlogged };
}
