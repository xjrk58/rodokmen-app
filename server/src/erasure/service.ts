import {
  afterReapplying,
  citationsLeft,
  exportedPersonLinks,
  isLiving,
  livingFactsFromEvents,
  mayErase,
  rewriteLog,
  theirRows,
  theirsAlone,
  toEraseAgain,
  type AttachedCitation,
  type ErasurePreview,
  type ErasureResult,
  type LogItem,
  type OwnedRow,
  type SharedRecord,
} from '@rodokmen/shared';
import { sql } from 'kysely';
import { ApiProblem } from '../auth/problem.js';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import type { Account } from '../db/types.js';
import { eraseFromLeads } from '../leads/erasure.js';
import type { ImageStorage } from '../storage/images.js';
import { displayName, eventSummaries, personSummaries } from '../tree/summaries.js';

/**
 * Erasure (erasure spec; ADR 0006): the Owner removes a Living person from the Tree, the log and
 * the Exports, at their request. The rules are pure and proved (shared/src/erasure.ts): who may
 * be erased, which Events, Citations, images and rows go, what the log becomes, and whom a restore
 * erases again. This module gathers their inputs and runs the deletes and updates in one
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

/** What erasing one Person removes. */
interface Plan {
  personId: string;
  /** The Person and any Persons merged into them (redirects, without data of their own). */
  personIds: string[];
  name: string;
  living: boolean;
  rows: OwnedRow[];
  events: string[];
  citations: string[];
  images: Array<{ id: string; storage_key: string; display_key: string | null }>;
  families: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Spaces and case do not matter in the confirmation. */
function normaliseName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('cs');
}

async function personName(db: Db, personId: string): Promise<string> {
  const n = await db.selectFrom('name').select(['given', 'surname']).where('person_id', '=', personId).where('is_primary', '=', true).executeTakeFirst();
  return n ? displayName(n.given, n.surname) : '';
}

async function livingNow(db: Db, personId: string, today: Date): Promise<boolean> {
  const events = await db
    .selectFrom('event_role as r')
    .innerJoin('event as e', 'e.id', 'r.event_id')
    .select(['e.type', 'r.role', 'e.date'])
    .where('r.person_id', '=', personId)
    .execute();
  return isLiving(livingFactsFromEvents(events), today);
}

