import type { ImportMapView } from '@rodokmen/shared';
import { isAt, type PlannedProposal } from './plan.js';

/**
 * Turns a planned Proposal into the operations to submit (design, "Proposal order and batch-scoped
 * references", "Id map and re-runs"): a key the Proposal creates becomes a temporary id; a key an
 * earlier Proposal of this run creates, a batch reference; a key an earlier run imported, its
 * record in the Tree. What an earlier run imported is left out, so a re-run submits only what is
 * new, and never a second record for the same key.
 */
export interface RunState {
  /** The importer's map on the server, by key. */
  map: Map<string, ImportMapView>;
  /** What this run submitted: key → its Proposal and temporary id there. */
  submitted: Map<string, { proposalId: string; tempId: string | null }>;
  /** Uploaded files: Vault path (or path.pdf for a converted DOC) → upload id. */
  uploads: Map<string, string>;
}

export interface Resolved {
  ops: Array<Record<string, unknown> & { op: string }>;
  /** The keys of the operations submitted, with the temporary id of those that create a record. */
  entries: Array<{ key: string; kind: string; value: string | null; tempId: string | null }>;
}

export type Resolution = { kind: 'submit'; resolved: Resolved } | { kind: 'nothing' } | { kind: 'deferred'; reason: string };

const CITATION_OPS = new Set(['createCitation', 'attachCitation']);
const FACT_FREE = new Set(['setNotes', 'addLabel', 'removeLabel']);

/** Whether a key was imported before (pending or accepted; a rejected one is offered again). */
export function imported(state: RunState, key: string): boolean {
  const m = state.map.get(key);
  return m !== undefined && m.proposalStatus !== 'rejected';
}

/** The record kind a key names, from its prefix. */
export const kindOf = (key: string) => key.split(':')[0]!;

export function resolveProposal(p: PlannedProposal, state: RunState): Resolution {
  const temps = new Map<string, string>();
  const entries: Resolved['entries'] = [];
  const ops: Resolved['ops'] = [];
  let missing: string | null = null;
  const ref = (key: string): string => {
    const own = temps.get(key);
    if (own) return own;
    if (key.startsWith('upload:')) return state.uploads.get(key.slice('upload:'.length)) ?? ((missing ??= `the file ${key.slice(7)} is not uploaded`), key);
    const run = state.submitted.get(key);
    if (run?.tempId) return `batch:${run.proposalId}/${run.tempId}`;
    const before = state.map.get(key);
    if (before?.recordId) return before.recordId;
    missing ??= before ? `${key} waits for an earlier Import batch to be accepted` : `${key} is not imported`;
    return key;
  };
  const walk = (v: unknown): unknown => {
    if (isAt(v)) return ref(v.slice(1));
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return walkRecord(Object.entries(v));
    return v;
  };
  const walkRecord = (entries: Array<[string, unknown]>): Record<string, unknown> => Object.fromEntries(entries.map(([k, x]) => [k, walk(x)]));
  let n = 0;
  for (const planned of p.ops) {
    if (imported(state, planned.key) || state.submitted.has(planned.key)) continue;
    const creates = 'tempId' in planned.op;
    const tempId = creates ? `tmp:k${++n}` : null;
    if (tempId) temps.set(planned.key, tempId);
    const op = { ...walkRecord(Object.entries({ ...planned.op, ...(tempId ? { tempId } : {}) })), op: planned.op.op };
    ops.push(op);
    entries.push({ key: planned.key, kind: kindOf(planned.key), value: planned.value ?? null, tempId });
  }
  if (missing) return { kind: 'deferred', reason: missing };
  const facts = ops.filter((o) => !CITATION_OPS.has(o.op) && !FACT_FREE.has(o.op));
  if (facts.length === 0 && !ops.some((o) => FACT_FREE.has(o.op))) return { kind: 'nothing' };
  return { kind: 'submit', resolved: { ops, entries } };
}
