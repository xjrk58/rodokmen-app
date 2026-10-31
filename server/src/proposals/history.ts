import {
  describeOperations,
  mayDo,
  undoBlockers,
  type Dependency,
  type HistoryEntry,
  type HistoryKind,
  type LaterEdit,
  type Operation,
  type ProposalView,
  type RestorableTable,
  type UndoBody,
} from '@rodokmen/shared';
import { isDeepStrictEqual } from 'node:util';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { ApiProblem } from '../auth/problem.js';
import type { Db } from '../db/db.js';
import type { Account } from '../db/types.js';
import { idsIn, labelsFor } from './labels.js';
import { dependentsOf, restorableColumns, snapshot, type Snapshot } from './records.js';
import { acceptInTransaction, finishMoves, insertProposal, transaction, type ProposalDeps } from './service.js';
import { authorRef, loadOperationsOf, proposalViews } from './views.js';

// ---------------------------------------------------------------- record history

/** Snapshot columns that point at a record of each kind, besides its own id. */
const REFERENCES: Record<HistoryKind, string[]> = {
  person: ['person_id', 'child_id', 'partner1_id', 'partner2_id', 'merged_into_id', 'account_given_by_person_id'],
  name: ['name_id'],
  family: ['family_id'],
  event: ['event_id'],
  source: ['source_id'],
  citation: ['citation_id'],
};

/**
 * Every accepted change to a record, newest first (tree-history spec, "History of a record"):
 * changes to the record itself and to records that belong to it (a Person's Names, Roles and
 * Family links; an Event's Roles and Citations).
 */
export async function recordHistory(db: Db, kind: HistoryKind, id: string): Promise<HistoryEntry[]> {
  const doc = (column: string) => sql<boolean>`(coalesce(before, '{}'::jsonb) || coalesce(after, '{}'::jsonb)) @> ${JSON.stringify({ [column]: id })}::jsonb`;
  const changes = await db
    .selectFrom('log_change')
    .selectAll()
    .where((eb) => eb.or([eb('record_id', '=', id), ...REFERENCES[kind].map((c) => doc(c))]))
    .orderBy('log_entry_id')
    .orderBy('seq')
    .execute();
  if (changes.length === 0) return [];
  const entryIds = [...new Set(changes.map((c) => c.log_entry_id))];
  const entries = await db
    .selectFrom('log_entry as l')
    .innerJoin('proposal as p', 'p.id', 'l.proposal_id')
    .select([
      'l.id',
      'l.proposal_id',
      'l.kind',
      'l.author_id',
      'l.accepted_by',
      'l.accepted_at',
      'l.citation_ids',
      'p.note',
      'p.decision_note',
      'p.undone_by_proposal_id',
    ])
    .where('l.id', 'in', entryIds)
    .orderBy('l.accepted_at', 'desc')
    .orderBy('l.id', 'desc')
    .execute();
  const accountIds = [...new Set(entries.flatMap((e) => [e.author_id, e.accepted_by]))];
  const accounts = new Map(
    (await db.selectFrom('account').select(['id', 'display_name', 'role']).where('id', 'in', accountIds).execute()).map((a) => [a.id, a]),
  );
  const citationIds = [...new Set(entries.flatMap((e) => e.citation_ids))];
  const citations = new Map(
    citationIds.length
      ? (
          await db
            .selectFrom('citation as c')
            .innerJoin('source as s', 's.id', 'c.source_id')
            .select(['c.id', 'c.page', 's.title'])
            .where('c.id', 'in', citationIds)
            .execute()
        ).map((c) => [c.id, c])
      : [],
  );

  const storedOf = await loadOperationsOf(
    db,
    entries.map((e) => e.proposal_id),
  );
  const labels = await labelsFor(db, idsIn([...storedOf.values()].flat().map((s) => [s.original, s.corrected])));
  const out: HistoryEntry[] = [];
  for (const e of entries) {
    const stored = storedOf.get(e.proposal_id) ?? [];
    const effective = describeOperations(
      stored.map((s) => s.effective),
      labels,
    );
    const original = describeOperations(
      stored.map((s) => s.original),
      labels,
    );
    out.push({
      proposalId: e.proposal_id,
      kind: e.kind,
      author: authorRef(accounts.get(e.author_id)!),
      acceptedBy: authorRef(accounts.get(e.accepted_by)!),
      acceptedAt: new Date(e.accepted_at).toISOString(),
      note: e.note,
      decisionNote: e.decision_note,
      citations: e.citation_ids.flatMap((c) => {
        const found = citations.get(c);
        return found ? [{ id: c, sourceTitle: found.title, page: found.page }] : [];
      }),
      summaries: effective,
      corrections: stored
        .filter((s) => s.corrected && s.correctedBy)
        .map((s) => ({
          position: s.position,
          by: authorRef(accounts.get(s.correctedBy!) ?? { id: s.correctedBy!, display_name: '?', role: 'editor' }),
          summary: effective[s.position]!,
          original: original[s.position]!,
        })),
      changes: changes.filter((c) => c.log_entry_id === e.id).map((c) => ({ table: c.record_table, id: c.record_id, before: c.before, after: c.after })),
      undoneBy: e.undone_by_proposal_id,
    });
  }
  // Correctors who are not author or acceptor.
  const missing = out.flatMap((h) => h.corrections.filter((c) => c.by.displayName === '?').map((c) => c.by.id));
  if (missing.length) {
    const more = new Map(
      (await db.selectFrom('account').select(['id', 'display_name', 'role']).where('id', 'in', missing).execute()).map((a) => [a.id, authorRef(a)]),
    );
    for (const h of out) for (const c of h.corrections) if (more.has(c.by.id)) c.by = more.get(c.by.id)!;
  }
  return out;
}

