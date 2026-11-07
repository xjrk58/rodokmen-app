import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import {
  baseTargetOf,
  BatchView,
  FamilyRootList,
  Operation,
  OPERATIONS_VERSION,
  ProposalView,
  UploadTicket,
  UploadView,
  type ImportMapEntry,
} from '@rodokmen/shared';
import { z } from 'zod';
import { ApiError, apiClient, loadMap, sha256, type Client } from './client.js';
import { mapVault } from './mapper.js';
import type { Municipality } from './map-places.js';
import type { Plan, PlannedFile, PlannedLead } from './plan.js';
import { readVault, type Vault } from './reader.js';
import { countsOf, reportMarkdown, type Counts, type RunSummary } from './report.js';
import { imported, resolveProposal, type RunState } from './resolve.js';

/**
 * One run of the Vault importer (vault-import spec): read the Vault, map it, and either report
 * (the dry run, which sends nothing but reads) or submit one Import batch with an Agent token,
 * uploading scans and documents, keeping the id map, and creating the Research leads whose
 * Persons and Places are in the Tree. A second run submits only what is new or changed.
 */
export interface ImportOptions {
  vault: string;
  url: string;
  token: string;
  dryRun: boolean;
  /** The batch's name; "Vault import <day>" when left out. */
  name?: string;
  givenBy: string;
  /** Family roots by Vault id, besides those marked in the Tree. */
  roots: string[];
  municipalities: Municipality[];
  today: Date;
  /** Converts a DOC to PDF in a folder, returning the PDF's path; LibreOffice by default. */
  convert?: (doc: string, outDir: string) => Promise<string>;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

export interface ImportResult {
  vault: Vault;
  plan: Plan;
  run: RunSummary;
  counts: Counts;
  report: string;
}

/** LibreOffice, once per DOC, on the Owner's machine (design, "Files"). */
export async function libreOfficeConvert(doc: string, outDir: string): Promise<string> {
  await promisify(execFile)('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', outDir, doc], { timeout: 120_000 });
  return join(outDir, basename(doc).replace(/\.[^.]+$/, '.pdf'));
}

/** The Family roots of the Tree, as Vault ids, through the id map. */
async function rootsInVault(client: Client, state: RunState): Promise<string[]> {
  const roots = FamilyRootList.parse(await client.get('/api/family-roots')).items.map((p) => p.id);
  return [...state.map.values()].filter((e) => e.kind === 'person' && e.recordId && roots.includes(e.recordId)).map((e) => e.key.slice('person:'.length));
}

async function uploadFile(client: Client, batchId: string, bytes: Buffer, contentType: PlannedFile['type']): Promise<string> {
  const ticket = UploadTicket.parse(
    await client.send('POST', `/api/batches/${batchId}/uploads`, { contentType, byteSize: bytes.length, sha256: sha256(bytes) }),
  );
  await client.put(ticket.putUrl, ticket.putHeaders, bytes);
  return UploadView.parse(await client.send('POST', `/api/batches/${batchId}/uploads/${ticket.upload.id}/complete`, {})).id;
}

