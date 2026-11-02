import { isTempId, type Operation } from '@rodokmen/shared';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { ApiProblem } from '../auth/problem.js';
import { stringField } from '../errors.js';
import type { Db } from '../db/db.js';
import { dateColumns } from '../tree/dates.js';
import { checkBase, ConflictProblem, ref, type ApplyResult, type Ctx, type Op } from './apply-context.js';
import { applyPlaceOrNote } from './apply-places.js';
import { RECORD_TABLES, registerColumns, setFieldColumns } from './columns.js';
import { ChangeSet, legacyName, snapshot, trackedRows } from './records.js';

export { ConflictProblem, type ApplyResult, type UploadMove } from './apply-context.js';
export { columnOf, fieldOf, FIELD_COLUMNS, point, RECORD_TABLES, registerColumns, registerOf, setFieldColumns } from './columns.js';

async function nextSort(db: Db, name: 'name' | 'event_role' | 'family_child', column: 'person_id' | 'event_id' | 'family_id', id: string): Promise<number> {
  const { rows } = await sql<{ n: number }>`select coalesce(max(sort_order) + 1, 0)::int as n from ${sql.table(name)} where ${sql.ref(column)} = ${id}`.execute(
    db,
  );
  return rows[0]?.n ?? 0;
}

async function merge(ctx: Ctx, position: number, op: Extract<Operation, { op: 'mergePersons' }>) {
  const { db, rows } = ctx;
  await checkBase(ctx, position, 'person', op.keepId, op.keepBaseVersion, 'the Person to keep');
  await checkBase(ctx, position, 'person', op.mergeId, op.mergeBaseVersion, 'the Person to merge');
  const keep = op.keepId;
  const gone = op.mergeId;

  let order = await nextSort(db, 'name', 'person_id', keep);
  for (const n of await db.selectFrom('name').select('id').where('person_id', '=', gone).orderBy('is_primary', 'desc').orderBy('sort_order').execute()) {
    await rows.update('name', n.id, { person_id: keep, is_primary: false, sort_order: order++ });
  }
  for (const r of await db.selectFrom('event_role').select(['id', 'event_id', 'role']).where('person_id', '=', gone).execute()) {
    const twin = await db
      .selectFrom('event_role')
      .select('id')
      .where('event_id', '=', r.event_id)
      .where('person_id', '=', keep)
      .where('role', '=', r.role)
      .executeTakeFirst();
    if (twin) await rows.remove('event_role', r.id);
    else await rows.update('event_role', r.id, { person_id: keep });
  }
  for (const f of await db
    .selectFrom('family')
    .selectAll()
    .where((eb) => eb.or([eb('partner1_id', '=', gone), eb('partner2_id', '=', gone)]))
    .execute()) {
    if (f.partner1_id === keep || f.partner2_id === keep)
      throw new ApiProblem(409, 'merge_partners', 'These two Persons are partners in one Family, so they cannot be the same Person.');
    await rows.update('family', f.id, f.partner1_id === gone ? { partner1_id: keep } : { partner2_id: keep });
  }
  for (const l of await db.selectFrom('family_child').select(['id', 'family_id']).where('child_id', '=', gone).execute()) {
    const twin = await db.selectFrom('family_child').select('id').where('family_id', '=', l.family_id).where('child_id', '=', keep).executeTakeFirst();
    if (twin) await rows.remove('family_child', l.id);
    else await rows.update('family_child', l.id, { child_id: keep });
  }
  for (const i of await db.selectFrom('image_person').select(['id', 'image_id']).where('person_id', '=', gone).execute()) {
    const twin = await db.selectFrom('image_person').select('id').where('image_id', '=', i.image_id).where('person_id', '=', keep).executeTakeFirst();
    if (twin) await rows.remove('image_person', i.id);
    else await rows.update('image_person', i.id, { person_id: keep });
  }
  for (const s of await db.selectFrom('source').select('id').where('account_given_by_person_id', '=', gone).execute()) {
    await rows.update('source', s.id, { account_given_by_person_id: keep });
  }
  // Labels move to the kept Person; one it carries already is not doubled (tree-model spec, "Labels on Persons").
  for (const l of await db.selectFrom('person_label').select(['id', 'folded']).where('person_id', '=', gone).execute()) {
    const twin = await db.selectFrom('person_label').select('id').where('person_id', '=', keep).where('folded', '=', l.folded).executeTakeFirst();
    if (twin) await rows.remove('person_label', l.id);
    else await rows.update('person_label', l.id, { person_id: keep });
  }
  // A Family root stays one: the kept Person is a root when either was (tree-model spec, "Family roots").
  const goneRoot = await db.selectFrom('family_root').select('id').where('person_id', '=', gone).executeTakeFirst();
  if (goneRoot) {
    const keepRoot = await db.selectFrom('family_root').select('id').where('person_id', '=', keep).executeTakeFirst();
    if (keepRoot) await rows.remove('family_root', goneRoot.id);
    else await rows.update('family_root', goneRoot.id, { person_id: keep });
  }
  // Earlier merges into the merged Person now point at the kept one, so links never chain.
  for (const p of await db.selectFrom('person').select('id').where('merged_into_id', '=', gone).execute()) {
    await rows.update('person', p.id, { merged_into_id: keep });
  }
  await rows.update('person', gone, { merged_into_id: keep });
}

