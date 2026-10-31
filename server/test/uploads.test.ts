import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { ProposalView, UploadTicket, UploadView, type OperationInput } from '@rodokmen/shared';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { DailyScheduler } from '../src/jobs/daily.js';
import { createImageStorage, MemoryImageStorage } from '../src/storage/images.js';
import { HEIC_MESSAGE, MAX_INPUT_PIXELS, processImage, sniffImageType, TOO_MANY_PIXELS_MESSAGE } from '../src/storage/process.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, DAY, ensureOwner, errorOf, makeApp, signIn, TestClock, testConfig, type TestApp } from './helpers.js';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** A generated test picture (no real photo is ever committed). */
async function picture(format: 'jpeg' | 'png' | 'webp', width = 3000, height = 2000): Promise<Buffer> {
  const img = sharp({ create: { width, height, channels: 3, background: { r: 180, g: 160, b: 120 } } });
  return img[format]().toBuffer();
}

/** The start of a HEIC file (ISO-BMFF `ftyp` box with the `heic` brand) whose image data cannot be decoded. */
function heicContainer(): Buffer {
  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write('ftypheic', 4, 'latin1');
  ftyp.writeUInt32BE(0, 12);
  ftyp.write('mif1heic', 16, 'latin1');
  return Buffer.concat([ftyp, Buffer.alloc(2048, 0x11)]);
}

/** A small PNG whose header claims width × height pixels; its image data is a few bytes. */
function pngClaiming(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', Buffer.from([0x78, 0x9c, 0x03, 0x00])), chunk('IEND', Buffer.alloc(0))]);
}