// ---------------------------------------------------------------- undo

interface LoggedChange {
  seq: number;
  table: RestorableTable;
  id: string;
  before: Snapshot | null;
  after: Snapshot | null;
}

async function loggedChanges(db: Db, proposalId: string): Promise<LoggedChange[]> {
  const entry = await db.selectFrom('log_entry').select('id').where('proposal_id', '=', proposalId).executeTakeFirst();
  if (!entry) throw new ApiProblem(409, 'not_accepted', 'Only an accepted Proposal can be undone.');
  const rows = await db.selectFrom('log_change').selectAll().where('log_entry_id', '=', entry.id).orderBy('seq').execute();
  return rows.map((r) => ({ seq: r.seq, table: r.record_table, id: r.record_id, before: r.before, after: r.after }));
}

/** What undoing involves, for the Editor before choosing: later edits, and Proposals that block it. */
export async function undoPreview(db: Db, proposalId: string): Promise<{ laterEdits: LaterEdit[]; blockedBy: string[] }> {
  const { changes, edits, current } = await laterEdits(db, proposalId);
  const deletions = changes.filter((c) => c.before === null && current.get(`${c.table}:${c.id}`)).map((c) => ({ table: c.table, id: c.id }));
  return { laterEdits: edits, blockedBy: await blockingProposals(db, proposalId, deletions) };
}

/** Records changed again after the Proposal, field by field (tree-history spec, "Undo after later edits"). */
export async function laterEdits(
  db: Db,
  proposalId: string,
  lock = false,
): Promise<{ changes: LoggedChange[]; edits: LaterEdit[]; current: Map<string, Snapshot | null> }> {
  const changes = await loggedChanges(db, proposalId);
  const labels = await labelsFor(db, changes.map((c) => c.id).concat(idsIn(changes.map((c) => [c.before?.person_id, c.after?.person_id]))));
  const edits: LaterEdit[] = [];
  const current = new Map<string, Snapshot | null>();
  for (const c of changes) {
    const now = await snapshot(db, c.table, c.id, lock);
    current.set(`${c.table}:${c.id}`, now);
    if (c.after === null) continue; // deleted by the Proposal: the undo brings it back
    const label = { cs: labels.label(c.id, 'cs'), en: labels.label(c.id, 'en') };
    if (now === null) {
      if (c.before !== null) edits.push({ table: c.table, id: c.id, label, recordLevel: true, fields: [] });
      continue;
    }
    if (now.version === c.after.version) continue;
    const columns = await restorableColumns(db, c.table);
    const fields = columns
      .filter((col) => !isDeepStrictEqual(now[col] ?? null, c.after![col] ?? null))
      .map((col) => ({ field: col, before: c.before?.[col] ?? null, after: c.after![col] ?? null, current: now[col] ?? null }));
    if (fields.length === 0) continue;
    edits.push({ table: c.table, id: c.id, label, recordLevel: c.before === null, fields });
  }
  return { changes, edits, current };
}

