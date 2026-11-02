/**
 * Proposals (proposals spec): one finding with all its changes, as an ordered list of typed
 * operations from a closed set. Each operation that changes an existing record names it and
 * the version the Member saw (`baseVersion`). Records created in the same Proposal are
 * referenced by temporary ids (`tmp:child`). An unknown operation is rejected, never guessed.
 *
 * The set is versioned by {@link OPERATIONS_VERSION}: a Proposal states the version it was
 * written for, and the server refuses versions it does not know.
 */
import { z } from 'zod';
import { EdtfDate, Id, IsoDay, LanguageTag, Version, WebUrl } from './common.js';
import {
  AddHouseNumber,
  AddLabel,
  AddPlaceName,
  CreateEstate,
  CreateHouse,
  CreateParish,
  CreatePlace,
  LinkPlaceEstate,
  LinkPlaceParish,
  RemoveLabel,
  SetNotes,
} from './place-operations.js';
import { Ref, TempId } from './refs.js';
import { SERVER_OPERATIONS, SetFamilyRoot } from './server-operations.js';
import {
  ChildLinkType,
  Confidence,
  EventType,
  FamilyAccount,
  ImageKind,
  MunicipalityLink,
  NameType,
  PlaceType,
  RegisterCoverage,
  RoleType,
  Sex,
  SourceType,
} from './tree.js';

export * from './refs.js';
export * from './place-operations.js';

export const OPERATIONS_VERSION = 1;

const text = (max: number) => z.string().max(max);
const nonEmpty = (max: number) => z.string().trim().min(1).max(max);

const NameFields = {
  given: text(200),
  surname: text(200),
  type: NameType,
  language: LanguageTag.nullable().default(null).describe('The language the Name is written in (BCP 47, such as la or de); null when not known'),
  asFound: nonEmpty(400).describe('The spelling exactly as found in the Source'),
};

const hasName = (n: { given: string; surname: string }) => n.given.trim() !== '' || n.surname.trim() !== '';

/** A Zod issue path as plain keys and indexes (Zod allows symbols, which JSON cannot carry). */
const issuePath = (path: readonly PropertyKey[]): Array<string | number> => path.map((p) => (typeof p === 'symbol' ? String(p) : p));

// ---------------------------------------------------------------- operations

export const CreatePerson = z
  .object({
    op: z.literal('createPerson'),
    tempId: TempId,
    sex: Sex,
    name: z.object(NameFields).refine(hasName, { message: 'a Name needs a given name or a surname', path: ['given'] }),
  })
  .meta({ id: 'CreatePerson', description: 'A new Person with a primary Name' });

export const AddName = z
  .object({
    op: z.literal('addName'),
    tempId: TempId.optional(),
    personId: Ref,
    baseVersion: Version.optional().describe('Version of the existing Person'),
    ...NameFields,
  })
  .refine(hasName, { message: 'a Name needs a given name or a surname', path: ['given'] })
  .meta({ id: 'AddName', description: 'Another Name of a Person (not primary)' });

export const CreateEvent = z
  .object({
    op: z.literal('createEvent'),
    tempId: TempId,
    type: EventType,
    typeDetail: text(200).nullable().default(null),
    date: EdtfDate.nullable(),
    placeId: Ref.nullable().default(null).describe('A Place of the Tree, or one created earlier in the same Proposal or Import batch'),
    houseId: Ref.nullable().default(null).describe('A House of the Tree, or one created earlier in the same Proposal or Import batch'),
    description: text(4000).nullable().default(null),
  })
  .refine((e) => e.placeId === null || e.houseId === null, { message: 'give either a Place or a House, not both', path: ['houseId'] })
  .refine((e) => e.type !== 'other' || (e.typeDetail ?? '').trim() !== '', { message: 'an Event of type "other" needs a typeDetail', path: ['typeDetail'] })
  .meta({ id: 'CreateEvent' });

export const AddRole = z
  .object({
    op: z.literal('addRole'),
    eventId: Ref,
    personId: Ref,
    role: RoleType,
    roleDetail: text(200).nullable().default(null),
    baseVersion: Version.optional().describe('Version of the existing Event'),
  })
  .meta({ id: 'AddRole', description: 'The part a Person plays in an Event' });

export const CreateFamily = z
  .object({
    op: z.literal('createFamily'),
    tempId: TempId,
    partner1Id: Ref.nullable(),
    partner2Id: Ref.nullable(),
  })
  .refine((f) => f.partner1Id === null || f.partner1Id !== f.partner2Id, { message: 'the two partners must be different Persons', path: ['partner2Id'] })
  .meta({ id: 'CreateFamily' });