describe('images: uploads, display copies, privacy and deletion', () => {
  let t: TestDatabase;
  let a: TestApp;
  let storage: MemoryImageStorage;
  let author: Account;
  let editor: Account;
  let stranger: Account;
  const cookies = new Map<string, string>();
  const call = (m: Account, method: 'GET' | 'POST', url: string, payload?: object) =>
    a.app.inject({ method, url, headers: { cookie: cookies.get(m.id)! }, ...(payload === undefined ? {} : { payload }) });

  /** What the store does with a PUT to an upload link: it writes the bytes at the link's key. */
  async function putAtLink(putUrl: string, body: Buffer, contentType: string) {
    await storage.put(new URL(putUrl).pathname.replace('/bucket/', ''), body, contentType);
  }

  /** What the app does: ask for a link, PUT the bytes there, then ask the server to finish. */
  async function upload(m: Account, body: Buffer, contentType = 'image/jpeg') {
    const ticket = await call(m, 'POST', '/api/uploads', { contentType, byteSize: body.length, sha256: sha(body) });
    expect(ticket.statusCode, ticket.body).toBe(201);
    const { upload: u, putUrl } = UploadTicket.parse(ticket.json());
    expect(new URL(putUrl).pathname).toBe(`/bucket/pending/${u.id}/original`);
    await putAtLink(putUrl, body, contentType);
    return call(m, 'POST', `/api/uploads/${u.id}/complete`);
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t, { images: (clock) => (storage = new MemoryImageStorage(clock)) });
    await ensureOwner(t.db);
    author = await createMember(t.db, 'contributor');
    editor = await createMember(t.db, 'editor');
    stranger = await createMember(t.db, 'contributor');
    for (const m of [author, editor, stranger]) cookies.set(m.id, await signIn(t.db, a.clock, m));
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  it('makes a 2,000-pixel WebP display copy of JPEG, PNG and WebP and keeps the original', async () => {
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      const original = await picture(format);
      expect(sniffImageType(original)).toBe(`image/${format}`);
      const res = await upload(author, original, `image/${format}`);
      expect(res.statusCode, res.body).toBe(200);
      const view = UploadView.parse(res.json());
      expect(view).toMatchObject({ status: 'ready', contentType: `image/${format}`, width: 3000, height: 2000, byteSize: original.length });
      // The checked original is kept where the upload link cannot reach; the file at the link is gone.
      expect(storage.objects.get(`pending/${view.id}/verified`)!.body.equals(original)).toBe(true);
      expect(storage.objects.has(`pending/${view.id}/original`)).toBe(false);
      const display = await sharp(storage.objects.get(`pending/${view.id}/display.webp`)!.body).metadata();
      expect([display.format, display.width, display.height]).toEqual(['webp', 2000, 1333]);
    }
  });

  it('refuses a HEIC photo it cannot convert, with a message that says what to do', async () => {
    const heic = heicContainer();
    expect(sniffImageType(heic)).toBe('image/heic');
    await expect(processImage(heic)).rejects.toMatchObject({ statusCode: 415, code: 'heic_unsupported' });
    const res = await upload(author, heic, 'image/heic');
    expect(res.statusCode).toBe(415);
    expect(res.json()).toMatchObject({ code: 'heic_unsupported', message: HEIC_MESSAGE });
  });

  it('an upload to the link after the check changes neither the kept nor the shown image, nor the accepted one (issue #52)', async () => {
    const original = await picture('jpeg', 1200, 1600);
    // Other bytes of the same size, as a presigned PUT signed for that size would accept.
    const other = Buffer.from(original);
    other.fill(0x55, 1000, 3000);
    expect([other.length, sha(other) === sha(original)]).toEqual([original.length, false]);

    const ticket = UploadTicket.parse(
      (await call(author, 'POST', '/api/uploads', { contentType: 'image/jpeg', byteSize: original.length, sha256: sha(original) })).json(),
    );
    const id = ticket.upload.id;
    await putAtLink(ticket.putUrl, original, 'image/jpeg');
    expect((await call(author, 'POST', `/api/uploads/${id}/complete`)).statusCode).toBe(200);
    const display = storage.objects.get(`pending/${id}/display.webp`)!.body;

    // The link is valid for minutes more: the uploader puts other bytes there and finishes again.
    a.clock.advance(60_000);
    await putAtLink(ticket.putUrl, other, 'image/jpeg');
    const again = await call(author, 'POST', `/api/uploads/${id}/complete`);
    expect(again.statusCode).toBe(200);
    expect(UploadView.parse(again.json())).toMatchObject({ id, status: 'ready', width: 1200, height: 1600 });
    const row = await t.db.selectFrom('upload').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ storage_key: `pending/${id}/verified`, sha256: sha(original) });
    expect(storage.objects.get(row.storage_key)!.body.equals(original)).toBe(true);
    expect(storage.objects.get(row.display_key)!.body.equals(display)).toBe(true);
    // Shown and opened in full: the checked file, never the one at the link.
    expect((await call(editor, 'GET', `/api/uploads/${id}`)).headers.location).toContain(`pending/${id}/display.webp`);
    expect((await call(editor, 'GET', `/api/uploads/${id}?full=true`)).headers.location).toContain(`pending/${id}/verified`);

    // Accepted, the Tree holds the checked bytes, and the file at the link is removed.
    const ops: OperationInput[] = [
      { op: 'createSource', tempId: 'tmp:s', type: 'other', title: 'Invented postcard, 1911' },
      { op: 'createCitation', tempId: 'tmp:c', sourceId: 'tmp:s', transcription: 'Greetings from …', readOn: '2026-10-20', confidence: 'normal' },
      { op: 'addImage', uploadId: id, kind: 'photo', citationId: 'tmp:c', caption: 'Invented postcard' },
    ];
    const proposal = await call(author, 'POST', '/api/proposals', { formatVersion: 1, idempotencyKey: `img-${id}`, operations: ops });
    expect(proposal.statusCode, proposal.body).toBe(201);
    expect((await call(editor, 'POST', `/api/proposals/${ProposalView.parse(proposal.json()).id}/accept`, {})).statusCode).toBe(200);
    const image = await t.db.selectFrom('image').selectAll().where('caption', '=', 'Invented postcard').executeTakeFirstOrThrow();
    expect(image.sha256).toBe(sha(original));
    expect(storage.objects.get(image.storage_key)!.body.equals(original)).toBe(true);
    expect(storage.objects.get(image.display_key!)!.body.equals(display)).toBe(true);
    expect([...storage.objects.keys()].filter((k) => k.startsWith(`pending/${id}/`))).toEqual([]);
  });

  it('accepts images up to 25 MB and refuses larger ones', async () => {
    const limit = 25 * 1024 * 1024;
    const ok = await call(author, 'POST', '/api/uploads', { contentType: 'image/jpeg', byteSize: limit, sha256: 'a'.repeat(64) });
    expect(ok.statusCode).toBe(201);
    const tooBig = await call(author, 'POST', '/api/uploads', { contentType: 'image/jpeg', byteSize: limit + 1, sha256: 'a'.repeat(64) });
    expect(tooBig.statusCode).toBe(413);
    expect(errorOf(tooBig).message).toMatch(/at most 25 MB/);
    // A file larger than announced is refused when it is checked.
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(limit + 10)]);
    await expect(processImage(big)).rejects.toMatchObject({ statusCode: 413, code: 'too_large' });
  });

  it('refuses an image with more pixels than a 25 MB file can hold, from its header alone', async () => {
    expect(MAX_INPUT_PIXELS).toBe(8 * 25_000_000);
    const bomb = pngClaiming(20_000, 10_001); // 200,020,000 pixels in under 100 bytes
    expect(bomb.length).toBeLessThan(100);
    await expect(processImage(bomb)).rejects.toMatchObject({ statusCode: 413, code: 'too_large', message: TOO_MANY_PIXELS_MESSAGE });
    expect(TOO_MANY_PIXELS_MESSAGE).toMatch(/at most 200 million pixels/);
    // Just within the limit, the same file gets as far as decoding (and fails there, having no data).
    await expect(processImage(pngClaiming(20_000, 10_000))).rejects.toMatchObject({ statusCode: 415, code: 'image_unreadable' });
  });

  it('signs upload links for exactly the announced type and size, valid 15 minutes', async () => {
    const s3 = createImageStorage(testConfig(t.url).s3, new TestClock());
    const link = await s3.uploadLink('pending/x/original', 'image/jpeg', 1234);
    const url = new URL(link.url);
    expect(url.origin).toBe('https://files.rodokmen.dev');
    expect(url.pathname).toBe('/rodokmen-images-test/pending/x/original');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
  });

  async function proposalWithImage(): Promise<{ proposal: ProposalView; uploadId: string }> {
    const view = UploadView.parse((await upload(author, await picture('jpeg', 1200, 1600))).json());
    const ops: OperationInput[] = [
      { op: 'createSource', tempId: 'tmp:s', type: 'other', title: 'Invented letter, 1902' },
      { op: 'createCitation', tempId: 'tmp:c', sourceId: 'tmp:s', transcription: 'Dear brother, …', readOn: '2026-10-20', confidence: 'normal' },
      { op: 'addImage', uploadId: view.id, kind: 'photo', citationId: 'tmp:c' },
    ];
    const res = await call(author, 'POST', '/api/proposals', { formatVersion: 1, idempotencyKey: `img-${view.id}`, operations: ops });
    expect(res.statusCode, res.body).toBe(201);
    return { proposal: ProposalView.parse(res.json()), uploadId: view.id };
  }

  it('another Contributor cannot open a pending image; its author and the Editors can, by an expiring link', async () => {
    const { proposal, uploadId } = await proposalWithImage();
    expect(proposal.citations[0]!.images.map((i) => i.id)).toEqual([uploadId]);
    expect((await call(stranger, 'GET', `/api/uploads/${uploadId}`)).statusCode).toBe(404);
    for (const m of [author, editor]) {
      const res = await call(m, 'GET', `/api/uploads/${uploadId}`);
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toMatch(new RegExp(`pending/${uploadId}/display\\.webp\\?expires=\\d+`));
    }
  });

  it('accepting moves the images out of pending/; then every Member sees them, and the original on request', async () => {
    const { proposal, uploadId } = await proposalWithImage();
    expect((await call(editor, 'POST', `/api/proposals/${proposal.id}/accept`, {})).statusCode).toBe(200);
    expect([...storage.objects.keys()].filter((k) => k.startsWith(`pending/${uploadId}/`))).toEqual([]);
    const image = await t.db.selectFrom('image').selectAll().where('caption', 'is', null).where('kind', '=', 'photo').executeTakeFirstOrThrow();
    expect(image.storage_key).toBe(`images/${image.id}/original`);
    expect(storage.objects.has(image.storage_key)).toBe(true);
    expect(storage.objects.has(`images/${image.id}/display.webp`)).toBe(true);
    expect(image).toMatchObject({ content_type: 'image/jpeg', width: 1200, height: 1600 });
    const display = await call(stranger, 'GET', `/api/images/${image.id}`);
    expect(display.headers.location).toContain(`images/${image.id}/display.webp`);
    const full = await call(stranger, 'GET', `/api/images/${image.id}?full=true`);
    expect(full.headers.location).toContain(`images/${image.id}/original`);
    expect((await call(stranger, 'GET', `/api/uploads/${uploadId}`)).statusCode).toBe(302);
  });

  it('rejected image: other Members never see it, and it is deleted after 30 days', async () => {
    const { proposal, uploadId } = await proposalWithImage();
    expect((await call(editor, 'POST', `/api/proposals/${proposal.id}/reject`, { note: 'Not our family' })).statusCode).toBe(200);
    expect((await call(stranger, 'GET', `/api/uploads/${uploadId}`)).statusCode).toBe(404);
    expect((await call(author, 'GET', `/api/uploads/${uploadId}`)).statusCode).toBe(302);
    const jobs = new DailyScheduler({ db: t.db, clock: a.clock, mailer: a.mailer, images: storage, publicOrigin: 'http://localhost:3000' });
    // The job runs daily at 03:30 Prague time; 29 days later the image is still there.
    a.clock.current = new Date('2026-11-27T03:00:00Z');
    // Something put at its upload link after the check goes with it.
    await storage.put(`pending/${uploadId}/original`, Buffer.from('late'), 'image/jpeg');
    expect(await jobs.tick()).toContain('delete-unused-images');
    expect(storage.objects.has(`pending/${uploadId}/verified`)).toBe(true);
    a.clock.current = new Date('2026-11-29T03:00:00Z');
    expect(await jobs.tick()).toContain('delete-unused-images');
    expect([...storage.objects.keys()].filter((k) => k.startsWith(`pending/${uploadId}/`))).toEqual([]);
    expect((await call(author, 'GET', `/api/uploads/${uploadId}`)).statusCode).toBe(410);
    a.clock.current = new Date(a.clock.current.getTime() + DAY);
  });

  it('a failed copy during accept leaves nothing in images/ and the Proposal pending', async () => {
    const { proposal, uploadId } = await proposalWithImage();
    const copy = storage.copy.bind(storage);
    storage.copy = async (from, to) => {
      if (to.endsWith('display.webp')) throw new Error('storage unavailable');
      return copy(from, to);
    };
    const before = [...storage.objects.keys()].filter((k) => k.startsWith('images/')).sort();
    try {
      expect((await call(editor, 'POST', `/api/proposals/${proposal.id}/accept`, {})).statusCode).toBe(500);
    } finally {
      storage.copy = copy;
    }
    expect([...storage.objects.keys()].filter((k) => k.startsWith('images/')).sort()).toEqual(before);
    expect(storage.objects.has(`pending/${uploadId}/verified`)).toBe(true);
    expect(ProposalView.parse((await call(editor, 'GET', `/api/proposals/${proposal.id}`)).json()).status).toBe('pending');
    expect((await call(editor, 'POST', `/api/proposals/${proposal.id}/accept`, {})).statusCode).toBe(200);
  });

  it('after accept the upload points at images/; an undo keeps the files 30 days for its author and Editors, then they are deleted', async () => {
    const { proposal, uploadId } = await proposalWithImage();
    expect((await call(editor, 'POST', `/api/proposals/${proposal.id}/accept`, {})).statusCode).toBe(200);
    const row = await t.db.selectFrom('upload').selectAll().where('id', '=', uploadId).executeTakeFirstOrThrow();
    expect(row.storage_key).toBe(`images/${row.image_id}/original`);
    expect(row.display_key).toBe(`images/${row.image_id}/display.webp`);
    expect((await call(author, 'GET', `/api/uploads/${uploadId}`)).headers.location).toContain(`images/${row.image_id}/display.webp`);

    expect((await call(editor, 'POST', `/api/proposals/${proposal.id}/undo`, {})).statusCode).toBe(200);
    const orphan = await t.db.selectFrom('upload').selectAll().where('id', '=', uploadId).executeTakeFirstOrThrow();
    expect(orphan.image_id).toBeNull();
    expect(orphan.orphaned_at).not.toBeNull();
    expect((await call(stranger, 'GET', `/api/uploads/${uploadId}`)).statusCode).toBe(404);
    expect((await call(author, 'GET', `/api/uploads/${uploadId}`)).headers.location).toContain(`images/${row.image_id}/display.webp`);
    expect(storage.objects.has(row.storage_key)).toBe(true);

    const jobs = new DailyScheduler({ db: t.db, clock: a.clock, mailer: a.mailer, images: storage, publicOrigin: 'http://localhost:3000' });
    a.clock.current = new Date(a.clock.current.getTime() + 31 * DAY);
    expect(await jobs.tick()).toContain('delete-unused-images');
    expect(storage.objects.has(row.storage_key)).toBe(false);
    expect(storage.objects.has(row.display_key)).toBe(false);
    expect((await call(author, 'GET', `/api/uploads/${uploadId}`)).statusCode).toBe(410);
  });
});