async function createPerson(ctx: Ctx, op: Op<'createPerson'>) {
  const p = await ctx.rows.insert('person', { sex: op.sex });
  await ctx.rows.insert('name', {
    person_id: p.id,
    given: op.name.given,
    surname: op.name.surname,
    type: op.name.type,
    language: op.name.language,
    as_found: op.name.asFound,
    is_primary: true,
    sort_order: 0,
  });
  ctx.temps.set(op.tempId, p.id);
}

async function addName(ctx: Ctx, position: number, op: Op<'addName'>) {
  const personId = ref(ctx, op.personId);
  if (!isTempId(op.personId)) await checkBase(ctx, position, 'person', personId, op.baseVersion, 'the Person');
  const n = await ctx.rows.insert('name', {
    person_id: personId,
    given: op.given,
    surname: op.surname,
    type: op.type,
    language: op.language,
    as_found: op.asFound,
    is_primary: false,
    sort_order: await nextSort(ctx.db, 'name', 'person_id', personId),
  });
  if (op.tempId) ctx.temps.set(op.tempId, n.id);
}

async function createEvent(ctx: Ctx, op: Op<'createEvent'>) {
  const e = await ctx.rows.insert('event', {
    type: op.type,
    type_detail: op.typeDetail,
    ...dateColumns(op.date),
    place_id: op.placeId ? ref(ctx, op.placeId) : null,
    house_id: op.houseId ? ref(ctx, op.houseId) : null,
    description: op.description,
  });
  ctx.temps.set(op.tempId, e.id);
}

async function addRole(ctx: Ctx, position: number, op: Op<'addRole'>) {
  const eventId = ref(ctx, op.eventId);
  const personId = ref(ctx, op.personId);
  if (!isTempId(op.eventId)) await checkBase(ctx, position, 'event', eventId, op.baseVersion, 'the Event');
  if (!isTempId(op.personId)) await checkBase(ctx, position, 'person', personId, undefined, 'the Person');
  await ctx.rows.insert('event_role', {
    event_id: eventId,
    person_id: personId,
    role: op.role,
    role_detail: op.roleDetail,
    sort_order: await nextSort(ctx.db, 'event_role', 'event_id', eventId),
  });
}

async function createFamily(ctx: Ctx, position: number, op: Op<'createFamily'>) {
  const partners: Array<string | null> = [];
  for (const raw of [op.partner1Id, op.partner2Id]) {
    const id = raw ? ref(ctx, raw) : null;
    if (raw && id && !isTempId(raw)) await checkBase(ctx, position, 'person', id, undefined, 'a partner');
    partners.push(id);
  }
  const f = await ctx.rows.insert('family', { partner1_id: partners[0], partner2_id: partners[1] });
  ctx.temps.set(op.tempId, f.id);
}

async function linkChild(ctx: Ctx, position: number, op: Op<'linkChild'>) {
  const familyId = ref(ctx, op.familyId);
  const childId = ref(ctx, op.childId);
  if (!isTempId(op.familyId)) await checkBase(ctx, position, 'family', familyId, op.baseVersion, 'the Family');
  if (!isTempId(op.childId)) await checkBase(ctx, position, 'person', childId, undefined, 'the child');
  await ctx.rows.insert('family_child', {
    family_id: familyId,
    child_id: childId,
    link_type: op.linkType,
    sort_order: await nextSort(ctx.db, 'family_child', 'family_id', familyId),
  });
}