export const LinkChild = z
  .object({
    op: z.literal('linkChild'),
    familyId: Ref,
    childId: Ref,
    linkType: ChildLinkType,
    baseVersion: Version.optional().describe('Version of the existing Family'),
  })
  .meta({ id: 'LinkChild' });

/** A register's coverage as an operation gives it: its Parish may be created earlier in the same Proposal or Import batch. */
const RegisterInput = RegisterCoverage.safeExtend({ parishId: Ref.describe('The Parish that kept the register') });

export const CreateSource = z
  .object({
    op: z.literal('createSource'),
    tempId: TempId,
    type: SourceType,
    title: nonEmpty(400),
    repository: text(400).nullable().default(null),
    reference: text(200).nullable().default(null),
    url: WebUrl.nullable().default(null),
    familyAccount: FamilyAccount.nullable().default(null),
    register: RegisterInput.nullable().default(null).describe('For a register book: its Parish, kinds and years'),
  })
  .refine((s) => (s.type === 'family_account') === (s.familyAccount !== null), {
    message: 'a Family account Source records who gave the account and when; other Sources do not',
    path: ['familyAccount'],
  })
  .refine((s) => s.register === null || s.type === 'parish_register', { message: 'only a parish register covers a Parish', path: ['register'] })
  .meta({ id: 'CreateSource' });

export const CreateCitation = z
  .object({
    op: z.literal('createCitation'),
    tempId: TempId,
    sourceId: Ref,
    page: text(200).nullable().default(null),
    transcription: nonEmpty(20_000),
    readOn: IsoDay,
    confidence: Confidence,
    note: text(4000).nullable().default(null),
  })
  .meta({ id: 'CreateCitation' });

export const AttachCitation = z
  .object({
    op: z.literal('attachCitation'),
    citationId: Ref,
    eventId: Ref.optional(),
    nameId: Ref.optional(),
    baseVersion: Version.optional().describe('Version of the existing Event or Name'),
  })
  .refine((a) => (a.eventId === undefined) !== (a.nameId === undefined), { message: 'attach the Citation to one Event or one Name', path: ['eventId'] })
  .meta({ id: 'AttachCitation' });

export const AddImage = z
  .object({
    op: z.literal('addImage'),
    tempId: TempId.optional(),
    uploadId: Id.describe('A finished upload of the author (POST /api/uploads)'),
    kind: ImageKind,
    citationId: Ref.nullable().default(null),
    personIds: z.array(Ref).max(50).default([]),
    caption: text(1000).nullable().default(null),
  })
  .refine((i) => i.kind === 'portrait' || i.citationId !== null, { message: 'page images and photos belong to a Citation', path: ['citationId'] })
  .refine((i) => i.kind !== 'portrait' || i.personIds.length > 0, { message: 'a portrait shows at least one Person', path: ['personIds'] })
  .meta({ id: 'AddImage' });

/** Fields an operation may set on an existing record, by record kind. */
export const SETTABLE_FIELDS = {
  person: { sex: Sex },
  name: { given: text(200), surname: text(200), type: NameType, language: LanguageTag.nullable(), asFound: nonEmpty(400) },
  event: {
    type: EventType,
    typeDetail: text(200).nullable(),
    date: EdtfDate.nullable(),
    placeId: Id.nullable(),
    houseId: Id.nullable(),
    description: text(4000).nullable(),
  },
  role: { role: RoleType, roleDetail: text(200).nullable() },
  childLink: { linkType: ChildLinkType },
  source: {
    title: nonEmpty(400),
    repository: text(400).nullable(),
    reference: text(200).nullable(),
    url: WebUrl.nullable(),
    register: RegisterCoverage.nullable(),
  },
  citation: { page: text(200).nullable(), transcription: nonEmpty(20_000), readOn: IsoDay, confidence: Confidence, note: text(4000).nullable() },
  place: { type: PlaceType, municipality: MunicipalityLink.nullable() },
  house: { note: text(4000).nullable() },
  parish: { name: nonEmpty(200), seatPlaceId: Id.nullable() },
  estate: { name: nonEmpty(200) },
} as const;

export const SettableRecord = z
  .enum(['person', 'name', 'event', 'role', 'childLink', 'source', 'citation', 'place', 'house', 'parish', 'estate'])
  .meta({ id: 'SettableRecord' });
