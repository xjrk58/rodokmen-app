/**
 * The check of a whole list of operations before a Proposal is stored (proposals spec): each
 * against its schema, temporary ids defined once and before use with the right kind, base
 * versions present, who may use which operation, and the evidence rule.
 */
import { isCitationOperation, satisfiesEvidenceRule } from '../rules.js';
import { isPlaceOrNoteOperation, placeReferencesOf } from './place-operations.js';
import { EDITOR_ONLY_OPERATIONS, Operation, OPERATION_NAMES, type OperationName, type SettableRecord } from './proposals.js';
import { isNewRef, isTempId } from './refs.js';
import { serverOnly, type CheckOptions } from './server-operations.js';

/** A Zod issue path as plain keys and indexes (Zod allows symbols, which JSON cannot carry). */
const issuePath = (path: readonly PropertyKey[]): Array<string | number> => path.map((p) => (typeof p === 'symbol' ? String(p) : p));

export interface ProposalIssue {
  code: 'invalid_operation' | 'unknown_operation' | 'not_allowed' | 'temp_id' | 'evidence_missing';
  message: string;
  /** Index of the operation, when the issue is about one. */
  position?: number;
  path?: Array<string | number>;
}

export type TempKind = 'person' | 'name' | 'event' | 'family' | 'source' | 'citation' | 'image' | 'place' | 'house' | 'parish' | 'estate';
/** The kind of record each creating operation gives its temporary id to. */
export const CREATES: Partial<Record<OperationName, TempKind>> = {
  createPerson: 'person',
  addName: 'name',
  createEvent: 'event',
  createFamily: 'family',
  createSource: 'source',
  createCitation: 'citation',
  addImage: 'image',
  createPlace: 'place',
  createHouse: 'house',
  createParish: 'parish',
  createEstate: 'estate',
};

const ref = (r: string | null | undefined, kind: TempKind, path: string) => (r ? [{ ref: r, kind, path }] : []);

/** References each operation makes, with the kind of record each must be. */
export function referencesOf(op: Operation): Array<{ ref: string; kind: TempKind; path: string }> {
  switch (op.op) {
    case 'createEvent':
      return [...ref(op.placeId, 'place', 'placeId'), ...ref(op.houseId, 'house', 'houseId')];
    case 'createSource':
      return ref(op.register?.parishId, 'parish', 'register.parishId');
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
      return isPlaceOrNoteOperation(op) ? placeReferencesOf(op) : [];
  }
}

/** Records an operation may name a base version of. */
export type BaseRecord = 'family' | SettableRecord;

/** The existing record an operation changes and must name a base version for, if any; none for a record not created yet. */
export function baseTargetOf(op: Operation): { record: BaseRecord; id: string; baseVersion: number | undefined; path: string } | null {
  const existing = (record: BaseRecord, id: string, baseVersion: number | undefined) =>
    isNewRef(id) ? null : { record, id, baseVersion, path: 'baseVersion' };
  switch (op.op) {
    case 'addName':
      return existing('person', op.personId, op.baseVersion);
    case 'addRole':
      return existing('event', op.eventId, op.baseVersion);
    case 'linkChild':
      return existing('family', op.familyId, op.baseVersion);
    case 'attachCitation':
      return existing(op.eventId ? 'event' : 'name', op.eventId ?? op.nameId!, op.baseVersion);
    case 'setField':
      return { record: op.record, id: op.id, baseVersion: op.baseVersion, path: 'baseVersion' };
    case 'addPlaceName':
    case 'linkPlaceParish':
    case 'linkPlaceEstate':
      return existing('place', op.placeId, op.baseVersion);
    case 'addHouseNumber':
      return existing('house', op.houseId, op.baseVersion);
    case 'setNotes':
      return existing(op.record, op.id, op.baseVersion);
    case 'addLabel':
    case 'removeLabel':
      return existing('person', op.personId, op.baseVersion);
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