async function createSource(ctx: Ctx, position: number, op: Op<'createSource'>) {
  const account = op.familyAccount;
  if (account?.givenByPersonId) await checkBase(ctx, position, 'person', account.givenByPersonId, undefined, 'the Person who gave the account');
  const s = await ctx.rows.insert('source', {
    type: op.type,
    title: op.title,
    repository: op.repository,
    reference: op.reference,
    url: op.url,
    account_given_by: account?.givenBy ?? null,
    account_given_by_person_id: account?.givenByPersonId ?? null,
    account_given_on: account?.givenOn ?? null,
    ...registerColumns(createSourceRegister(ctx, op)),
  });
  ctx.temps.set(op.tempId, s.id);
}

function createSourceRegister(ctx: Ctx, op: Op<'createSource'>) {
  return op.register ? { ...op.register, parishId: ref(ctx, op.register.parishId) } : null;
}

async function createCitation(ctx: Ctx, op: Op<'createCitation'>) {
  const c = await ctx.rows.insert('citation', {
    source_id: ref(ctx, op.sourceId),
    page: op.page,
    transcription: op.transcription,
    read_on: op.readOn,
    confidence: op.confidence,
    note: op.note,
  });
  ctx.temps.set(op.tempId, c.id);
  ctx.citations.add(c.id);
}

async function attachCitation(ctx: Ctx, position: number, op: Op<'attachCitation'>) {
  const citationId = ref(ctx, op.citationId);
  if (op.eventId) {
    const eventId = ref(ctx, op.eventId);
    if (!isTempId(op.eventId)) await checkBase(ctx, position, 'event', eventId, op.baseVersion, 'the Event');
    await ctx.rows.insert('event_citation', { event_id: eventId, citation_id: citationId });
  } else if (op.nameId) {
    const nameId = ref(ctx, op.nameId);
    if (!isTempId(op.nameId)) await checkBase(ctx, position, 'name', nameId, op.baseVersion, 'the Name');
    await ctx.rows.insert('name_citation', { name_id: nameId, citation_id: citationId });
  }
  ctx.citations.add(citationId);
}

async function addImage(ctx: Ctx, position: number, op: Op<'addImage'>) {
  const upload = await ctx.db.selectFrom('upload').selectAll().where('id', '=', op.uploadId).forUpdate().executeTakeFirst();
  if (
    !upload ||
    upload.kind !== 'image' ||
    upload.author_id !== ctx.authorId ||
    upload.proposal_id !== ctx.proposalId ||
    upload.status !== 'ready' ||
    !upload.content_type ||
    !upload.sha256 ||
    !upload.byte_size
  ) {
    throw new ApiProblem(409, 'upload_unusable', `Operation ${position + 1}: the image upload is missing, not finished, or not part of this Proposal.`);
  }
  const imageId = uuidv7();
  const to = { original: `images/${imageId}/original`, display: `images/${imageId}/display.webp` };
  await ctx.rows.insert('image', {
    id: imageId,
    kind: op.kind,
    citation_id: op.citationId ? ref(ctx, op.citationId) : null,
    storage_key: to.original,
    display_key: to.display,
    content_type: upload.content_type,
    byte_size: upload.byte_size,
    width: upload.width,
    height: upload.height,
    sha256: upload.sha256,
    caption: op.caption,
  });
  for (const p of op.personIds) {
    if (!isTempId(p)) await checkBase(ctx, position, 'person', p, undefined, 'a Person in the portrait');
    await ctx.rows.insert('image_person', { image_id: imageId, person_id: ref(ctx, p) });
  }
  ctx.uploads.push({ uploadId: upload.id, imageId, from: { original: upload.storage_key, display: upload.display_key }, to });
  if (op.tempId) ctx.temps.set(op.tempId, imageId);
}

