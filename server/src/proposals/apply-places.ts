import { isTempId, type PlaceOrNoteOperation } from '@rodokmen/shared';
import { v7 as uuidv7 } from 'uuid';
import { sql } from 'kysely';
import { ApiProblem } from '../auth/problem.js';
import { periodColumns } from '../tree/dates.js';
import { checkBase, ref, type Ctx, type Op } from './apply-context.js';
import { municipalityColumns, point, RECORD_TABLES } from './columns.js';

/**
 * Applying the operations on Places, Houses, Parishes and Estates, and on research notes and
 * Labels (add-vault-import tasks 1.1, 1.2 and 1.7), in the caller's transaction (apply.ts).
 */

// ---------------------------------------------------------------- Places, Houses, Parishes, Estates

async function createPlace(ctx: Ctx, op: Op<'createPlace'>) {
  const p = await ctx.rows.insert('place', { type: op.type, location: point(op.location), ...municipalityColumns(op.municipality) });
  await ctx.rows.insert('place_name', { place_id: p.id, name: op.name.name, language: op.name.language, is_primary: true, ...periodColumns(op.name.period) });
  ctx.temps.set(op.tempId, p.id);
}

/** The Place an operation adds to, checked against the version the author saw. */
async function placeOf(ctx: Ctx, position: number, placeId: string, baseVersion: number | undefined): Promise<string> {
  const id = ref(ctx, placeId);
  if (!isTempId(placeId)) await checkBase(ctx, position, 'place', id, baseVersion, 'the Place');
  return id;
}

async function addPlaceName(ctx: Ctx, position: number, op: Op<'addPlaceName'>) {
  const placeId = await placeOf(ctx, position, op.placeId, op.baseVersion);
  await ctx.rows.insert('place_name', { place_id: placeId, name: op.name, language: op.language, is_primary: false, ...periodColumns(op.period) });
}

async function createHouse(ctx: Ctx, position: number, op: Op<'createHouse'>) {
  const placeId = await placeOf(ctx, position, op.placeId, undefined);
  const h = await ctx.rows.insert('house', { place_id: placeId, location: point(op.location), note: op.note });
  for (const n of op.numbers) await ctx.rows.insert('house_number', { house_id: h.id, number: n.number, ...periodColumns(n.period) });
  ctx.temps.set(op.tempId, h.id);
}

async function addHouseNumber(ctx: Ctx, position: number, op: Op<'addHouseNumber'>) {
  const houseId = ref(ctx, op.houseId);
  if (!isTempId(op.houseId)) await checkBase(ctx, position, 'house', houseId, op.baseVersion, 'the House');
  await ctx.rows.insert('house_number', { house_id: houseId, number: op.number, ...periodColumns(op.period) });
}

async function createParish(ctx: Ctx, position: number, op: Op<'createParish'>) {
  const seat = op.seatPlaceId ? await placeOf(ctx, position, op.seatPlaceId, undefined) : null;
  const p = await ctx.rows.insert('parish', { name: op.name, seat_place_id: seat });
  ctx.temps.set(op.tempId, p.id);
}

async function createEstate(ctx: Ctx, op: Op<'createEstate'>) {
  const e = await ctx.rows.insert('estate', { name: op.name });
  ctx.temps.set(op.tempId, e.id);
}

async function linkPlace(ctx: Ctx, position: number, op: Op<'linkPlaceParish' | 'linkPlaceEstate'>) {
  const placeId = await placeOf(ctx, position, op.placeId, op.baseVersion);
  if (op.op === 'linkPlaceParish') {
    const parishId = ref(ctx, op.parishId);
    if (!isTempId(op.parishId)) await checkBase(ctx, position, 'parish', parishId, undefined, 'the Parish');
    await ctx.rows.insert('place_parish', { place_id: placeId, parish_id: parishId, ...periodColumns(op.period) });
  } else {
    const estateId = ref(ctx, op.estateId);
    if (!isTempId(op.estateId)) await checkBase(ctx, position, 'estate', estateId, undefined, 'the Estate');
    await ctx.rows.insert('place_estate', { place_id: placeId, estate_id: estateId, ...periodColumns(op.period) });
  }
}

// ---------------------------------------------------------------- research notes and Labels

async function setNotes(ctx: Ctx, position: number, op: Op<'setNotes'>) {
  const table = RECORD_TABLES[op.record];
  const id = ref(ctx, op.id);
  if (!isTempId(op.id)) await checkBase(ctx, position, table, id, op.baseVersion, `the ${op.record}`);
  const notes = op.notes === null || op.notes.trim() === '' ? null : op.notes;
  await ctx.rows.update(table, id, { notes });
}

