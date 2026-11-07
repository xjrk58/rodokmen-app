import { afterReapplying, mayErase, rewriteLog, toEraseAgain, type ErasureResult, type LogItem } from '@rodokmen/shared';
import { sql } from 'kysely';
import { ApiProblem } from '../auth/problem.js';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import type { Account } from '../db/types.js';
import { eraseFromLeads } from '../leads/erasure.js';
import type { ImageStorage } from '../storage/images.js';
import { erasedIds, findPerson, mentioningChanges, mentioningProposals, planErasure, UUID, type Plan } from './plan.js';

/**
 * Erasure (erasure spec; ADR 0006): the Owner removes a Living person from the Tree, the log and
 * the Exports, at their request. The rules are pure and proved (shared/src/erasure.ts): who may
 * be erased, which Events, Citations, images and rows go, what the log becomes, and whom a restore
 * erases again. plan.ts gathers their inputs; this module runs the deletes and updates in one
 * transaction; server/test/erasure.test.ts covers it.
 */

export interface ErasureDeps {
  db: Db;
  clock: Clock;
  images: ImageStorage;
  log?: (msg: string, error?: unknown) => void;
}

/** The text a log entry or a Proposal becomes when it involved an erased Person. */
const MARKER_KEYS = ['erased', 'at'] as const;

/** Spaces and case do not matter in the confirmation. */
function normaliseName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('cs');
}

/** Every id anywhere in a stored operation (its targets, its references, the Persons of an image …). */
function idsInJson(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (UUID.test(value)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) idsInJson(v, out);
  } else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) idsInJson(v, out);
  }
  return out;
}

/** The ids that a logged snapshot mentions: every value of its columns that is an id. */
function snapshotIds(snapshot: Record<string, unknown> | null): string[] {
  if (snapshot === null) return [];
  return Object.values(snapshot).filter((v): v is string => typeof v === 'string' && UUID.test(v));
}

function marker(at: string): string {
  return JSON.stringify(Object.fromEntries(MARKER_KEYS.map((k) => [k, k === 'erased' ? true : at])));
}

/**
 * The log after the erasure (erasure spec, "Erasure reaches the log"; rewriteLog, proved): every
 * change that mentions an erased record becomes the marker `{ erased: true, at }`, keeping only
 * the ids of the records that stay which it pointed at, so that their history still lists it.
 * Every Proposal whose entry involved the erased Person, or whose operations name them, loses its
 * notes, reader marks and operations and shows "erased record"; a pending one is closed.
 */
async function rewriteHistory(tx: Db, ids: string[], at: Date, ownerId: string | null): Promise<number> {
  const atIso = at.toISOString();
  const changes = await mentioningChanges(tx, ids);
  const items: LogItem[] = changes.map((c) => ({
    id: String(c.id),
    mentions: [c.record_id, ...snapshotIds(c.before), ...snapshotIds(c.after)],
    data: JSON.stringify({ before: c.before, after: c.after }),
    erased: false,
    at: '',
  }));
  const rewritten = rewriteLog(items, ids, atIso);
  const erasedEntries = new Set<string>();
  for (const [i, item] of rewritten.entries()) {
    if (!item.erased) continue;
    const c = changes[i]!;
    erasedEntries.add(c.log_entry_id);
    const refs = [...new Set([c.record_id, ...snapshotIds(c.before), ...snapshotIds(c.after)])].filter((id) => !ids.includes(id));
    await tx
      .updateTable('log_change')
      .set({ before: marker(item.at), after: marker(item.at), erased_refs: refs })
      .where('id', '=', c.id)
      .execute();
  }

  // The Proposals behind those entries, and any whose operations name an erased record, with the
  // ids each mentions: in its logged changes, and anywhere in its operations.
  const mentions = new Map<string, string[]>();
  const mention = (proposalId: string, found: readonly string[]) => mentions.set(proposalId, [...(mentions.get(proposalId) ?? []), ...found]);
  const entries = erasedEntries.size
    ? await tx
        .selectFrom('log_entry')
        .select(['id', 'proposal_id'])
        .where('id', 'in', [...erasedEntries])
        .execute()
    : [];
  const proposalOf = new Map(entries.map((e) => [e.id, e.proposal_id]));
  for (const [i, c] of changes.entries()) {
    const proposalId = proposalOf.get(c.log_entry_id);
    if (proposalId) mention(proposalId, items[i]!.mentions);
  }
  const viaOps = await mentioningProposals(tx, ids);
  if (viaOps.length)
    for (const o of await tx
      .selectFrom('proposal_operation')
      .select(['proposal_id', 'target_id', 'operation', 'corrected'])
      .where('proposal_id', 'in', viaOps)
      .execute())
      mention(o.proposal_id, [...(o.target_id ? [o.target_id] : []), ...idsInJson(o.operation), ...idsInJson(o.corrected)]);
  const proposals = rewriteLog(
    [...mentions].map(([id, found]) => ({ id, mentions: found, data: id, erased: false, at: '' })),
    ids,
    atIso,
  );
  for (const p of proposals) {
    if (!p.erased) continue;
    await tx.deleteFrom('proposal_operation').where('proposal_id', '=', p.id).execute();
    await tx.updateTable('proposal').set({ note: null, decision_note: null, reader: null, erased_at: at }).where('id', '=', p.id).execute();
    await tx
      .updateTable('proposal')
      .set({ status: 'rejected', decided_at: at, decided_by: ownerId })
      .where('id', '=', p.id)
      .where('status', '=', 'pending')
      .execute();
  }
  return proposals.filter((p) => p.erased).length;
}

