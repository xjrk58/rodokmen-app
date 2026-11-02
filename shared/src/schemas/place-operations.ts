/**
 * Operations on Places, Houses, Parishes and Estates, and on research notes and Labels
 * (add-vault-import tasks 1.1, 1.2 and 1.7). The Vault importer submits Places with their Houses,
 * Parishes and Estates first, as their own Proposals (vault-import spec, "One Proposal per Source
 * note"); research notes and Labels state no fact (tree-model spec, "Research notes on records").
 */
import { z } from 'zod';
import { GeoPoint, Id, NameLanguage, Period, Version } from './common.js';
import { Ref, TempId } from './refs.js';
import { HouseNumber, MunicipalityLink, PlaceType } from './tree.js';

const text = (max: number) => z.string().max(max);
const nonEmpty = (max: number) => z.string().trim().min(1).max(max);

const PlaceNameFields = {
  name: nonEmpty(200),
  language: NameLanguage,
  period: Period.default({ from: null, to: null }).describe('When the name was used; open ends when unknown'),
};

export const CreatePlace = z
  .object({
    op: z.literal('createPlace'),
    tempId: TempId,
    type: PlaceType,
    location: GeoPoint.nullable().default(null),
    municipality: MunicipalityLink.nullable().default(null).describe("Today's Municipality the Place lies in"),
    name: z.object(PlaceNameFields).describe('The primary name'),
  })
  .meta({ id: 'CreatePlace', description: 'A new Place with its primary name' });

export const AddPlaceName = z
  .object({
    op: z.literal('addPlaceName'),
    placeId: Ref,
    baseVersion: Version.optional().describe('Version of the existing Place'),
    ...PlaceNameFields,
  })
  .meta({ id: 'AddPlaceName', description: 'Another name of a Place, in a language and period' });

const HouseNumberFields = { number: HouseNumber, period: Period.default({ from: null, to: null }).describe('When the House carried the number') };

export const CreateHouse = z
  .object({
    op: z.literal('createHouse'),
    tempId: TempId,
    placeId: Ref,
    location: GeoPoint.nullable().default(null),
    note: text(4000).nullable().default(null),
    numbers: z.array(z.object(HouseNumberFields)).max(20).default([]).describe('Its house numbers (čp.) over time'),
  })
  .meta({ id: 'CreateHouse', description: 'A new House in a Place, with its house numbers' });

export const AddHouseNumber = z
  .object({ op: z.literal('addHouseNumber'), houseId: Ref, baseVersion: Version.optional().describe('Version of the existing House'), ...HouseNumberFields })
  .meta({ id: 'AddHouseNumber' });

export const CreateParish = z
  .object({
    op: z.literal('createParish'),
    tempId: TempId,
    name: nonEmpty(200),
    seatPlaceId: Ref.nullable().default(null).describe('Where the parish church stands'),
  })
  .meta({ id: 'CreateParish' });

export const CreateEstate = z
  .object({ op: z.literal('createEstate'), tempId: TempId, name: nonEmpty(200) })
  .meta({ id: 'CreateEstate', description: 'A new Estate (panství)' });

export const LinkPlaceParish = z
  .object({
    op: z.literal('linkPlaceParish'),
    placeId: Ref,
    parishId: Ref,
    period: Period.default({ from: null, to: null }),
    baseVersion: Version.optional().describe('Version of the existing Place'),
  })
  .meta({ id: 'LinkPlaceParish', description: 'A Place belonged to a Parish during a period' });

export const LinkPlaceEstate = z
  .object({
    op: z.literal('linkPlaceEstate'),
    placeId: Ref,
    estateId: Ref,
    period: Period.default({ from: null, to: null }),
    baseVersion: Version.optional().describe('Version of the existing Place'),
  })
  .meta({ id: 'LinkPlaceEstate', description: 'A Place was part of an Estate during a period' });

// ---------------------------------------------------------------- research notes and Labels