/**
 * Later accepted Proposals that attach records to ones this undo would delete (a Name or Role
 * added to a Person the undone Proposal created, a child linked to its Family …), newest first.
 * Deleting would cascade into them unseen, so the Editor undoes those first.
 */
export async function blockingProposals(db: Db, proposalId: string, deletions: ReadonlyArray<{ table: RestorableTable; id: string }>): Promise<string[]> {
  // Gather the inputs; the rule itself is undoBlockers (shared/src/rules.ts).
  const dependencies: Dependency[] = [];
  for (const d of deletions) for (const dep of await dependentsOf(db, d.table, d.id)) dependencies.push({ of: d, dependent: dep });
  if (dependencies.length === 0) return [];
  const touches = await db
    .selectFrom('log_change as c')
    .innerJoin('log_entry as l', 'l.id', 'c.log_entry_id')
    .innerJoin('proposal as p', 'p.id', 'l.proposal_id')
    .select(['p.id', 'l.accepted_at', 'c.record_table', 'c.record_id', 'p.undone_by_proposal_id'])
    .where(
      'c.record_id',
      'in',
      dependencies.map((d) => d.dependent.id),
    )
    .execute();
  const result = undoBlockers(
    proposalId,
    deletions,
    dependencies,
    touches.map((t) => ({
      proposalId: t.id,
      acceptedAt: new Date(t.accepted_at).getTime(),
      record: { table: t.record_table, id: t.record_id },
      undone: t.undone_by_proposal_id !== null,
    })),
  );
  // Records attached outside any logged Proposal still block: deleting them would go unlogged.
  return result.unlogged && result.blockedBy.length === 0 ? ['(records not in the log)'] : result.blockedBy;
}

function blockedProblem(blockedBy: string[]): ApiProblem {
  return new ApiProblem(
    409,
    'undo_blocked_by_dependents',
    `Later accepted Proposals attach records to ones this undo would remove. Undo them first, newest first: ${blockedBy.join(', ')}.`,
  );
}

/**
 * The inverse operations of an accepted Proposal, newest change first, from its logged
 * before-snapshots. Records edited again since need the Editor's choice: per record for those
 * the undo would remove, per field otherwise; without it the undo is refused with 409.
 */
async function undoOperations(tx: Db, logged: Awaited<ReturnType<typeof laterEdits>>, body: UndoBody): Promise<Operation[]> {
  const { changes, edits, current } = logged;
  const ops: Operation[] = [];
  for (const c of [...changes].reverse()) {
    const cur = current.get(`${c.table}:${c.id}`) ?? null;
    const restore = (fields?: string[]): Operation => ({
      op: 'restoreRecord',
      table: c.table,
      id: c.id,
      baseVersion: cur?.version ?? null,
      values: c.before,
      ...(fields ? { fields } : {}),
    });
    const edit = edits.find((e) => e.table === c.table && e.id === c.id);
    const chosen = body.choices.find((x) => x.table === c.table && x.id === c.id);
    if (!edit) {
      if (c.before !== null || cur !== null) ops.push(restore());
    } else if (edit.recordLevel) {
      if (chosen?.keep === undefined)
        throw new ApiProblem(409, 'later_edits', `${edit.label.en} was changed after this Proposal. Choose whether to keep it before undoing.`);
      if (!chosen.keep) ops.push(restore());
    } else {
      const undecided = edit.fields.filter((f) => !chosen?.fields[f.field]).map((f) => f.field);
      if (undecided.length)
        throw new ApiProblem(
          409,
          'later_edits',
          `${edit.label.en} was changed after this Proposal (${undecided.join(', ')}). Choose per field before undoing.`,
        );
      const kept = new Set(edit.fields.filter((f) => chosen?.fields[f.field] === 'keep').map((f) => f.field));
      const columns = (await restorableColumns(tx, c.table)).filter((col) => !kept.has(col));
      if (columns.length > 0) ops.push(restore(columns));
    }
  }
  return ops;
}