/** Gathers what erasing the Person removes; the rules that choose are the proved ones. */
async function planErasure(db: Db, personId: string, today: Date): Promise<Plan> {
  const merged = await db.selectFrom('person').select('id').where('merged_into_id', '=', personId).execute();
  const personIds = [personId, ...merged.map((m) => m.id)];

  const owned: OwnedRow[] = [];
  const own = async (table: 'name' | 'event_role' | 'image_person' | 'person_label' | 'family_root') => {
    for (const r of await db.selectFrom(table).select(['id', 'person_id']).where('person_id', 'in', personIds).execute())
      owned.push({ table, id: r.id, personId: r.person_id });
  };
  await own('name');
  await own('event_role');
  await own('image_person');
  await own('person_label');
  await own('family_root');
  for (const r of await db.selectFrom('family_child').select(['id', 'child_id']).where('child_id', 'in', personIds).execute())
    owned.push({ table: 'family_child', id: r.id, personId: r.child_id });
  const rows = personIds.flatMap((id) => theirRows(owned, id));

  // Events: the Persons who have a Role in each Event the Person took part in.
  const roleEvents = [...new Set(rows.filter((r) => r.table === 'event_role').map((r) => r.id))];
  const eventIds = roleEvents.length
    ? [...new Set((await db.selectFrom('event_role').select('event_id').where('id', 'in', roleEvents).execute()).map((r) => r.event_id))]
    : [];
  const events = await shared(db, 'event_role', eventIds);
  const goneEvents = theirsAlone(events, personId).map((e) => e.id);

  // Families left with nobody: no partner and no child but the Person.
  const familyIds = [
    ...new Set([
      ...(
        await db
          .selectFrom('family')
          .select('id')
          .where((eb) => eb.or([eb('partner1_id', 'in', personIds), eb('partner2_id', 'in', personIds)]))
          .execute()
      ).map((f) => f.id),
      ...(await db.selectFrom('family_child').select('family_id').where('child_id', 'in', personIds).execute()).map((f) => f.family_id),
    ]),
  ];
  const families: SharedRecord[] = [];
  if (familyIds.length) {
    const fams = await db.selectFrom('family').select(['id', 'partner1_id', 'partner2_id']).where('id', 'in', familyIds).execute();
    const children = await db.selectFrom('family_child').select(['family_id', 'child_id']).where('family_id', 'in', familyIds).execute();
    for (const f of fams) {
      const persons = [f.partner1_id, f.partner2_id, ...children.filter((c) => c.family_id === f.id).map((c) => c.child_id)].filter(
        (p): p is string => p !== null,
      );
      families.push({ id: f.id, persons: persons.map((p) => (personIds.includes(p) ? personId : p)) });
    }
  }
  const goneFamilies = theirsAlone(families, personId).map((f) => f.id);

  // Citations attached only to Events and Names that go.
  const nameIds = rows.filter((r) => r.table === 'name').map((r) => r.id);
  const removed = [...goneEvents, ...nameIds];
  const candidateIds = removed.length
    ? [
        ...new Set([
          ...(goneEvents.length ? await db.selectFrom('event_citation').select('citation_id').where('event_id', 'in', goneEvents).execute() : []),
          ...(nameIds.length ? await db.selectFrom('name_citation').select('citation_id').where('name_id', 'in', nameIds).execute() : []),
        ]),
      ].map((c) => c.citation_id)
    : [];
  const candidates: AttachedCitation[] = [];
  if (candidateIds.length) {
    const onEvents = await db.selectFrom('event_citation').select(['citation_id', 'event_id']).where('citation_id', 'in', candidateIds).execute();
    const onNames = await db.selectFrom('name_citation').select(['citation_id', 'name_id']).where('citation_id', 'in', candidateIds).execute();
    for (const id of [...new Set(candidateIds)]) {
      candidates.push({
        id,
        attachedTo: [
          ...onEvents.filter((a) => a.citation_id === id).map((a) => a.event_id),
          ...onNames.filter((a) => a.citation_id === id).map((a) => a.name_id),
        ],
      });
    }
  }
  const goneCitations = citationsLeft(candidates, removed).map((c) => c.id);

  // Images that show only them, and the page images of the Citations that go.
  const shown = [...new Set(rows.filter((r) => r.table === 'image_person').map((r) => r.id))];
  const shownImageIds = shown.length
    ? [...new Set((await db.selectFrom('image_person').select('image_id').where('id', 'in', shown).execute()).map((r) => r.image_id))]
    : [];
  const subjects = await shared(db, 'image_person', shownImageIds);
  const imageIds = new Set(theirsAlone(subjects, personId).map((i) => i.id));
  if (goneCitations.length) for (const i of await db.selectFrom('image').select('id').where('citation_id', 'in', goneCitations).execute()) imageIds.add(i.id);
  const images = imageIds.size
    ? await db
        .selectFrom('image')
        .select(['id', 'storage_key', 'display_key'])
        .where('id', 'in', [...imageIds])
        .execute()
    : [];

  return {
    personId,
    personIds,
    name: await personName(db, personId),
    living: await livingNow(db, personId, today),
    rows,
    events: goneEvents,
    citations: goneCitations,
    images,
    families: goneFamilies,
  };
}

