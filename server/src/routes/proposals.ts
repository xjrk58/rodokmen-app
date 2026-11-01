import {
  AcceptBody,
  ApiError,
  CreateUploadBody,
  History,
  HistoryKind,
  IdParams,
  IMAGE_MAX_BYTES,
  ImageLinkQuery,
  MergeBody,
  NotificationSettings,
  ProposalList,
  ProposalListQuery,
  ProposalView,
  RateLimited,
  RejectBody,
  ReviewQuery,
  SubmitProposalBody,
  UndoBody,
  UndoPreview,
  UploadTicket,
  UploadView,
} from '@rodokmen/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { ApiProblem } from '../auth/problem.js';
import { recordHistory, undoPreview, undoProposal } from '../proposals/history.js';
import { acceptProposal, assertCanSee, getProposalRow, mergePersons, rejectProposal, submitProposal, type ProposalDeps } from '../proposals/service.js';
import { canReview, proposalViews, uploadView } from '../proposals/views.js';
import { imageLink, uploadKeys } from '../storage/images.js';
import { checkUpload, TOO_LARGE_MESSAGE } from '../storage/process.js';

/** Reads and Proposals: Members and Agents, Agents within their hourly limits. */
const signedIn = { 401: ApiError, 429: RateLimited };
const editorOnly = { 401: ApiError, 403: ApiError };
/** Members only: an Agent has no email settings. */
const ownAccount = { 401: ApiError, 403: ApiError };

/**
 * The write path into the Tree (proposals, review, tree-history, evidence-media and
 * notifications specs). Members and Agents submit Proposals; only Editors accept, reject, merge
 * and undo (each route names its action; auth/plugin.ts asks the role-and-action rule).
 */