async function labelOf(ctx: Ctx, personId: string, label: string): Promise<{ id: string } | undefined> {
  return ctx.db
    .selectFrom('person_label')
    .select('id')
    .where('person_id', '=', personId)
    .where('folded', '=', sql<string>`rdk_fold(trim(${label}))`)
    .executeTakeFirst();
}

async function addLabel(ctx: Ctx, position: number, op: Op<'addLabel'>) {
  const personId = ref(ctx, op.personId);
  if (!isTempId(op.personId)) await checkBase(ctx, position, 'person', personId, op.baseVersion, 'the Person');
  if (await labelOf(ctx, personId, op.label))
    throw new ApiProblem(409, 'duplicate', `Operation ${position + 1}: this Person already carries the Label "${op.label}".`);
  await ctx.rows.insert('person_label', { person_id: personId, label: op.label.trim() });
}

async function removeLabel(ctx: Ctx, position: number, op: Op<'removeLabel'>) {
  await checkBase(ctx, position, 'person', op.personId, op.baseVersion, 'the Person');
  const found = await labelOf(ctx, op.personId, op.label);
  if (!found) throw new ApiProblem(409, 'record_missing', `Operation ${position + 1}: this Person does not carry the Label "${op.label}".`);
  await ctx.rows.remove('person_label', found.id);
}

// ---------------------------------------------------------------- documents on Sources

/** A finished document upload of this Proposal's author, of the given type. */
async function documentUpload(ctx: Ctx, position: number, uploadId: string, type: 'application/pdf' | 'application/msword') {
  const u = await ctx.db.selectFrom('upload').selectAll().where('id', '=', uploadId).forUpdate().executeTakeFirst();
  if (
    !u ||
    u.kind !== 'document' ||
    u.content_type !== type ||
    u.author_id !== ctx.authorId ||
    u.proposal_id !== ctx.proposalId ||
    u.status !== 'ready' ||
    !u.sha256 ||
    !u.byte_size
  ) {
    const what = type === 'application/pdf' ? 'PDF' : 'original DOC';
    throw new ApiProblem(409, 'upload_unusable', `Operation ${position + 1}: the ${what} upload is missing, not finished, or not part of this Proposal.`);
  }
  return { ...u, sha256: u.sha256, byte_size: u.byte_size };
}

/** A PDF document on a Source, with the DOC it was converted from when there is one (evidence-media spec, "Documents on Sources"). */
async function addDocument(ctx: Ctx, position: number, op: Op<'addDocument'>) {
  const sourceId = ref(ctx, op.sourceId);
  if (!isTempId(op.sourceId)) await checkBase(ctx, position, 'source', sourceId, undefined, 'the Source');
  const pdf = await documentUpload(ctx, position, op.uploadId, 'application/pdf');
  const doc = op.originalUploadId ? await documentUpload(ctx, position, op.originalUploadId, 'application/msword') : null;
  const id = uuidv7();
  const keys = { pdf: `documents/${id}/document.pdf`, original: `documents/${id}/original.doc` };
  await ctx.rows.insert('source_document', {
    id,
    source_id: sourceId,
    title: op.title,
    storage_key: keys.pdf,
    content_type: 'application/pdf',
    byte_size: pdf.byte_size,
    sha256: pdf.sha256,
    original_key: doc ? keys.original : null,
    original_content_type: doc ? 'application/msword' : null,
    original_byte_size: doc?.byte_size ?? null,
    original_sha256: doc?.sha256 ?? null,
  });
  ctx.uploads.push({ uploadId: pdf.id, documentId: id, from: { original: pdf.storage_key }, to: { original: keys.pdf } });
  if (doc) ctx.uploads.push({ uploadId: doc.id, documentId: id, from: { original: doc.storage_key }, to: { original: keys.original } });
}

export function applyPlaceOrNote(ctx: Ctx, position: number, op: PlaceOrNoteOperation): Promise<void> {
  switch (op.op) {
    case 'createPlace':
      return createPlace(ctx, op);
    case 'addPlaceName':
      return addPlaceName(ctx, position, op);
    case 'createHouse':
      return createHouse(ctx, position, op);
    case 'addHouseNumber':
      return addHouseNumber(ctx, position, op);
    case 'createParish':
      return createParish(ctx, position, op);
    case 'createEstate':
      return createEstate(ctx, op);
    case 'linkPlaceParish':
    case 'linkPlaceEstate':
      return linkPlace(ctx, position, op);
    case 'setNotes':
      return setNotes(ctx, position, op);
    case 'addLabel':
      return addLabel(ctx, position, op);
    case 'removeLabel':
      return removeLabel(ctx, position, op);
    case 'addDocument':
      return addDocument(ctx, position, op);
  }
}