/** Uploads a Proposal's files (a DOC converted to PDF first); a DOC that cannot be converted is reported and left out. */
async function uploadFiles(options: ImportOptions, client: Client, batchId: string, files: PlannedFile[], state: RunState, plan: Plan): Promise<number> {
  let count = 0;
  for (const f of files) {
    if (state.uploads.has(f.path)) continue;
    const bytes = await readFile(join(options.vault, f.path));
    if (f.convertedKey) {
      const dir = await mkdtemp(join(tmpdir(), 'rodokmen-doc-'));
      try {
        const pdf = await readFile(await (options.convert ?? libreOfficeConvert)(join(options.vault, f.path), dir));
        state.uploads.set(`${f.path}.pdf`, await uploadFile(client, batchId, pdf, 'application/pdf'));
        count++;
      } catch (error) {
        plan.issues.push({
          kind: 'skippedFile',
          path: f.path,
          detail: `could not be converted to PDF (${error instanceof Error ? error.message : String(error)}); LibreOffice (soffice) is needed`,
        });
        continue;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    state.uploads.set(f.path, await uploadFile(client, batchId, bytes, f.type));
    count++;
  }
  return count;
}

const ROUTES: Record<string, string> = {
  person: 'persons',
  event: 'events',
  family: 'families',
  place: 'places',
  house: 'houses',
  parish: 'parishes',
  estate: 'estates',
  source: 'sources',
};
const Versioned = z.object({ version: z.number().int() });

/**
 * On a re-run, an operation may add to a record an earlier run imported (a child to its Family, a
 * Label to a Person): it names the version of that record as the Tree has it now.
 */
async function withBaseVersions(client: Client, ops: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const out = [];
  for (const raw of ops) {
    const target = baseTargetOf(Operation.parse(raw));
    const route = target ? ROUTES[target.record] : undefined;
    if (!target || target.baseVersion !== undefined || !route) {
      out.push(raw);
      continue;
    }
    const { version } = Versioned.parse(await client.get(`/api/${route}/${target.id}`));
    out.push({ ...raw, baseVersion: version });
  }
  return out;
}

/** A lead's Persons, Places and registers in the Tree; null while one is not (yet) there. */
function leadBody(lead: PlannedLead, state: RunState) {
  const id = (key: string) => state.map.get(key)?.recordId ?? null;
  const known = (ids: Array<string | null>) => ids.filter((x): x is string => x !== null);
  const personIds = known(lead.personKeys.map(id));
  const placeIds = known(lead.placeKeys.map(id));
  const searches = lead.searches.map((s) => ({ ...s, sourceId: s.registerKey ? id(s.registerKey) : null }));
  if (personIds.length < lead.personKeys.length || placeIds.length < lead.placeKeys.length || searches.some((s) => s.registerKey && !s.sourceId)) return null;
  return {
    question: lead.question,
    reason: lead.reason,
    personIds: [...new Set(personIds)].slice(0, 50),
    placeIds: [...new Set(placeIds)].slice(0, 50),
    status: lead.status,
    searches: searches.slice(0, 50).map((s) => ({
      sourceId: s.sourceId,
      archive: s.sourceId ? null : s.archive,
      years: s.years,
      pages: s.pages,
      searchedOn: s.searchedOn,
      searchedBy: s.searchedBy,
      found: s.found,
      note: s.note,
    })),
  };
}

/** What the steps of one run share. */
interface Run {
  options: ImportOptions;
  client: Client;
  vault: Vault;
  plan: Plan;
  state: RunState;
  summary: RunSummary;
  /** The run's Import batch, opened when the first thing is submitted. */
  batch: BatchView | null;
}

async function openBatch(r: Run): Promise<BatchView> {
  r.batch ??= BatchView.parse(
    await r.client.send('POST', '/api/batches', {
      name: r.options.name ?? `Vault import ${r.options.today.toISOString().slice(0, 10)}`,
      vaultCommit: r.vault.commit?.sha ?? null,
      note: null,
    }),
  );
  return r.batch;
}

/** Records entries of the id map on the server, 2,000 at a time. */
async function record(r: Run, entries: ImportMapEntry[]): Promise<void> {
  for (let i = 0; i < entries.length; i += 2000) await r.client.send('PUT', '/api/import-map', { entries: entries.slice(i, i + 2000) });
}

/** Submits one planned Proposal into the run's batch, with its files, and records what it creates. */
async function submit(r: Run, p: Plan['proposals'][number], index: number): Promise<void> {
  const b = await openBatch(r);
  r.summary.uploads += await uploadFiles(r.options, r.client, b.id, p.files, r.state, r.plan);
  const resolution = resolveProposal(p, r.state);
  if (resolution.kind !== 'submit') return;
  const view = ProposalView.parse(
    await r.client.send('POST', `/api/batches/${b.id}/proposals`, {
      formatVersion: OPERATIONS_VERSION,
      idempotencyKey: `vault-${b.id.slice(-12)}-${index}`,
      note: p.note,
      operations: await withBaseVersions(r.client, resolution.resolved.ops),
    }),
  );
  r.summary.submitted++;
  for (const e of resolution.resolved.entries) r.state.submitted.set(e.key, { proposalId: view.id, tempId: e.tempId });
  const entry = (key: string, kind: string, noteHash: string | null, tempId: string | null) => ({
    key,
    kind,
    noteHash,
    batchId: b.id,
    proposalId: view.id,
    tempId,
    recordId: null,
  });
  await record(r, [
    ...resolution.resolved.entries.map((e) => entry(e.key, e.kind, e.value === null ? null : sha256(Buffer.from(e.value)), e.tempId)),
    ...(p.path ? [entry(`note:${p.path}`, 'note', p.hash, null)] : []),
  ]);
  if (r.summary.submitted % 50 === 0) r.options.log?.(`submitted ${r.summary.submitted} Proposals`);
}

/** Every planned Proposal in order: left out when already imported, held back when it waits for another batch, else submitted (or counted, in a dry run). */
async function proposals(r: Run): Promise<void> {
  for (const [index, p] of r.plan.proposals.entries()) {
    // Whether there is anything to submit is decided as if the files were uploaded; they are uploaded only then.
    const placeholders = p.files.flatMap((f) => (f.convertedKey ? [f.path, `${f.path}.pdf`] : [f.path])).filter((path) => !r.state.uploads.has(path));
    for (const path of placeholders) r.state.uploads.set(path, `upload-${path}`);
    const first = resolveProposal(p, r.state);
    if (first.kind === 'nothing') r.summary.unchanged++;
    else if (first.kind === 'deferred') r.summary.deferred.push({ key: p.key, reason: first.reason });
    else if (r.options.dryRun) {
      for (const e of first.resolved.entries) r.state.submitted.set(e.key, { proposalId: `dry-${index}`, tempId: e.tempId });
      r.summary.submitted++;
    } else {
      for (const path of placeholders) r.state.uploads.delete(path);
      await submit(r, p, index);
    }
  }
}

const NotesOf = z.object({ version: z.number().int(), notes: z.string().nullable() });

/**
 * What an importer before #134 wrote without the fields the Tree has no place for (plan.updates).
 * A record this run creates, or a run since #134 created, has them already. Research notes that
 * still hold exactly what the earlier run wrote get them, each in a Proposal of its own with the
 * version read, so a change made after this run is a conflict for the Owner to resolve. Notes
 * changed in the app since are left alone and listed, and so are register entries' Citation notes:
 * a Proposal that changes a Citation's note needs new evidence, which the importer does not have.
 */
async function updates(r: Run): Promise<void> {
  const planned = new Map(r.plan.proposals.flatMap((p) => p.ops.map((o) => [o.key, o.value] as const)));
  for (const [index, u] of r.plan.updates.entries()) {
    if (r.state.submitted.has(u.freshKey)) continue;
    const fresh = r.state.map.get(u.freshKey);
    const value = planned.get(u.freshKey);
    if (fresh && value !== undefined && fresh.noteHash === sha256(Buffer.from(value))) continue;
    const before = r.state.map.get(u.recordKey);
    if (!before || !imported(r.state, u.recordKey) || imported(r.state, u.key)) continue;
    if (!before.recordId) {
      r.summary.deferred.push({ key: u.key, reason: `${u.recordKey} waits for an earlier Import batch to be accepted` });
      continue;
    }
    if (u.record === 'citation') {
      r.summary.updates.notUpdated.push({ path: u.path, lines: u.lines, why: 'citation' });
      continue;
    }
    const current = NotesOf.parse(await r.client.get(`/api/${ROUTES[u.record]}/${before.recordId}`));
    if (current.notes === u.after) continue;
    if (current.notes !== u.before) {
      r.summary.updates.notUpdated.push({ path: u.path, lines: u.lines, why: 'changed' });
      continue;
    }
    r.summary.updates.added++;
    if (r.options.dryRun) {
      r.summary.submitted++;
      continue;
    }
    const b = await openBatch(r);
    const view = ProposalView.parse(
      await r.client.send('POST', `/api/batches/${b.id}/proposals`, {
        formatVersion: OPERATIONS_VERSION,
        idempotencyKey: `vault-${b.id.slice(-12)}-u${index}`,
        note: `Vault: ${u.path} (fields the Tree has no place for)`,
        operations: [{ op: 'setNotes', record: u.record, id: before.recordId, baseVersion: current.version, notes: u.after }],
      }),
    );
    r.summary.submitted++;
    await record(r, [{ key: u.key, kind: 'notes', noteHash: sha256(Buffer.from(u.after)), batchId: b.id, proposalId: view.id, tempId: null, recordId: null }]);
  }
}

const LeadReason = z.object({ version: z.number().int(), reason: z.string() });

/**
 * A lead an importer before #136 created from a long note holds its first 4,000 characters. It gets
 * the whole note when it still holds exactly what that run wrote, at the version read; a lead
 * changed since in the app is listed for the Owner instead. Returns whether it was updated.
 */
async function wholeReason(r: Run, lead: PlannedLead): Promise<boolean> {
  const id = r.state.map.get(lead.key)?.recordId;
  if (!id || lead.earlierReason === null) return false;
  const current = LeadReason.parse(await r.client.get(`/api/leads/${id}`));
  if (current.reason === lead.reason) return false;
  if (current.reason !== lead.earlierReason) {
    r.summary.leads.notUpdated.push(lead.path);
    return false;
  }
  try {
    if (!r.options.dryRun) await r.client.send('PATCH', `/api/leads/${id}`, { baseVersion: current.version, reason: lead.reason });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    r.summary.leads.notUpdated.push(lead.path);
    return false;
  }
  r.summary.leads.updated++;
  return true;
}

/** Research leads need their Persons and Places in the Tree: they are created once the batch is accepted (a later run). */
async function leads(r: Run): Promise<void> {
  for (const lead of r.plan.leads) {
    if (imported(r.state, lead.key)) {
      if (!(await wholeReason(r, lead))) r.summary.leads.unchanged++;
      continue;
    }
    const body = leadBody(lead, r.state);
    if (!body) r.summary.leads.waiting++;
    if (!body || r.options.dryRun) continue;
    const created = z.object({ id: z.string() }).parse(await r.client.send('POST', '/api/leads', body));
    await record(r, [
      { key: lead.key, kind: 'lead', noteHash: lead.hash, batchId: (await openBatch(r)).id, proposalId: null, tempId: null, recordId: created.id },
    ]);
    r.summary.leads.created++;
  }
}

export async function runImport(options: ImportOptions): Promise<ImportResult> {
  const client = apiClient(options.url, options.token, options.fetch);
  const vault = await readVault(options.vault);
  const state: RunState = { map: await loadMap(client), submitted: new Map(), uploads: new Map() };
  const roots = [...new Set([...options.roots, ...(await rootsInVault(client, state))])];
  const plan = await mapVault(vault, { municipalities: options.municipalities, givenBy: options.givenBy, roots, today: options.today });
  const summary: RunSummary = {
    dryRun: options.dryRun,
    batch: null,
    submitted: 0,
    unchanged: 0,
    deferred: [],
    uploads: 0,
    leads: { created: 0, waiting: 0, unchanged: 0, updated: 0, notUpdated: [] },
    changed: { updated: 0, notUpdated: [] },
    duplicateMarriages: [],
    updates: { added: 0, notUpdated: [] },
  };
  // Notes changed since the run that imported them: their new records come as new keys; the rest is listed.
  for (const p of plan.proposals) {
    const before = p.path ? state.map.get(`note:${p.path}`) : undefined;
    if (p.path && before && before.noteHash !== p.hash) summary.changed.notUpdated.push(p.path);
  }
  // Marriages an earlier importer gave two Events (#149): both are in the Tree, and stay there.
  for (const m of plan.mergedMarriages)
    if (imported(state, m.key) && imported(state, m.earlierKey))
      summary.duplicateMarriages.push({ paths: m.paths, keep: state.map.get(m.key)?.recordId ?? null, other: state.map.get(m.earlierKey)?.recordId ?? null });
  const r: Run = { options, client, vault, plan, state, summary, batch: null };
  await proposals(r);
  await updates(r);
  await leads(r);
  summary.batch = r.batch ? { id: r.batch.id, name: r.batch.name } : null;
  return { vault, plan, run: summary, counts: countsOf(vault, plan), report: reportMarkdown(vault, plan, summary) };
}
