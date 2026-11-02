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
import { isCitationOperation, satisfiesEvidenceRule } from '../rules.js';
import { EdtfDate, Id, IsoDay, Version, WebUrl } from './common.js';
import { SERVER_OPERATIONS, serverOnly, SetFamilyRoot, type CheckOptions } from './server-operations.js';
import { ChildLinkType, Confidence, EventType, FamilyAccount, ImageKind, NameType, RoleType, Sex, SourceType } from './tree.js';

export const OPERATIONS_VERSION = 1;

const text = (max: number) => z.string().max(max);
const nonEmpty = (max: number) => z.string().trim().min(1).max(max);

/** A record created earlier in the same Proposal. */
export const TempId = z
  .string()
  .regex(/^tmp:[A-Za-z0-9_-]{1,40}$/, 'a temporary id looks like tmp:child')
  .meta({ id: 'TempId', description: 'Temporary id of a record created earlier in the same Proposal, such as tmp:child' });

/** An existing record (its id) or one created in the same Proposal (its temporary id). */
export const Ref = z.union([Id, TempId]).meta({ id: 'Ref' });

export const isTempId = (ref: string): boolean => ref.startsWith('tmp:');

const NameFields = {
  given: text(200),
  surname: text(200),
  type: NameType,
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
    placeId: Id.nullable().default(null),
    houseId: Id.nullable().default(null),
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
  })
  .refine((s) => (s.type === 'family_account') === (s.familyAccount !== null), {
    message: 'a Family account Source records who gave the account and when; other Sources do not',
    path: ['familyAccount'],
  })
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
  name: { given: text(200), surname: text(200), type: NameType, asFound: nonEmpty(400) },
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
  source: { title: nonEmpty(400), repository: text(400).nullable(), reference: text(200).nullable(), url: WebUrl.nullable() },
  citation: { page: text(200).nullable(), transcription: nonEmpty(20_000), readOn: IsoDay, confidence: Confidence, note: text(4000).nullable() },
} as const;

export const SettableRecord = z.enum(['person', 'name', 'event', 'role', 'childLink', 'source', 'citation']).meta({ id: 'SettableRecord' });
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

export interface ProposalIssue {
  code: 'invalid_operation' | 'unknown_operation' | 'not_allowed' | 'temp_id' | 'evidence_missing';
  message: string;
  /** Index of the operation, when the issue is about one. */
  position?: number;
  path?: Array<string | number>;
}

type TempKind = 'person' | 'name' | 'event' | 'family' | 'source' | 'citation' | 'image';
const CREATES: Partial<Record<OperationName, TempKind>> = {
  createPerson: 'person',
  addName: 'name',
  createEvent: 'event',
  createFamily: 'family',
  createSource: 'source',
  createCitation: 'citation',
  addImage: 'image',
};

/** References each operation makes, with the kind of record each must be. */
function referencesOf(op: Operation): Array<{ ref: string; kind: TempKind; path: string }> {
  switch (op.op) {
    case 'addName':
      return [{ ref: op.personId, kind: 'person', path: 'personId' }];
    case 'addRole':
      return [
        { ref: op.eventId, kind: 'event', path: 'eventId' },
        { ref: op.personId, kind: 'person', path: 'personId' },
      ];
    case 'createFamily':
      return [
        ...(op.partner1Id ? [{ ref: op.partner1Id, kind: 'person' as const, path: 'partner1Id' }] : []),
        ...(op.partner2Id ? [{ ref: op.partner2Id, kind: 'person' as const, path: 'partner2Id' }] : []),
      ];
    case 'linkChild':
      return [
        { ref: op.familyId, kind: 'family', path: 'familyId' },
        { ref: op.childId, kind: 'person', path: 'childId' },
      ];
    case 'createCitation':
      return [{ ref: op.sourceId, kind: 'source', path: 'sourceId' }];
    case 'attachCitation':
      return [
        { ref: op.citationId, kind: 'citation', path: 'citationId' },
        ...(op.eventId ? [{ ref: op.eventId, kind: 'event' as const, path: 'eventId' }] : []),
        ...(op.nameId ? [{ ref: op.nameId, kind: 'name' as const, path: 'nameId' }] : []),
      ];
    case 'addImage':
      return [
        ...(op.citationId ? [{ ref: op.citationId, kind: 'citation' as const, path: 'citationId' }] : []),
        ...op.personIds.map((p, i) => ({ ref: p, kind: 'person' as const, path: `personIds.${i}` })),
      ];
    default:
      return [];
  }
}

