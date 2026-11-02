import { isTempId, type PlaceOrNoteOperation } from '@rodokmen/shared';
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
  }
}