async function setField(ctx: Ctx, position: number, op: Op<'setField'>) {
  const name = RECORD_TABLES[op.record];
  await checkBase(ctx, position, name, op.id, op.baseVersion, `the ${op.record}`);
  if (Object.keys(op.set).length === 0) return; // every field kept as it is, by the Editor's choice
  await ctx.rows.update(name, op.id, setFieldColumns(op.set));
}

/** The Owner marks or unmarks a Family root: one family_root record per root. */
async function setFamilyRoot(ctx: Ctx, position: number, op: Op<'setFamilyRoot'>) {
  await checkBase(ctx, position, 'person', op.personId, undefined, 'the Person');
  const existing = await ctx.db.selectFrom('family_root').select('id').where('person_id', '=', op.personId).executeTakeFirst();
  if (op.familyRoot && !existing) await ctx.rows.insert('family_root', { person_id: op.personId });
  else if (!op.familyRoot && existing) await ctx.rows.remove('family_root', existing.id);
}

async function restoreRecord(ctx: Ctx, position: number, op: Op<'restoreRecord'>) {
  const current = await snapshot(ctx.db, op.table, op.id);
  if (op.baseVersion !== null && current && current.version !== op.baseVersion) throw new ConflictProblem(position, `the ${op.table.replace('_', ' ')} record`);
  if (op.values === null) await ctx.rows.remove(op.table, op.id);
  else await ctx.rows.restore(op.table, op.id, op.table === 'name' ? legacyName(op.values) : op.values, op.fields);
}

function applyOne(ctx: Ctx, position: number, op: Operation): Promise<void> {
  switch (op.op) {
    case 'createPerson':
      return createPerson(ctx, op);
    case 'addName':
      return addName(ctx, position, op);
    case 'createEvent':
      return createEvent(ctx, op);
    case 'addRole':
      return addRole(ctx, position, op);
    case 'createFamily':
      return createFamily(ctx, position, op);
    case 'linkChild':
      return linkChild(ctx, position, op);
    case 'createSource':
      return createSource(ctx, position, op);
    case 'createCitation':
      return createCitation(ctx, op);
    case 'attachCitation':
      return attachCitation(ctx, position, op);
    case 'addImage':
      return addImage(ctx, position, op);
    case 'setField':
      return setField(ctx, position, op);
    case 'mergePersons':
      return merge(ctx, position, op);
    case 'restoreRecord':
      return restoreRecord(ctx, position, op);
    case 'setFamilyRoot':
      return setFamilyRoot(ctx, position, op);
    default:
      return applyPlaceOrNote(ctx, position, op);
  }
}

const PG_PROBLEMS: Record<string, [number, string, string]> = {
  '23505': [409, 'duplicate', 'This link or Role already exists in the Tree.'],
  '23503': [409, 'record_missing', 'A record this Proposal refers to does not exist.'],
  '23514': [409, 'invalid_change', 'The change would break a rule of the Tree.'],
};

/** Turns database rule violations into API problems that say which rule. */
export function translateDbError(error: unknown, position?: number): unknown {
  const code = stringField(error, 'code');
  const known = code ? PG_PROBLEMS[code] : undefined;
  if (!known) return error;
  const where = position === undefined ? '' : `Operation ${position + 1}: `;
  const message = stringField(error, 'message');
  const constraint = stringField(error, 'constraint');
  const detail = code === '23514' && message ? ` (${message})` : constraint ? ` (${constraint})` : '';
  return new ApiProblem(known[0], known[1], `${where}${known[2]}${detail}`);
}

/**
 * Applies operations in order inside the caller's transaction. Every base version is
 * checked, every touched record is snapshotted before and after; any failure throws and the
 * caller's transaction rolls everything back, so a Proposal is never half-applied.
 */
export async function applyOperations(db: Db, ops: readonly Operation[], who: { proposalId: string; authorId: string }): Promise<ApplyResult> {
  const changes = new ChangeSet();
  const ctx: Ctx = { db, rows: trackedRows(db, changes), changes, temps: new Map(), citations: new Set(), uploads: [], ...who };
  for (const [position, op] of ops.entries()) {
    try {
      await applyOne(ctx, position, op);
    } catch (error) {
      throw translateDbError(error, position);
    }
  }
  return { changes, temps: ctx.temps, citationIds: [...ctx.citations], uploads: ctx.uploads };
}