/** Records shared by Persons (Events through their Roles, images through their subjects), with those Persons. */
async function shared(db: Db, table: 'event_role' | 'image_person', ids: string[]): Promise<SharedRecord[]> {
  if (ids.length === 0) return [];
  const links =
    table === 'event_role'
      ? await db.selectFrom('event_role').select(['event_id as record', 'person_id']).where('event_id', 'in', ids).execute()
      : await db.selectFrom('image_person').select(['image_id as record', 'person_id']).where('image_id', 'in', ids).execute();
  return ids.map((id) => ({ id, persons: links.filter((l) => l.record === id).map((l) => l.person_id) }));
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

/** Every record id the erasure removes, for the log and the id maps. */
function erasedIds(plan: Plan): string[] {
  return [...new Set([...plan.personIds, ...plan.rows.map((r) => r.id), ...plan.events, ...plan.citations, ...plan.images.map((i) => i.id), ...plan.families])];
}

/** The ids that a logged snapshot mentions: every value of its columns that is an id. */
function snapshotIds(snapshot: Record<string, unknown> | null): string[] {
  if (snapshot === null) return [];
  return Object.values(snapshot).filter((v): v is string => typeof v === 'string' && UUID.test(v));
}

function marker(at: string): string {
  return JSON.stringify(Object.fromEntries(MARKER_KEYS.map((k) => [k, k === 'erased' ? true : at])));
}

/** Log changes that mention any of the ids, before or after, or are changes of one of them. */
async function mentioningChanges(db: Db, ids: string[]) {
  return db
    .selectFrom('log_change as c')
    .select(['c.id', 'c.log_entry_id', 'c.record_id', 'c.before', 'c.after'])
    .where((eb) =>
      eb.or([
        eb('c.record_id', 'in', ids),
        sql<boolean>`exists (select 1 from jsonb_each_text(coalesce(c.before, '{}'::jsonb)) kv where kv.value = any(${ids}::text[]))`,
        sql<boolean>`exists (select 1 from jsonb_each_text(coalesce(c.after, '{}'::jsonb)) kv where kv.value = any(${ids}::text[]))`,
      ]),
    )
    .orderBy('c.id')
    .execute();
}

/** Proposals whose operations, as written or as corrected, mention any of the ids anywhere. */
async function mentioningProposals(db: Db, ids: string[]): Promise<string[]> {
  const mentions = (column: 'operation' | 'corrected') =>
    sql<boolean>`exists (select 1 from jsonb_path_query(coalesce(o.${sql.ref(column)}, '{}'::jsonb), 'strict $.**') v where jsonb_typeof(v) = 'string' and v #>> '{}' = any(${ids}::text[]))`;
  const rows = await db
    .selectFrom('proposal_operation as o')
    .select('o.proposal_id')
    .distinct()
    .where((eb) => eb.or([eb('o.target_id', 'in', ids), mentions('operation'), mentions('corrected')]))
    .execute();
  return rows.map((r) => r.proposal_id);
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

async function findPerson(db: Db, personId: string, lock = false) {
  let q = db.selectFrom('person').select(['id', 'merged_into_id']).where('id', '=', personId);
  if (lock) q = q.forUpdate();
  const person = await q.executeTakeFirst();
  if (!person) throw new ApiProblem(404, 'not_found', 'No Person with this id.');
  if (person.merged_into_id)
    throw new ApiProblem(409, 'merged', 'This Person was merged into another; erase the Person it was merged into, and this one goes with them.');
  return person;
}

/** What erasing the Person would remove, for the Owner to read before confirming. */
export async function erasurePreview(deps: ErasureDeps, personId: string): Promise<ErasurePreview> {
  const { db, clock } = deps;
  await findPerson(db, personId);
  const plan = await planErasure(db, personId, clock.now());
  const summary = (await personSummaries(db, [personId], clock)).get(personId)!;
  const ids = erasedIds(plan);
  const changes = await mentioningChanges(db, ids);
  const viaLog = changes.length
    ? await db
        .selectFrom('log_entry')
        .select('proposal_id')
        .where('id', 'in', [...new Set(changes.map((c) => c.log_entry_id))])
        .execute()
    : [];
  const proposalIds = new Set([...viaLog.map((l) => l.proposal_id), ...(await mentioningProposals(db, ids))]);
  const pending = proposalIds.size
    ? await db
        .selectFrom('proposal')
        .select('id')
        .where('id', 'in', [...proposalIds])
        .where('status', '=', 'pending')
        .execute()
    : [];
  const leadIds = [...new Set((await db.selectFrom('lead_link').select('lead_id').where('person_id', 'in', plan.personIds).execute()).map((l) => l.lead_id))];
  let deleted = 0;
  for (const leadId of leadIds) {
    const links = await db.selectFrom('lead_link').select('person_id').where('lead_id', '=', leadId).where('person_id', 'is not', null).execute();
    if (!exportedPersonLinks(links.map((l) => ({ personId: l.person_id!, living: plan.personIds.includes(l.person_id!) }))).include) deleted += 1;
  }
  const count = (table: OwnedRow['table']) => plan.rows.filter((r) => r.table === table).length;
  return {
    person: summary,
    mayErase: plan.living,
    confirmWith: plan.name,
    names: count('name'),
    roles: count('event_role'),
    familyLinks: count('family_child') + (await partnerLinks(db, plan.personIds)),
    labels: count('person_label'),
    events: await eventSummaries(db, plan.events),
    citations: plan.citations.length,
    images: plan.images.length,
    families: plan.families.length,
    leads: { deleted, unlinked: leadIds.length - deleted },
    history: proposalIds.size,
    pending: pending.length,
  };
}

async function partnerLinks(db: Db, personIds: string[]): Promise<number> {
  const rows = await db
    .selectFrom('family')
    .select('id')
    .where((eb) => eb.or([eb('partner1_id', 'in', personIds), eb('partner2_id', 'in', personIds)]))
    .execute();
  return rows.length;
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