/**
 * Whether undoing would mark or unmark a Family root, which only the Owner does (tree-model spec,
 * "Family roots"): the Proposal changed a Family root, and not by merging two Persons (a merge
 * keeps the root, on the kept Person, and its undo puts it back where it was).
 */
async function changesFamilyRoots(db: Db, proposalId: string, changes: readonly LoggedChange[]): Promise<boolean> {
  if (!changes.some((c) => c.table === 'family_root')) return false;
  const ops = await db.selectFrom('proposal_operation').select('op').where('proposal_id', '=', proposalId).execute();
  return !ops.some((o) => o.op === 'mergePersons');
}

/**
 * Undoes an accepted Proposal as a whole: the inverse operations come from the logged
 * before-snapshots and are applied at once as a new, logged Proposal of kind "undo". Records
 * edited again since need the Editor's choice per field (or, for records the undo would
 * remove, per record); without it the undo is refused with 409.
 */
export async function undoProposal(deps: ProposalDeps, editor: Account, proposalId: string, body: UndoBody): Promise<ProposalView> {
  const now = deps.clock.now();
  const result = await transaction(
    deps.db,
    async (tx) => {
      const original = await tx.selectFrom('proposal').selectAll().where('id', '=', proposalId).forUpdate().executeTakeFirst();
      if (!original) throw new ApiProblem(404, 'not_found', 'No Proposal with this id.');
      if (original.status !== 'accepted') throw new ApiProblem(409, 'not_accepted', 'Only an accepted Proposal can be undone.');
      if (original.undone_by_proposal_id) throw new ApiProblem(409, 'already_undone', 'This Proposal was already undone.');
      const logged = await laterEdits(tx, proposalId, true);
      if (!mayDo(editor.role, 'markFamilyRoots') && (await changesFamilyRoots(tx, proposalId, logged.changes)))
        throw new ApiProblem(403, 'forbidden', 'Only the Owner marks Family roots, so only the Owner can undo this.');
      const ops = await undoOperations(tx, logged, body);
      if (ops.length === 0) throw new ApiProblem(409, 'nothing_to_undo', 'Every change of this Proposal is kept; there is nothing to undo.');
      const deletions = ops.flatMap((o) => (o.op === 'restoreRecord' && o.values === null ? [{ table: o.table, id: o.id }] : []));
      const blockedBy = await blockingProposals(tx, proposalId, deletions);
      if (blockedBy.length) throw blockedProblem(blockedBy);

      const created = await insertProposal(
        tx,
        now,
        editor,
        { kind: 'undo', note: body.note, idempotencyKey: `undo-${proposalId}-${uuidv7()}`, undoes: proposalId },
        ops,
      );
      const accepted = await acceptInTransaction(tx, deps, created.proposal, editor, { note: null, corrections: [], resolutions: [] });
      await tx.updateTable('proposal').set({ undone_by_proposal_id: accepted.proposal.id }).where('id', '=', proposalId).execute();
      // Undoing an undo puts the Proposal it undid back in force, so that one can be undone again.
      if (original.kind === 'undo' && original.undoes_proposal_id) {
        await tx.updateTable('proposal').set({ undone_by_proposal_id: null }).where('id', '=', original.undoes_proposal_id).execute();
      }
      return accepted;
    },
    deps,
  );
  await finishMoves(deps, result.moves);
  return (await proposalViews(deps.db, [result.proposal]))[0]!;
}
