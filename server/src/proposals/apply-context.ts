import { isTempId, type Operation, type RestorableTable } from '@rodokmen/shared';
import { ApiProblem } from '../auth/problem.js';
import type { Db } from '../db/db.js';
import { snapshot, type ChangeSet, type Rows } from './records.js';

/** An operation based on a version of a record that is no longer current. */
export class ConflictProblem extends ApiProblem {
  constructor(
    readonly position: number,
    what: string,
  ) {
    super(409, 'conflict', `Operation ${position + 1}: ${what} was changed since the Proposal was written. Choose per field before accepting.`);
  }
}

export interface UploadMove {
  uploadId: string;
  imageId: string;
  from: { original: string; display: string };
  to: { original: string; display: string };
}

export interface ApplyResult {
  changes: ChangeSet;
  temps: Map<string, string>;
  citationIds: string[];
  uploads: UploadMove[];
}

/** What applying one Proposal keeps track of. */
export interface Ctx {
  db: Db;
  rows: Rows;
  changes: ChangeSet;
  temps: Map<string, string>;
  citations: Set<string>;
  uploads: UploadMove[];
  proposalId: string;
  authorId: string;
}

/** The id of a record: existing, or created earlier in this Proposal. */
export function ref(ctx: Ctx, value: string): string {
  if (!isTempId(value)) return value;
  const id = ctx.temps.get(value);
  if (!id) throw new ApiProblem(400, 'invalid_proposal', `${value} is used before it is created.`);
  return id;
}

/** Checks that the record exists and still has the version the Member saw. */
export async function checkBase(ctx: Ctx, position: number, name: RestorableTable, id: string, baseVersion: number | null | undefined, what: string) {
  const current = await snapshot(ctx.db, name, id);
  if (!current) throw new ApiProblem(409, 'record_missing', `Operation ${position + 1}: ${what} no longer exists.`);
  if (name === 'person' && current.merged_into_id)
    throw new ApiProblem(409, 'person_merged', `Operation ${position + 1}: this Person was merged into another; propose against the remaining Person.`);
  if (baseVersion === undefined || baseVersion === null) return current;
  const start = ctx.changes.startVersion(name, id);
  const seen = start === undefined ? current.version : start;
  if (seen !== baseVersion) throw new ConflictProblem(position, what);
  return current;
}

export type Op<K extends Operation['op']> = Extract<Operation, { op: K }>;
