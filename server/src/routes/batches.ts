import {
  AcceptBatchBody,
  AcceptBatchResult,
  ApiError,
  BatchList,
  BatchProposalsQuery,
  BatchView,
  CreateBatchBody,
  CreateUploadBody,
  IdParams,
  ImportMap,
  ImportMapQuery,
  ProposalList,
  ProposalView,
  PutImportMapBody,
  RateLimited,
  SubmitProposalBody,
  UploadTicket,
  UploadView,
} from '@rodokmen/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { ApiProblem } from '../auth/problem.js';
import type { Account } from '../db/types.js';
import { acceptBatch } from '../proposals/accept-batch.js';
import { batchViews } from '../proposals/batches.js';
import { submitProposal, type ProposalDeps } from '../proposals/service.js';
import { canReview, proposalViews } from '../proposals/views.js';
import { completeUpload, createUpload } from './uploads.js';

const signedIn = { 401: ApiError, 429: RateLimited };
const UploadParams = z.object({ id: IdParams.shape.id, uploadId: IdParams.shape.id });

/**
 * Import batches (review spec, "Proposals in an Import batch build on each other", "Accept a whole
 * Import batch", "Batch view in the review queue") and the Vault importer's id map (vault-import
 * spec, "Re-runs submit only what is new"). An Agent's requests here count against its batch
 * window (agent-access spec, "Import batches have their own limit").
 */
