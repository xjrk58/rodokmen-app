import { createHash } from 'node:crypto';
import { CitationDetail, ProposalView, SourceDetail, UploadTicket, UploadView, type OperationInput } from '@rodokmen/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { MemoryImageStorage } from '../src/storage/images.js';
import { NOT_A_PDF_MESSAGE, sniffDocumentType } from '../src/storage/documents.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, errorOf, makeApp, signIn, type TestApp } from './helpers.js';

/**
 * Documents on Sources (evidence-media spec, "Documents on Sources"; add-vault-import task 1.6):
 * a PDF of up to 50 MB attached to a Source as part of a Proposal, opened by Members and Agents
 * only through links that expire.
 */
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
/** A minimal invented PDF and DOC (the DOC is only its OLE2 signature and padding). */
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n% Invented family chronicle\n', 'latin1'), Buffer.alloc(2048, 0x20), Buffer.from('\n%%EOF\n')]);
const DOC = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(4096, 0)]);

describe('documents on Sources', () => {
  let t: TestDatabase;
  let a: TestApp;
  let storage: MemoryImageStorage;
  let author: Account;
  let editor: Account;
  let other: Account;
  const cookies = new Map<string, string>();
  const call = (m: Account, method: 'GET' | 'POST', url: string, payload?: object) =>
    a.app.inject({ method, url, headers: { cookie: cookies.get(m.id)! }, ...(payload === undefined ? {} : { payload }) });

  async function upload(m: Account, body: Buffer, contentType: string) {
    const ticket = await call(m, 'POST', '/api/uploads', { contentType, byteSize: body.length, sha256: sha(body) });
    expect(ticket.statusCode, ticket.body).toBe(201);
    const { upload: u, putUrl } = UploadTicket.parse(ticket.json());
    await storage.put(new URL(putUrl).pathname.replace('/bucket/', ''), body, contentType);
    return call(m, 'POST', `/api/uploads/${u.id}/complete`);
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t, { images: (clock) => (storage = new MemoryImageStorage(clock)) });
    await ensureOwner(t.db);
    author = await createMember(t.db, 'contributor');
    editor = await createMember(t.db, 'editor');
    other = await createMember(t.db, 'contributor');
    for (const m of [author, editor, other]) cookies.set(m.id, await signIn(t.db, a.clock, m));
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  const chronicle = (pdf: string, original: string | null = null): OperationInput[] => [
    {
      op: 'createSource',
      tempId: 'tmp:s',
      type: 'family_account',
      title: 'Invented family chronicle',
      familyAccount: { givenBy: 'Invented Aunt', givenByPersonId: null, givenOn: '1936' },
    },
    {
      op: 'createCitation',
      tempId: 'tmp:c',
      sourceId: 'tmp:s',
      transcription: 'The chronicle of the invented family.',
      readOn: '2026-10-30',
      confidence: 'normal',
    },
    { op: 'addDocument', sourceId: 'tmp:s', uploadId: pdf, originalUploadId: original, title: 'Family chronicle, typescript of 1936' },
  ];

  it('family chronicle: after acceptance every Member opens the PDF from the Source, through a link that expires', async () => {
    const res = await upload(author, PDF, 'application/pdf');
    expect(res.statusCode, res.body).toBe(200);
    const pdf = UploadView.parse(res.json());
    expect(pdf).toMatchObject({ kind: 'document', contentType: 'application/pdf', status: 'ready', byteSize: PDF.length, width: null });
    // Before acceptance: the author and Editors only.
    expect((await call(author, 'GET', `/api/uploads/${pdf.id}`)).statusCode).toBe(302);
    const submitted = await call(author, 'POST', '/api/proposals', {
      formatVersion: 1,
      idempotencyKey: 'chronicle-1',
      note: null,
      operations: chronicle(pdf.id),
    });
    expect(submitted.statusCode, submitted.body).toBe(201);
    const view = ProposalView.parse(submitted.json());
    expect(view.operations[2]!.summary.en).toBe('adds the document “Family chronicle, typescript of 1936” to “Invented family chronicle”');
    expect((await call(other, 'GET', `/api/uploads/${pdf.id}`)).statusCode).toBe(404);
    const ok = await call(editor, 'POST', `/api/proposals/${view.id}/accept`, {});
    expect(ok.statusCode, ok.body).toBe(200);

    const doc = await t.db.selectFrom('source_document').selectAll().executeTakeFirstOrThrow();
    const source = SourceDetail.parse((await call(other, 'GET', `/api/sources/${doc.source_id}`)).json());
    expect(source.documents).toEqual([
      {
        id: doc.id,
        version: 1,
        title: 'Family chronicle, typescript of 1936',
        contentType: 'application/pdf',
        byteSize: PDF.length,
        url: `/api/documents/${doc.id}`,
        original: null,
      },
    ]);
    // The file moved out of pending/, and opens through an expiring link.
    expect(storage.objects.get(`documents/${doc.id}/document.pdf`)!.body.equals(PDF)).toBe(true);
    expect(storage.objects.has(`pending/${pdf.id}/verified`)).toBe(false);
    const link = await call(other, 'GET', source.documents[0]!.url);
    expect(link.statusCode).toBe(302);
    expect(link.headers.location).toMatch(new RegExp(`documents/${doc.id}/document\\.pdf\\?expires=\\d+`));
    expect(link.headers['cache-control']).toBe('no-store');
    // The Citation of the Source lists them too.
    const citation = await t.db.selectFrom('citation').select('id').where('source_id', '=', doc.source_id).executeTakeFirstOrThrow();
    expect(CitationDetail.parse((await call(other, 'GET', `/api/citations/${citation.id}`)).json()).documents.map((d) => d.id)).toEqual([doc.id]);
    // Not signed in, nothing.
    expect((await a.app.inject({ method: 'GET', url: source.documents[0]!.url })).statusCode).toBe(401);
  });

  it('a converted DOC is kept beside its PDF, and an undo takes both away', async () => {
    const pdf = UploadView.parse((await upload(author, PDF, 'application/pdf')).json());
    const doc = UploadView.parse((await upload(author, DOC, 'application/msword')).json());
    expect(doc).toMatchObject({ kind: 'document', contentType: 'application/msword' });
    const submitted = await call(author, 'POST', '/api/proposals', {
      formatVersion: 1,
      idempotencyKey: 'chronicle-2',
      note: null,
      operations: chronicle(pdf.id, doc.id),
    });
    expect(submitted.statusCode, submitted.body).toBe(201);
    const id = ProposalView.parse(submitted.json()).id;
    expect((await call(editor, 'POST', `/api/proposals/${id}/accept`, {})).statusCode).toBe(200);
    const row = await t.db.selectFrom('source_document').selectAll().where('original_key', 'is not', null).executeTakeFirstOrThrow();
    const source = SourceDetail.parse((await call(other, 'GET', `/api/sources/${row.source_id}`)).json());
    expect(source.documents[0]!.original).toEqual({ contentType: 'application/msword', byteSize: DOC.length, url: `/api/documents/${row.id}?original=true` });
    const link = await call(other, 'GET', source.documents[0]!.original!.url);
    expect(link.headers.location).toMatch(new RegExp(`documents/${row.id}/original\\.doc`));
    expect(storage.objects.get(`documents/${row.id}/original.doc`)!.body.equals(DOC)).toBe(true);

    expect((await call(editor, 'POST', `/api/proposals/${id}/undo`, {})).statusCode).toBe(200);
    expect(await t.db.selectFrom('source_document').select('id').where('id', '=', row.id).executeTakeFirst()).toBeUndefined();
    const uploads = await t.db.selectFrom('upload').select(['orphaned_at', 'document_id']).where('id', 'in', [pdf.id, doc.id]).execute();
    expect(uploads.every((u) => u.orphaned_at !== null && u.document_id === null)).toBe(true);
  });

  it('not a PDF: a file announced as a PDF that is not one is refused, and so is one over 50 MB', async () => {
    expect(sniffDocumentType(DOC)).toBe('application/msword');
    const res = await upload(author, DOC, 'application/pdf');
    expect(res.statusCode).toBe(415);
    expect(errorOf(res).message).toBe(NOT_A_PDF_MESSAGE);
    const big = await call(author, 'POST', '/api/uploads', { contentType: 'application/pdf', byteSize: 50 * 1024 * 1024 + 1, sha256: sha(PDF) });
    expect(big.statusCode).toBe(413);
    // An image upload cannot be a document, nor a document an image.
    const pdf = UploadView.parse((await upload(author, PDF, 'application/pdf')).json());
    const asImage = await call(author, 'POST', '/api/proposals', {
      formatVersion: 1,
      idempotencyKey: 'chronicle-3',
      note: null,
      operations: [...chronicle(pdf.id).slice(0, 2), { op: 'addImage', uploadId: pdf.id, kind: 'photo', citationId: 'tmp:c' }],
    });
    expect(asImage.statusCode, asImage.body).toBe(201);
    const accepted = await call(editor, 'POST', `/api/proposals/${ProposalView.parse(asImage.json()).id}/accept`, {});
    expect(accepted.statusCode).toBe(409);
    expect(errorOf(accepted).code).toBe('upload_unusable');
  });
});