export type SettableRecord = z.infer<typeof SettableRecord>;

export const SetField = z
  .object({
    op: z.literal('setField'),
    record: SettableRecord,
    id: Id,
    baseVersion: Version.describe('Version of the record as the Member saw it'),
    set: z.record(z.string(), z.unknown()).describe('Field names and their new values'),
  })
  .superRefine((s, ctx) => {
    const fields = SETTABLE_FIELDS[s.record] as Record<string, z.ZodType>;
    const keys = Object.keys(s.set);
    for (const key of keys) {
      // Own keys only: "constructor" or "__proto__" must not reach Object.prototype.
      const schema = Object.hasOwn(fields, key) ? fields[key] : undefined;
      if (!schema) {
        ctx.addIssue({ code: 'custom', message: `a ${s.record} has no settable field "${key}"`, path: ['set', key] });
        continue;
      }
      const r = schema.safeParse(s.set[key]);
      if (!r.success)
        for (const issue of r.error.issues) ctx.addIssue({ code: 'custom', message: issue.message, path: ['set', key, ...issuePath(issue.path)] });
    }
  })
  .meta({ id: 'SetField', description: 'Changes fields of an existing record' });

export const MergePersons = z
  .object({
    op: z.literal('mergePersons'),
    keepId: Id.describe('The Person that remains'),
    mergeId: Id.describe('The Person merged into it'),
    keepBaseVersion: Version,
    mergeBaseVersion: Version,
  })
  .refine((m) => m.keepId !== m.mergeId, { message: 'a Person cannot be merged into itself', path: ['mergeId'] })
  .meta({ id: 'MergePersons', description: 'Editors only: moves every Name, Role, Family link and Citation to the kept Person' });

/** Tables an undo may restore. */
export const RESTORABLE_TABLES = [
  'person',
  'name',
  'family',
  'family_child',
  'event',
  'event_role',
  'source',
  'citation',
  'event_citation',
  'name_citation',
  'image',
  'image_person',
  'family_root',
  'place',
  'place_name',
  'house',
  'house_number',
  'parish',
  'place_parish',
  'estate',
  'place_estate',
  'person_label',
] as const;
export const RestorableTable = z.enum(RESTORABLE_TABLES).meta({ id: 'RestorableTable' });
export type RestorableTable = z.infer<typeof RestorableTable>;

/**
 * Written only by the server when it undoes a Proposal: puts a record back to its logged
 * before-snapshot (null: the record did not exist, so it is deleted). `fields` limits the
 * restore to some columns, when the Editor keeps later edits of the others.
 */
export const RestoreRecord = z
  .object({
    op: z.literal('restoreRecord'),
    table: RestorableTable,
    id: Id,
    baseVersion: Version.nullable().describe('Version the record has after the undone Proposal; null if that Proposal deleted it'),
    values: z.record(z.string(), z.unknown()).nullable(),
    fields: z.array(z.string()).optional(),
  })
  .meta({ id: 'RestoreRecord' });

export const Operation = z
  .discriminatedUnion('op', [
    CreatePerson,
    AddName,
    CreateEvent,
    AddRole,
    CreateFamily,
    LinkChild,
    CreateSource,
    CreateCitation,
    AttachCitation,
    AddImage,
    SetField,
    MergePersons,
    RestoreRecord,
    SetFamilyRoot,
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
  ])
  .meta({ id: 'Operation' });

export type Operation = z.infer<typeof Operation>;
export type OperationInput = z.input<typeof Operation>;
export type OperationName = Operation['op'];
export const OPERATION_NAMES: OperationName[] = Operation.options.map((o) => o.shape.op.value);

/** Operations a Member may submit: all but the server's own (server-operations.ts). Merges are Editors' only. */
export const SUBMITTABLE_OPERATIONS: readonly OperationName[] = OPERATION_NAMES.filter((n) => !SERVER_OPERATIONS.includes(n));
export const EDITOR_ONLY_OPERATIONS: readonly OperationName[] = ['mergePersons'];

// ---------------------------------------------------------------- whole Proposals

export const ProposalStatus = z.enum(['pending', 'accepted', 'rejected']).meta({ id: 'ProposalStatus' });
export type ProposalStatus = z.infer<typeof ProposalStatus>;
export const ProposalKind = z
  .enum(['contribution', 'direct', 'undo'])
  .meta({ id: 'ProposalKind', description: "Submitted for review, an Editor's direct change, or an undo" });
export type ProposalKind = z.infer<typeof ProposalKind>;