/** The existing record an operation changes and must name a base version for, if any. */
export function baseTargetOf(
  op: Operation,
): { record: 'person' | 'event' | 'family' | 'name' | SettableRecord; id: string; baseVersion: number | undefined; path: string } | null {
  switch (op.op) {
    case 'addName':
      return isTempId(op.personId) ? null : { record: 'person', id: op.personId, baseVersion: op.baseVersion, path: 'baseVersion' };
    case 'addRole':
      return isTempId(op.eventId) ? null : { record: 'event', id: op.eventId, baseVersion: op.baseVersion, path: 'baseVersion' };
    case 'linkChild':
      return isTempId(op.familyId) ? null : { record: 'family', id: op.familyId, baseVersion: op.baseVersion, path: 'baseVersion' };
    case 'attachCitation': {
      const target = op.eventId ?? op.nameId!;
      return isTempId(target) ? null : { record: op.eventId ? 'event' : 'name', id: target, baseVersion: op.baseVersion, path: 'baseVersion' };
    }
    case 'setField':
      return { record: op.record, id: op.id, baseVersion: op.baseVersion, path: 'baseVersion' };
    default:
      return null;
  }
}

export const EVIDENCE_MESSAGE = {
  en: 'A Proposal needs evidence: add the register entry, a document or a Family account as a Citation.',
  cs: 'Návrh potřebuje doklad: přidejte zápis z matriky, dokument nebo rodinné vyprávění jako citaci.',
} as const;

/** True when the operations carry at least one Citation (proposals spec, "Evidence is required"). */
export function hasEvidence(ops: readonly Operation[]): boolean {
  return ops.some((o) => isCitationOperation(o.op));
}

export interface ProposalCheck {
  operations: Operation[];
  issues: ProposalIssue[];
}

const opNameOf = (value: unknown): unknown => (typeof value === 'object' && value !== null && 'op' in value ? value.op : undefined);
const tempIdOf = (op: Operation): string | undefined => ('tempId' in op ? op.tempId : undefined);

/** One parsed operation in context: who may use it, and its temporary ids (recorded in `temps`). */
function checkOne(op: Operation, position: number, options: CheckOptions, temps: Map<string, TempKind>): ProposalIssue[] {
  const refused = serverOnly(op.op, options);
  if (refused) return [{ code: 'not_allowed', position, message: `operation ${position + 1}: ${refused}` }];
  if (EDITOR_ONLY_OPERATIONS.includes(op.op) && !options.editor)
    return [{ code: 'not_allowed', position, message: `operation ${position + 1}: only Editors merge Persons` }];
  const issues: ProposalIssue[] = [];
  for (const r of referencesOf(op)) {
    if (!isTempId(r.ref)) continue;
    const kind = temps.get(r.ref);
    if (kind === undefined)
      issues.push({ code: 'temp_id', position, path: [r.path], message: `operation ${position + 1}: ${r.ref} is not created before it is used` });
    else if (kind !== r.kind)
      issues.push({ code: 'temp_id', position, path: [r.path], message: `operation ${position + 1}: ${r.ref} is a ${kind}, not a ${r.kind}` });
  }
  if (op.op === 'setField' && Object.keys(op.set).length === 0)
    issues.push({ code: 'invalid_operation', position, path: ['set'], message: `operation ${position + 1} (setField): set at least one field` });
  const target = baseTargetOf(op);
  if (target && target.baseVersion === undefined)
    issues.push({
      code: 'invalid_operation',
      position,
      path: [target.path],
      message: `operation ${position + 1} (${op.op}): name the version of the ${target.record} you saw (baseVersion)`,
    });
  const creates = CREATES[op.op];
  const tempId = tempIdOf(op);
  if (creates && tempId) {
    if (temps.has(tempId)) issues.push({ code: 'temp_id', position, path: ['tempId'], message: `operation ${position + 1}: ${tempId} is created twice` });
    temps.set(tempId, creates);
  }
  return issues;
}

/**
 * Parses and checks a whole list of operations: each against its schema, temporary ids
 * defined once and before use with the right kind, base versions present, who may use
 * which operation, and the evidence rule (satisfiesEvidenceRule in rules.ts).
 */
export function checkOperations(raw: readonly unknown[], options: CheckOptions): ProposalCheck {
  const issues: ProposalIssue[] = [];
  const operations: Operation[] = [];
  const temps = new Map<string, TempKind>();
  raw.forEach((value, position) => {
    const name = opNameOf(value);
    if (typeof name !== 'string' || !(OPERATION_NAMES as string[]).includes(name)) {
      issues.push({ code: 'unknown_operation', position, message: `operation ${position + 1}: unknown operation ${JSON.stringify(name ?? null)}` });
      return;
    }
    const parsed = Operation.safeParse(value);
    if (!parsed.success) {
      for (const i of parsed.error.issues)
        issues.push({
          code: 'invalid_operation',
          position,
          path: issuePath(i.path),
          message: `operation ${position + 1} (${name}) ${i.path.join('.')}: ${i.message}`,
        });
      return;
    }
    const found = checkOne(parsed.data, position, options, temps);
    issues.push(...found);
    if (found.some((i) => i.code === 'not_allowed')) return;
    operations.push(parsed.data);
  });
  if (issues.length === 0 && !satisfiesEvidenceRule(operations.map((o) => o.op))) issues.push({ code: 'evidence_missing', message: EVIDENCE_MESSAGE.en });
  return { operations, issues };
}
