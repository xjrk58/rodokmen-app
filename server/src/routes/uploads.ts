import { DOCUMENT_MAX_BYTES, IMAGE_MAX_BYTES, isDocumentType, type CreateUploadBody, type UploadTicket, type UploadView } from '@rodokmen/shared';
import { v7 as uuidv7 } from 'uuid';
import { ApiProblem } from '../auth/problem.js';
import type { Account, Upload } from '../db/types.js';
import type { ProposalDeps } from '../proposals/service.js';
import { uploadView } from '../proposals/views.js';
import { checkDocument, DOCUMENT_TOO_LARGE_MESSAGE } from '../storage/documents.js';
import { uploadKeys } from '../storage/images.js';
import { checkUpload, TOO_LARGE_MESSAGE } from '../storage/process.js';

/**
 * Uploads of images and documents for Proposals (evidence-media spec): a presigned PUT link into
 * pending/, then the server's check. Used by /api/uploads and by an Import batch's uploads.
 */

/** Starts an upload: a presigned PUT link for exactly this type and size. */
export async function createUpload(deps: ProposalDeps, member: Account, body: CreateUploadBody): Promise<UploadTicket> {
  const document = isDocumentType(body.contentType);
  if (document && body.byteSize > DOCUMENT_MAX_BYTES) throw new ApiProblem(413, 'too_large', DOCUMENT_TOO_LARGE_MESSAGE);
  if (!document && body.byteSize > IMAGE_MAX_BYTES) throw new ApiProblem(413, 'too_large', TOO_LARGE_MESSAGE);
  const id = uuidv7();
  const keys = uploadKeys(id);
  const row = await deps.db
    .insertInto('upload')
    .values({
      id,
      author_id: member.id,
      storage_key: keys.link,
      display_key: keys.display,
      declared_type: body.contentType,
      declared_size: body.byteSize,
      declared_sha256: body.sha256,
      kind: document ? 'document' : 'image',
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const link = await deps.images.uploadLink(row.storage_key, body.contentType, body.byteSize);
  return { upload: uploadView(row), putUrl: link.url, putHeaders: link.headers, expiresAt: link.expiresAt.toISOString() };
}

/**
 * Finishes a document upload (evidence-media spec, "Documents on Sources"): the file must be the
 * PDF (or DOC) it was announced as and match its SHA-256. The checked bytes go where no upload
 * link reaches, as for images; a document has no display copy.
 */
async function completeDocument(deps: ProposalDeps, u: Upload) {
  const original = await deps.images.get(u.storage_key);
  if (!original) throw new ApiProblem(409, 'not_uploaded', 'The file has not arrived yet. Upload it with the link first.');
  const declared = isDocumentType(u.declared_type) ? u.declared_type : 'application/pdf';
  let checked;
  try {
    checked = checkDocument(original, declared);
    if (checked.sha256 !== u.declared_sha256) throw new ApiProblem(400, 'checksum', 'The uploaded file differs from the one announced. Upload it again.');
  } catch (error) {
    await deps.images.delete(u.storage_key).catch(() => undefined);
    await deps.db
      .updateTable('upload')
      .set({ status: 'deleted', deleted_at: deps.clock.now() })
      .where('id', '=', u.id)
      .where('status', '=', 'waiting')
      .execute();
    throw error;
  }
  const verified = uploadKeys(u.id).verified;
  await deps.images.put(verified, original, checked.contentType);
  const row = await deps.db
    .updateTable('upload')
    .set({ status: 'ready', storage_key: verified, content_type: checked.contentType, byte_size: checked.byteSize, sha256: checked.sha256 })
    .where('id', '=', u.id)
    .where('status', '=', 'waiting')
    .returningAll()
    .executeTakeFirst();
  await deps.images.delete(u.storage_key).catch((e: unknown) => deps.log?.('could not delete an uploaded file after checking it', e));
  if (row) return uploadView(row);
  const current = await deps.db.selectFrom('upload').selectAll().where('id', '=', u.id).executeTakeFirstOrThrow();
  if (current.status === 'ready') return uploadView(current);
  throw new ApiProblem(404, 'not_found', 'No upload of yours with this id.');
}

/** Finishes an upload: checks the file, keeps the checked copy where the link cannot reach, and makes an image's display copy. */
export async function completeUpload(deps: ProposalDeps, member: Account, id: string): Promise<UploadView> {
  const u = await deps.db.selectFrom('upload').selectAll().where('id', '=', id).where('author_id', '=', member.id).executeTakeFirst();
  if (!u || u.status === 'deleted') throw new ApiProblem(404, 'not_found', 'No upload of yours with this id.');
  if (u.status === 'ready') return uploadView(u);
  if (u.kind === 'document') return completeDocument(deps, u);
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
    await deps.db
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
  const row = await deps.db
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
  const current = await deps.db.selectFrom('upload').selectAll().where('id', '=', u.id).executeTakeFirstOrThrow();
  if (current.status === 'ready') return uploadView(current);
  for (const key of [verified, u.display_key]) await deps.images.delete(key).catch(() => undefined);
  throw new ApiProblem(404, 'not_found', 'No upload of yours with this id.');
}
