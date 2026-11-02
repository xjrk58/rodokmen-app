import type { Confidence } from '@rodokmen/shared';
import type { Issue, IssueKind } from './reader.js';

/**
 * What the importer plans to submit, before it knows any id of the Tree. Every record it creates
 * has a stable key derived from the Vault (`person:jan-novak-1801`, `event:jan-novak-1801:baptism`,
 * `family:anna-x+tomas-y` …); an operation refers to another record by `@key`. When the plan is
 * submitted, each key becomes a temporary id in the same Proposal, a batch reference to an earlier
 * Proposal of the batch, or the id of a record an earlier run imported (resolve.ts).
 */

/** A reference to a planned record, as written in a planned operation. */
export const at = (key: string): string => `@${key}`;
export const isAt = (value: unknown): value is string => typeof value === 'string' && value.startsWith('@');

export interface PlannedOp {
  /** The operation, with `@key` where it creates (tempId) or refers to a planned record. */
  op: Record<string, unknown> & { op: string };
  /** The key of what it creates or links, so that a re-run skips what is already imported. */
  key: string;
  /** A hash of what the operation says, to tell a changed record on a re-run. */
  value?: string;
}

/** A file to upload before the Proposal that uses it is submitted. */
export interface PlannedFile {
  /** Relative to the Vault. */
  path: string;
  type: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | 'application/msword';
  /** A DOC is converted to PDF first; the PDF goes up under this key, the DOC as the original. */
  convertedKey?: string;
}

export type ProposalKind = 'vault' | 'place' | 'parish' | 'house' | 'register' | 'source' | 'person';

export interface PlannedProposal {
  key: string;
  kind: ProposalKind;
  /** What the Proposal is, for the reviewing Owner: the note it comes from. */
  note: string;
  /** The note it comes from, and its hash. */
  path: string | null;
  hash: string | null;
  ops: PlannedOp[];
  files: PlannedFile[];
}

export interface PlannedSearch {
  registerKey: string | null;
  archive: string | null;
  years: { from: number; to: number } | null;
  pages: string | null;
  searchedOn: string;
  searchedBy: string;
  found: boolean;
  note: string;
}

/** A Research lead from plans/ or log/ (vault-import spec, "Research logs and plans become Research leads"). */
export interface PlannedLead {
  key: string;
  path: string;
  hash: string;
  question: string;
  reason: string;
  personKeys: string[];
  placeKeys: string[];
  status: 'open' | 'found' | 'not_found';
  searches: PlannedSearch[];
}

export interface Plan {
  proposals: PlannedProposal[];
  leads: PlannedLead[];
  issues: Issue[];
  /** What the Vault says against what the Tree will compute, for the report. */
  comparisons: { living: number; relation: number };
  /** Records to create, by kind of record. */
  records: Record<string, number>;
}

export const CONFIDENCE_OF: Record<string, Confidence> = { confirmed: 'high', probable: 'normal', hypothesis: 'low' };
const ORDER: Confidence[] = ['very_low', 'low', 'normal', 'high', 'very_high'];
/** The lower of two confidences (vault-import spec, "Confidence is carried over": the lowest wins). */
export const lowest = (a: Confidence, b: Confidence): Confidence => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);

/** Builds the Proposals of a plan in order, and collects what the dry run reports. */
export class PlanBuilder {
  readonly proposals: PlannedProposal[] = [];
  readonly issues: Issue[] = [];
  readonly records = new Map<string, number>();
  /** Every key planned so far, with the Proposal that creates it. */
  private readonly created = new Map<string, PlannedProposal>();

  proposal(kind: ProposalKind, key: string, note: string, source: { path: string; hash: string } | null): PlannedProposal {
    const p: PlannedProposal = { key, kind, note, path: source?.path ?? null, hash: source?.hash ?? null, ops: [], files: [] };
    this.proposals.push(p);
    return p;
  }

  /** Whether a key is planned already (in this Proposal or an earlier one). */
  has(key: string): boolean {
    return this.created.has(key);
  }

  /** Adds an operation that creates the record `key`; does nothing when it is planned already. */
  create(p: PlannedProposal, key: string, kind: string, op: Record<string, unknown> & { op: string }): boolean {
    if (this.created.has(key)) return false;
    this.created.set(key, p);
    this.records.set(kind, (this.records.get(kind) ?? 0) + 1);
    p.ops.push({ op: { ...op, ...('tempId' in op ? { tempId: at(key) } : {}) }, key, value: JSON.stringify(op) });
    return true;
  }

  /** Adds an operation that links or changes records, once per key. */
  link(p: PlannedProposal, key: string, kind: string, op: Record<string, unknown> & { op: string }): boolean {
    return this.create(p, key, kind, op);
  }

  report(kind: IssueKind, path: string, detail: string): void {
    this.issues.push({ kind, path, detail });
  }
}