/** Records that hold research notes (tree-model spec, "Research notes on records"). */
export const NotesRecord = z.enum(['person', 'family', 'event', 'place', 'house', 'parish', 'estate', 'source']).meta({ id: 'NotesRecord' });
export type NotesRecord = z.infer<typeof NotesRecord>;

/** The longest research note (server/src/db/migrations/0011_notes_and_labels.ts checks the same). */
export const NOTES_MAX = 50_000;

export const SetNotes = z
  .object({
    op: z.literal('setNotes'),
    record: NotesRecord,
    id: Ref,
    baseVersion: Version.optional().describe('Version of the existing record'),
    notes: z.string().max(NOTES_MAX).nullable().describe('Research notes in Markdown; null removes them'),
  })
  .meta({ id: 'SetNotes', description: 'The research notes of a record. They state no fact, so a Proposal of notes and Labels alone needs no Citation' });

/** A Label: a free word or short phrase that groups Persons, such as a family line (tree-model spec, "Labels on Persons"). */
export const Label = nonEmpty(200).meta({ id: 'Label', description: 'A free word or short phrase, such as line/novak; compared ignoring case and diacritics' });

export const AddLabel = z
  .object({ op: z.literal('addLabel'), personId: Ref, baseVersion: Version.optional().describe('Version of the existing Person'), label: Label })
  .meta({ id: 'AddLabel', description: 'A Label on a Person; one the Person has already (ignoring case and diacritics) is refused' });

export const RemoveLabel = z
  .object({ op: z.literal('removeLabel'), personId: Id, baseVersion: Version.optional().describe('Version of the Person'), label: Label })
  .meta({ id: 'RemoveLabel', description: 'Takes a Label off a Person, matched ignoring case and diacritics' });

/** The operations of this file. */
export const PLACE_AND_NOTE_OPERATIONS = [
  CreatePlace,
  AddPlaceName,
  CreateHouse,
  AddHouseNumber,
  CreateParish,
  CreateEstate,
  LinkPlaceParish,
  LinkPlaceEstate,
  SetNotes,
  AddLabel,
  RemoveLabel,
] as const;
export type PlaceOrNoteOperation = z.infer<(typeof PLACE_AND_NOTE_OPERATIONS)[number]>;

const NAMES: ReadonlySet<string> = new Set(PLACE_AND_NOTE_OPERATIONS.map((o) => o.shape.op.value));

/** Whether an operation is one of this file's. */
export function isPlaceOrNoteOperation<T extends { op: string }>(op: T): op is Extract<T, PlaceOrNoteOperation> {
  return NAMES.has(op.op);
}

type PlaceRefKind = 'person' | 'event' | 'family' | 'source' | 'place' | 'house' | 'parish' | 'estate';
const ref = (r: string | null | undefined, kind: PlaceRefKind, path: string) => (r ? [{ ref: r, kind, path }] : []);

/** References each of these operations makes, with the kind of record each must be. */
export function placeReferencesOf(op: PlaceOrNoteOperation): Array<{ ref: string; kind: PlaceRefKind; path: string }> {
  switch (op.op) {
    case 'addPlaceName':
    case 'createHouse':
      return ref(op.placeId, 'place', 'placeId');
    case 'addHouseNumber':
      return ref(op.houseId, 'house', 'houseId');
    case 'createParish':
      return ref(op.seatPlaceId, 'place', 'seatPlaceId');
    case 'linkPlaceParish':
      return [...ref(op.placeId, 'place', 'placeId'), ...ref(op.parishId, 'parish', 'parishId')];
    case 'linkPlaceEstate':
      return [...ref(op.placeId, 'place', 'placeId'), ...ref(op.estateId, 'estate', 'estateId')];
    case 'setNotes':
      return ref(op.id, op.record, 'id');
    case 'addLabel':
      return ref(op.personId, 'person', 'personId');
    case 'createPlace':
    case 'createEstate':
    case 'removeLabel':
      return [];
  }
}