export async function batchRoutes(fastify: FastifyInstance, deps: ProposalDeps) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { db } = deps;

  /** The batch, when the Member may see it: its author, or an Editor. */
  const visibleBatch = async (member: Account, id: string): Promise<BatchView> => {
    const [batch] = await batchViews(db, { id });
    if (!batch || (batch.author.id !== member.id && !canReview(member))) throw new ApiProblem(404, 'not_found', 'No Import batch with this id.');
    return batch;
  };

  app.post('/api/batches', {
    config: { action: 'propose', agentLimit: 'batch' },
    schema: {
      tags: ['Import batches'],
      summary: 'Open an Import batch: the Proposals one run of the Vault importer submits together',
      body: CreateBatchBody,
      response: { 201: BatchView, 400: ApiError, ...signedIn },
    },
    handler: async (req, reply) => {
      const row = await db
        .insertInto('import_batch')
        .values({ name: req.body.name, author_id: req.member!.id, vault_commit: req.body.vaultCommit, note: req.body.note })
        .returning('id')
        .executeTakeFirstOrThrow();
      reply.code(201);
      return (await batchViews(db, { id: row.id }))[0]!;
    },
  });

  app.get('/api/batches', {
    schema: {
      tags: ['Import batches'],
      summary: "Import batches with their progress, newest first: everyone's for Editors, your own otherwise",
      response: { 200: BatchList, ...signedIn },
    },
    handler: async (req) => ({ items: await batchViews(db, canReview(req.member!) ? {} : { authorId: req.member!.id }) }),
  });

  app.get('/api/batches/:id', {
    schema: {
      tags: ['Import batches'],
      summary: 'An Import batch with its progress: accepted, pending, blocked and rejected',
      params: IdParams,
      response: { 200: BatchView, 404: ApiError, ...signedIn },
    },
    handler: async (req) => visibleBatch(req.member!, req.params.id),
  });

  app.get('/api/batches/:id/proposals', {
    config: { action: 'review' },
    schema: {
      tags: ['Import batches'],
      summary: 'The Proposals of an Import batch in batch order, or a random sample of its pending ones for spot-checking (Editors only)',
      params: IdParams,
      querystring: BatchProposalsQuery,
      response: { 200: ProposalList, 404: ApiError, 401: ApiError, 403: ApiError },
    },
    handler: async (req) => {
      const batch = await visibleBatch(req.member!, req.params.id);
      const inBatch = db.selectFrom('proposal').where('batch_id', '=', batch.id);
      const rows = req.query.sample
        ? await inBatch
            .selectAll()
            .where('status', '=', 'pending')
            .orderBy(sql`random()`)
            .limit(req.query.sample)
            .execute()
        : await inBatch.selectAll().orderBy('batch_position').limit(req.query.limit).offset(req.query.offset).execute();
      return { items: await proposalViews(db, rows), total: batch.counts.total };
    },
  });

  app.post('/api/batches/:id/proposals', {
    config: { action: 'propose', agentLimit: 'batch' },
    schema: {
      tags: ['Import batches'],
      summary:
        'Submit a Proposal into your Import batch, after the ones before it. It may refer to records earlier Proposals of the batch create, as batch:<proposal id>/tmp:x',
      params: IdParams,
      body: SubmitProposalBody,
      response: { 200: ProposalView, 201: ProposalView, 400: ApiError, 403: ApiError, 404: ApiError, 409: ApiError, ...signedIn },
    },
    handler: async (req, reply) => {
      const { view, created } = await submitProposal(deps, req.member!, req.body, req.params.id);
      reply.code(created ? 201 : 200);
      return view;
    },
  });

  app.post('/api/batches/:id/accept', {
    config: { action: 'acceptBatch' },
    schema: {
      tags: ['Import batches'],
      summary:
        'Accept every pending Proposal of an Import batch in batch order (Owner only). Each is accepted on its own; those that fail, and those building on them, stay pending and are listed',
      params: IdParams,
      body: AcceptBatchBody,
      response: { 200: AcceptBatchResult, 404: ApiError, 409: ApiError, 401: ApiError, 403: ApiError },
    },
    handler: async (req) => acceptBatch(deps, req.member!, req.params.id, req.body),
  });

  // ---------------------------------------------------------------- uploads of a batch

  const ownBatch = async (member: Account, id: string) => {
    const batch = await db.selectFrom('import_batch').select('author_id').where('id', '=', id).executeTakeFirst();
    if (!batch || batch.author_id !== member.id) throw new ApiProblem(404, 'not_found', 'No Import batch of yours with this id.');
  };

  app.post('/api/batches/:id/uploads', {
    config: { action: 'propose', agentLimit: 'batch' },
    schema: {
      tags: ['Import batches'],
      summary: 'Start an upload for a Proposal of your Import batch, as POST /api/uploads',
      params: IdParams,
      body: CreateUploadBody,
      response: { 201: UploadTicket, 400: ApiError, 404: ApiError, 413: ApiError, ...signedIn },
    },
    handler: async (req, reply) => {
      await ownBatch(req.member!, req.params.id);
      reply.code(201);
      return createUpload(deps, req.member!, req.body);
    },
  });

  app.post('/api/batches/:id/uploads/:uploadId/complete', {
    config: { action: 'propose', agentLimit: 'batch' },
    schema: {
      tags: ['Import batches'],
      summary: 'Finish an upload for a Proposal of your Import batch, as POST /api/uploads/{id}/complete',
      params: UploadParams,
      response: { 200: UploadView, 400: ApiError, 404: ApiError, 409: ApiError, 413: ApiError, 415: ApiError, ...signedIn },
    },
    handler: async (req) => {
      await ownBatch(req.member!, req.params.id);
      return completeUpload(deps, req.member!, req.params.uploadId);
    },
  });

  // ---------------------------------------------------------------- the importer's id map

  app.get('/api/import-map', {
    config: { agentLimit: 'batch' },
    schema: {
      tags: ['Import batches'],
      summary: "The Vault importer's map from Vault keys to what it submitted and the records in the Tree, by key",
      querystring: ImportMapQuery,
      response: { 200: ImportMap, 400: ApiError, ...signedIn },
    },
    handler: async (req) => {
      let q = db
        .selectFrom('vault_import_map as m')
        .leftJoin('proposal as p', 'p.id', 'm.proposal_id')
        .leftJoin('proposal_temp as t', (j) => j.onRef('t.proposal_id', '=', 'm.proposal_id').onRef('t.temp_id', '=', 'm.temp_id'))
        .select([
          'm.key',
          'm.kind',
          'm.note_hash',
          'm.batch_id',
          'm.proposal_id',
          'm.temp_id',
          'p.status',
          sql<string | null>`coalesce(m.record_id, t.record_id)`.as('record_id'),
        ]);
      if (req.query.after !== undefined) q = q.where('m.key', '>', req.query.after);
      const rows = await q
        .orderBy('m.key')
        .limit(req.query.limit + 1)
        .execute();
      const page = rows.slice(0, req.query.limit);
      return {
        entries: page.map((r) => ({
          key: r.key,
          kind: r.kind,
          noteHash: r.note_hash,
          batchId: r.batch_id,
          proposalId: r.proposal_id,
          tempId: r.temp_id,
          recordId: r.record_id,
          proposalStatus: r.status,
        })),
        next: rows.length > req.query.limit ? (page.at(-1)?.key ?? null) : null,
      };
    },
  });

  app.put('/api/import-map', {
    config: { action: 'propose', agentLimit: 'batch' },
    schema: {
      tags: ['Import batches'],
      summary: "Record entries of the Vault importer's id map, by key, for your own Import batches",
      body: PutImportMapBody,
      response: { 200: z.object({ stored: z.number().int() }), 400: ApiError, 403: ApiError, ...signedIn },
    },
    handler: async (req) => {
      const batchIds = [...new Set(req.body.entries.map((e) => e.batchId))];
      const own = await db.selectFrom('import_batch').select('id').where('id', 'in', batchIds).where('author_id', '=', req.member!.id).execute();
      if (own.length !== batchIds.length) throw new ApiProblem(403, 'forbidden', 'Entries are recorded only for Import batches you opened.');
      // One entry per key: the last one given wins.
      const values = [...new Map(req.body.entries.map((e) => [e.key, e])).values()].map((e) => ({
        key: e.key,
        kind: e.kind,
        note_hash: e.noteHash,
        batch_id: e.batchId,
        proposal_id: e.proposalId,
        temp_id: e.tempId,
        record_id: e.recordId,
      }));
      await db
        .insertInto('vault_import_map')
        .values(values)
        .onConflict((oc) =>
          oc.column('key').doUpdateSet((eb) => ({
            kind: eb.ref('excluded.kind'),
            note_hash: eb.ref('excluded.note_hash'),
            batch_id: eb.ref('excluded.batch_id'),
            proposal_id: eb.ref('excluded.proposal_id'),
            temp_id: eb.ref('excluded.temp_id'),
            record_id: eb.ref('excluded.record_id'),
            updated_at: sql`now()`,
          })),
        )
        .execute();
      return { stored: values.length };
    },
  });
}