/** Runs one erasure in the transaction: leads, history, id maps, then the records themselves. */
async function applyErasure(tx: Db, plan: Plan, at: Date, ownerId: string | null): Promise<number> {
  await sql`set local rdk.erasure = 'on'`.execute(tx);
  for (const id of plan.personIds) await eraseFromLeads(tx, id);
  const ids = erasedIds(plan);
  const history = await rewriteHistory(tx, ids, at, ownerId);

  // A Family account the Person gave keeps the account, not their name.
  await tx.updateTable('source').set({ account_given_by: 'erased record' }).where('account_given_by_person_id', 'in', plan.personIds).execute();
  await tx.deleteFrom('vault_import_map').where('record_id', 'in', ids).execute();
  await tx.deleteFrom('proposal_temp').where('record_id', 'in', ids).execute();
  await tx.deleteFrom('export_slug').where('record_id', 'in', ids).execute();

  if (plan.images.length)
    await tx
      .deleteFrom('image')
      .where(
        'id',
        'in',
        plan.images.map((i) => i.id),
      )
      .execute();
  if (plan.citations.length) await tx.deleteFrom('citation').where('id', 'in', plan.citations).execute();
  if (plan.events.length) await tx.deleteFrom('event').where('id', 'in', plan.events).execute();
  if (plan.families.length) await tx.deleteFrom('family').where('id', 'in', plan.families).execute();
  // Persons merged into them point at them: they go first.
  const redirects = plan.personIds.filter((id) => id !== plan.personId);
  if (redirects.length) await tx.deleteFrom('person').where('id', 'in', redirects).execute();
  await tx.deleteFrom('person').where('id', '=', plan.personId).execute();

  await tx
    .insertInto('erasure')
    .values(plan.personIds.map((person_id) => ({ person_id, erased_at: at })))
    .onConflict((oc) => oc.column('person_id').doUpdateSet({ export_replaced_at: null }))
    .execute();
  return history;
}

/** After commit: the files of the images that went. */
async function deleteFiles(deps: ErasureDeps, plan: Plan): Promise<void> {
  for (const image of plan.images) {
    for (const key of [image.storage_key, image.display_key]) {
      if (key) await deps.images.delete(key).catch((e: unknown) => deps.log?.(`could not delete the file ${key} of an erased image`, e));
    }
  }
}

/**
 * Erases a Living person (erasure spec, "Owner erases a Living person"), in one transaction:
 * refused unless they are Living and the confirmation names them (mayErase, proved).
 */
export async function erasePerson(deps: ErasureDeps, owner: Account, personId: string, confirmation: string): Promise<ErasureResult> {
  const at = deps.clock.now();
  const { plan, history } = await deps.db.transaction().execute(async (tx) => {
    await findPerson(tx, personId, true);
    const plan = await planErasure(tx, personId, at);
    if (!plan.living)
      throw new ApiProblem(
        409,
        'not_living',
        'Only Living people can be erased. This Person is not Living: a death or burial is recorded, or they were born more than 100 years ago.',
      );
    if (!mayErase(plan.living, normaliseName(confirmation), normaliseName(plan.name)))
      throw new ApiProblem(400, 'confirmation_mismatch', `To confirm, type the Person's name exactly as shown: ${plan.name}.`);
    return { plan, history: await applyErasure(tx, plan, at, owner.id) };
  });
  await deleteFiles(deps, plan);
  return {
    personId,
    erasedAt: at.toISOString(),
    events: plan.events.length,
    citations: plan.citations.length,
    images: plan.images.length,
    history,
  };
}

/**
 * Erases again every Person on the list of erasures that the database still holds (erasure spec,
 * "Restores keep erased people erased"; toEraseAgain, proved). Run before the API accepts any
 * request, and by the restore procedure after it merged the newest list in. Returns whom it erased.
 */
export async function reapplyErasures(deps: ErasureDeps): Promise<string[]> {
  const listed = (await deps.db.selectFrom('erasure').select('person_id').execute()).map((e) => e.person_id);
  if (listed.length === 0) return [];
  const before = (await deps.db.selectFrom('person').select('id').execute()).map((p) => p.id);
  const again = toEraseAgain(before, listed);
  for (const personId of again) {
    const plan = await deps.db.transaction().execute(async (tx) => {
      const exists = await tx.selectFrom('person').select('id').where('id', '=', personId).forUpdate().executeTakeFirst();
      if (!exists) return null; // gone with a Person it was merged into
      const plan = await planErasure(tx, personId, deps.clock.now());
      await applyErasure(tx, plan, deps.clock.now(), null);
      return plan;
    });
    if (plan) await deleteFiles(deps, plan);
  }
  // Check: nobody on the list remains, and nobody else went.
  const after = new Set((await deps.db.selectFrom('person').select('id').execute()).map((p) => p.id));
  const expected = afterReapplying(before, listed);
  const extra = [...after].filter((id) => listed.includes(id));
  if (extra.length || expected.length !== after.size || expected.some((id) => !after.has(id)))
    throw new Error(`reapplying the erasures left ${extra.length} erased Persons, or removed others`);
  return again;
}

/** Adds erased ids from a list (one per line: the id, then optionally a tab and when), for a restore of an older Backup. */
export async function importErasures(db: Db, text: string, now: Date): Promise<number> {
  const rows = text
    .split('\n')
    .map((line) => line.trim().split('\t'))
    .filter(([id]) => id !== undefined && UUID.test(id))
    .map(([id, when]) => ({ person_id: id!.toLowerCase(), erased_at: when && !Number.isNaN(Date.parse(when)) ? new Date(when) : now }));
  if (rows.length === 0) return 0;
  const inserted = await db
    .insertInto('erasure')
    .values(rows)
    .onConflict((oc) => oc.column('person_id').doNothing())
    .executeTakeFirst();
  return Number(inserted.numInsertedOrUpdatedRows ?? 0);
}