export async function proposalRoutes(fastify: FastifyInstance, deps: ProposalDeps) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { db } = deps;

  app.post('/api/proposals', {
    // An Agent's submits count against its hourly Proposal limit.
    config: { action: 'propose', agentLimit: 'proposal' },
    schema: {
      tags: ['Proposals'],
      summary:
        'Submit a Proposal: one finding with all its changes and at least one Citation. Retrying with the same idempotency key returns the same Proposal. Editors may apply a direct change at once',
      body: SubmitProposalBody,
      response: { 200: ProposalView, 201: ProposalView, 400: ApiError, 403: ApiError, 409: ApiError, ...signedIn },
    },
    handler: async (req, reply) => {
      const { view, created } = await submitProposal(deps, req.member!, req.body);
      reply.code(created ? 201 : 200);
      return view;
    },
  });

  app.get('/api/proposals', {
    schema: {
      tags: ['Proposals'],
      summary: "Proposals, newest first: your own, or everyone's for Editors",
      querystring: ProposalListQuery,
      response: { 200: ProposalList, 400: ApiError, ...signedIn },
    },
    handler: async (req) => {
      const member = req.member!;
      let q = db.selectFrom('proposal').selectAll();
      if (req.query.mine || !canReview(member)) q = q.where('author_id', '=', member.id);
      if (req.query.status) q = q.where('status', '=', req.query.status);
      const rows = await q.orderBy('submitted_at', 'desc').orderBy('id', 'desc').limit(req.query.limit).execute();
      return { items: await proposalViews(db, rows) };
    },
  });

  app.get('/api/review', {
    config: { action: 'review' },
    schema: {
      tags: ['Review'],
      summary: 'The review queue: pending Proposals, oldest first, with their changes compared with the current Tree (Editors only)',
      querystring: ReviewQuery,
      response: { 200: ProposalList, 400: ApiError, ...editorOnly },
    },
    handler: async (req) => {
      const pending = db.selectFrom('proposal').where('status', '=', 'pending');
      const rows = await pending.selectAll().orderBy('submitted_at').orderBy('id').limit(req.query.limit).offset(req.query.offset).execute();
      const { total } = await pending.select((eb) => eb.fn.countAll<number>().as('total')).executeTakeFirstOrThrow();
      return { items: await proposalViews(db, rows), total };
    },
  });

  app.get('/api/proposals/:id', {
    schema: {
      tags: ['Proposals'],
      summary: 'A Proposal: visible to its author and the Editors only',
      params: IdParams,
      response: { 200: ProposalView, 404: ApiError, ...signedIn },
    },
    handler: async (req) => {
      const p = await getProposalRow(db, req.params.id);
      assertCanSee(req.member!, p);
      return (await proposalViews(db, [p]))[0]!;
    },
  });

  app.post('/api/proposals/:id/accept', {
    config: { action: 'accept' },
    schema: {
      tags: ['Review'],
      summary: 'Accept a Proposal as a whole, optionally after corrections and with per-field choices for conflicts (Editors only)',
      params: IdParams,
      body: AcceptBody,
      response: { 200: ProposalView, 400: ApiError, 404: ApiError, 409: ApiError, ...editorOnly },
    },
    handler: async (req) => acceptProposal(deps, req.member!, req.params.id, req.body),
  });

  app.post('/api/proposals/:id/reject', {
    config: { action: 'reject' },
    schema: {
      tags: ['Review'],
      summary: 'Reject a Proposal as a whole, with a note for the author (Editors only)',
      params: IdParams,
      body: RejectBody,
      response: { 200: ProposalView, 404: ApiError, 409: ApiError, ...editorOnly },
    },
    handler: async (req) => rejectProposal(deps, req.member!, req.params.id, req.body.note),
  });

  app.get('/api/proposals/:id/undo', {
    config: { action: 'undo' },
    schema: {
      tags: ['History'],
      summary: 'What undoing an accepted Proposal involves: records edited again since, field by field (Editors only)',
      params: IdParams,
      response: { 200: UndoPreview, 404: ApiError, 409: ApiError, ...editorOnly },
    },
    handler: async (req) => {
      const p = await getProposalRow(db, req.params.id);
      if (p.status !== 'accepted') throw new ApiProblem(409, 'not_accepted', 'Only an accepted Proposal can be undone.');
      if (p.undone_by_proposal_id) throw new ApiProblem(409, 'already_undone', 'This Proposal was already undone.');
      return { proposalId: p.id, ...(await undoPreview(db, p.id)) };
    },
  });

  app.post('/api/proposals/:id/undo', {
    config: { action: 'undo' },
    schema: {
      tags: ['History'],
      summary: 'Undo an accepted Proposal as a whole, at once and logged; later edits need a choice per field (Editors only)',
      params: IdParams,
      body: UndoBody,
      response: { 200: ProposalView, 404: ApiError, 409: ApiError, ...editorOnly },
    },
    handler: async (req) => undoProposal(deps, req.member!, req.params.id, req.body),
  });

  app.post('/api/persons/:id/merge', {
    config: { action: 'merge' },
    schema: {
      tags: ['Review'],
      summary: 'Merge another Person into this one: Names, Roles, Family links and Citations move here, and the other record redirects (Editors only)',
      params: IdParams,
      body: MergeBody,
      response: { 200: ProposalView, 400: ApiError, 404: ApiError, 409: ApiError, ...editorOnly },
    },
    handler: async (req) => mergePersons(deps, req.member!, req.params.id, req.body),
  });

  app.get('/api/history/:kind/:id', {
    schema: {
      tags: ['History'],
      summary: 'Every accepted change to a record, newest first, with author, accepting Editor, date and Citations',
      params: z.object({ kind: HistoryKind, id: IdParams.shape.id }),
      response: { 200: History, 400: ApiError, ...signedIn },
    },
    handler: async (req) => ({ items: await recordHistory(db, req.params.kind, req.params.id) }),
  });

  // ---------------------------------------------------------------- images

  app.post('/api/uploads', {
    config: { action: 'propose' },
    schema: {
      tags: ['Images'],
      summary: 'Start an image upload: returns a presigned PUT link into pending/. JPEG, PNG, WebP or HEIC, at most 25 MB',
      body: CreateUploadBody,
      response: { 201: UploadTicket, 400: ApiError, 413: ApiError, ...signedIn },
    },
    handler: async (req, reply) => {
      if (req.body.byteSize > IMAGE_MAX_BYTES) throw new ApiProblem(413, 'too_large', TOO_LARGE_MESSAGE);
      const id = uuidv7();
      const keys = uploadKeys(id);
      const row = await db
        .insertInto('upload')
        .values({
          id,
          author_id: req.member!.id,
          storage_key: keys.link,
          display_key: keys.display,
          declared_type: req.body.contentType,
          declared_size: req.body.byteSize,
          declared_sha256: req.body.sha256,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const link = await deps.images.uploadLink(row.storage_key, req.body.contentType, req.body.byteSize);
      reply.code(201);
      return { upload: uploadView(row), putUrl: link.url, putHeaders: link.headers, expiresAt: link.expiresAt.toISOString() };
    },
  });

  app.post('/api/uploads/:id/complete', {
    config: { action: 'propose' },
    schema: {
      tags: ['Images'],
      summary:
        'Finish an upload: the server checks the file, keeps the checked copy where the upload link cannot reach, and makes its WebP display copy (HEIC is converted, or refused with a message)',
      params: IdParams,
      response: { 200: UploadView, 400: ApiError, 404: ApiError, 409: ApiError, 413: ApiError, 415: ApiError, ...signedIn },
    },
    handler: async (req) => {
      const u = await db.selectFrom('upload').selectAll().where('id', '=', req.params.id).where('author_id', '=', req.member!.id).executeTakeFirst();
      if (!u || u.status === 'deleted') throw new ApiProblem(404, 'not_found', 'No upload of yours with this id.');
      if (u.status === 'ready') return uploadView(u);
      // Loaded and checked in its turn, one upload at a time (memory, issue #39).
      const checked = await checkUpload(() => deps.images.get(u.storage_key));
      if (!checked) throw new ApiProblem(409, 'not_uploaded', 'The file has not arrived yet. Upload it with the link first.');
      const { original } = checked;
      let processed;
      try {
        if ('refused' in checked) throw checked.refused;
        processed = checked.processed;
        if (processed.sha256 !== u.declared_sha256) throw new ApiProblem(400, 'checksum', 'The uploaded file differs from the one announced. Upload it again.');
      } catch (error) {
        await deps.images.delete(u.storage_key).catch(() => undefined);
        await db
          .updateTable('upload')
          .set({ status: 'deleted', deleted_at: deps.clock.now() })
          .where('id', '=', u.id)
          .where('status', '=', 'waiting')
          .execute();
        throw error;
      }
      // The upload link stays valid for its 15 minutes, so the file it points at could still be
      // replaced. The bytes just checked go where no link reaches, and only they are used.
      const verified = uploadKeys(u.id).verified;
      await deps.images.put(verified, original, processed.contentType);
      await deps.images.put(u.display_key, processed.display, 'image/webp');
      const row = await db
        .updateTable('upload')
        .set({
          status: 'ready',
          storage_key: verified,
          content_type: processed.contentType,
          byte_size: processed.byteSize,
          sha256: processed.sha256,
          width: processed.width,
          height: processed.height,
        })
        .where('id', '=', u.id)
        .where('status', '=', 'waiting')
        .returningAll()
        .executeTakeFirst();
      await deps.images.delete(u.storage_key).catch((e: unknown) => deps.log?.('could not delete an uploaded file after checking it', e));
      if (row) return uploadView(row);
      // Another request for the same upload got there first: it finished it (with the same
      // checked bytes, so the files written here are its files too), or refused it.
      const current = await db.selectFrom('upload').selectAll().where('id', '=', u.id).executeTakeFirstOrThrow();
      if (current.status === 'ready') return uploadView(current);
      for (const key of [verified, u.display_key]) await deps.images.delete(key).catch(() => undefined);
      throw new ApiProblem(404, 'not_found', 'No upload of yours with this id.');
    },
  });

  app.get('/api/uploads/:id', {
    schema: {
      tags: ['Images'],
      summary: 'Redirects to an expiring link to an uploaded image: for its author and Editors, and for all Members once its Proposal is accepted',
      params: IdParams,
      querystring: ImageLinkQuery,
      response: { 302: z.null().describe('Location: presigned link, valid 5 minutes'), 404: ApiError, 409: ApiError, 410: ApiError, ...signedIn },
    },
    handler: async (req, reply) => {
      const u = await db.selectFrom('upload').selectAll().where('id', '=', req.params.id).executeTakeFirst();
      const member = req.member!;
      if (!u || (u.author_id !== member.id && !canReview(member) && u.image_id === null)) throw new ApiProblem(404, 'not_found', 'No image with this id.');
      if (u.status === 'deleted') throw new ApiProblem(410, 'deleted', 'This image was deleted.');
      if (u.status !== 'ready') throw new ApiProblem(409, 'not_ready', 'This image is still being uploaded.');
      // An accepted image is served from its image record; otherwise from the upload (pending/,
      // or images/ for one an undo removed, kept for 30 days).
      const image = u.image_id
        ? await db.selectFrom('image').select(['storage_key', 'display_key', 'content_type']).where('id', '=', u.image_id).executeTakeFirst()
        : undefined;
      const link = await imageLink(
        deps.images,
        image ?? { storage_key: u.storage_key, display_key: u.display_key, content_type: u.content_type! },
        req.query.full === 'true',
      );
      return reply.header('cache-control', 'no-store').redirect(link.url, 302);
    },
  });

  // ---------------------------------------------------------------- outcome emails

  app.get('/api/me/notifications', {
    config: { action: 'ownAccount' },
    schema: { tags: ['Account'], summary: 'Your email settings', response: { 200: NotificationSettings, ...ownAccount } },
    handler: async (req) => ({ outcomeEmails: req.member!.outcome_emails }),
  });

  app.put('/api/me/notifications', {
    config: { action: 'ownAccount' },
    schema: {
      tags: ['Account'],
      summary: 'Turn outcome emails about your Proposals on or off. Editors keep the daily digest while they are Editors',
      body: NotificationSettings,
      response: { 200: NotificationSettings, 400: ApiError, ...ownAccount },
    },
    handler: async (req) => {
      const row = await db
        .updateTable('account')
        .set({ outcome_emails: req.body.outcomeEmails })
        .where('id', '=', req.member!.id)
        .returning('outcome_emails')
        .executeTakeFirstOrThrow();
      return { outcomeEmails: row.outcome_emails };
    },
  });
}
