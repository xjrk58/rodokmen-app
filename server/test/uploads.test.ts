import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { ProposalView, UploadTicket, UploadView, type OperationInput } from '@rodokmen/shared';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { DailyScheduler } from '../src/jobs/daily.js';
import { createImageStorage, MemoryImageStorage } from '../src/storage/images.js';
import { processImage, SHARP_MAX_INPUT_PIXELS, sniffImageType, TOO_MANY_PIXELS_MESSAGE } from '../src/storage/process.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, DAY, ensureOwner, errorOf, makeApp, signIn, TestClock, testConfig, type TestApp } from './helpers.js';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** A generated test picture (no real photo is ever committed). */
async function picture(format: 'jpeg' | 'png' | 'webp', width = 3000, height = 2000): Promise<Buffer> {
  const img = sharp({ create: { width, height, channels: 3, background: { r: 180, g: 160, b: 120 } } });
  return img[format]().toBuffer();
}

/** An invented HEIC of test/fixtures/heic/ (make.py there says how each was made; none is a photo). */
const heicFixture = (name: string) => readFileSync(new URL(`fixtures/heic/${name}`, import.meta.url));

/** The colour of the pixel at x, y of an encoded image. */
async function colourAt(image: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [...data.subarray(at, at + 3)];
}

/** Each channel of `actual` within `slack` of `expected` (HEVC and WebP are lossy). */
const near = (actual: number[], expected: number[], slack = 24) => actual.every((v, i) => Math.abs(v - expected[i]!) <= slack);

/** A PNG of width × height pixels with the given IHDR depth and colour type, and image data. */
function png(width: number, height: number, depthAndColour: [number, number], data: Buffer): Buffer {
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
  ihdr.set([...depthAndColour, 0, 0, 0], 8);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', data), chunk('IEND', Buffer.alloc(0))]);
}

/** A small 8-bit RGB PNG whose header claims width × height pixels; its image data is a few bytes. */
const pngClaiming = (width: number, height: number) => png(width, height, [8, 2], Buffer.from([0x78, 0x9c, 0x03, 0x00]));

/** A real, all-black 1-bit greyscale PNG of width × height pixels (width a multiple of 8): each row is a filter byte and zeros, which compress to almost nothing. */
const flatPng = (width: number, height: number) => png(width, height, [1, 0], deflateSync(Buffer.alloc((1 + width / 8) * height), { level: 9 }));

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

  it('uploads finished at the same moment are all checked, one at a time (issue #39)', async () => {
    const bodies = await Promise.all([0, 1, 2, 3].map((i) => picture('jpeg', 2400 + i, 1600)));
    let most = 0;
    let sampling = true;
    const sample = () => {
      most = Math.max(most, sharp.counters().process);
      if (sampling) setImmediate(sample);
    };
    sample();
    const answers = await Promise.all(bodies.map((b) => upload(author, b))).finally(() => {
      sampling = false;
    });
    expect(answers.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
    expect(answers.map((r) => UploadView.parse(r.json()).width)).toEqual([2400, 2401, 2402, 2403]);
    expect(most).toBe(1);
  });

  it('converts an iPhone photo in HEIC into the usual copies: the original kept, a WebP display copy, upright (issue #147)', async () => {
    // 12 megapixels in tiles of 512 pixels, stored landscape and turned to a portrait by its irot box, as an iPhone writes it.
    const original = heicFixture('portrait-12mp.heic');
    expect(sniffImageType(original)).toBe('image/heic');
    const res = await upload(author, original, 'image/heic');
    expect(res.statusCode, res.body).toBe(200);
    const view = UploadView.parse(res.json());
    expect(view).toMatchObject({ status: 'ready', contentType: 'image/heic', width: 3024, height: 4032, byteSize: original.length });
    expect(storage.objects.get(`pending/${view.id}/verified`)!.body.equals(original)).toBe(true);
    expect(storage.objects.has(`pending/${view.id}/original`)).toBe(false);
    const display = storage.objects.get(`pending/${view.id}/display.webp`)!;
    expect(display.contentType).toBe('image/webp');
    expect(await sharp(display.body).metadata()).toMatchObject({ format: 'webp', width: 1500, height: 2000 });

    // Turned once, not twice: the file has EXIF orientation 6 as well, which must not be applied on top of irot.
    const small = await upload(author, heicFixture('rotated.heic'), 'image/heic');
    const turned = UploadView.parse(small.json());
    expect(turned).toMatchObject({ status: 'ready', width: 64, height: 96 });
    const copy = storage.objects.get(`pending/${turned.id}/display.webp`)!.body;
    // Stored landscape with a blue top-left quarter; upright, that quarter is at the top right.
    expect(near(await colourAt(copy, 48, 10), [40, 40, 200])).toBe(true);
    expect(near(await colourAt(copy, 10, 10), [200, 40, 40])).toBe(true);
  });

  it('refuses a damaged HEIC as an unreadable image and deletes its file (issue #147)', async () => {
    const whole = heicFixture('rotated.heic');
    const cut = whole.subarray(0, 300);
    const scrambled = Buffer.concat([whole.subarray(0, 32), Buffer.alloc(2048, 0x11)]);
    for (const damaged of [cut, scrambled]) {
      expect(sniffImageType(damaged)).toBe('image/heic');
      const ticket = UploadTicket.parse(
        (await call(author, 'POST', '/api/uploads', { contentType: 'image/heic', byteSize: damaged.length, sha256: sha(damaged) })).json(),
      );
      await putAtLink(ticket.putUrl, damaged, 'image/heic');
      const res = await call(author, 'POST', `/api/uploads/${ticket.upload.id}/complete`);
      expect(res.statusCode).toBe(415);
      const { code, message } = errorOf(res);
      expect(code).toBe('image_unreadable');
      expect(message).toMatch(/^This image could not be read \(.+\)\. Try another copy of it\.$/);
      expect([...storage.objects.keys()].filter((k) => k.startsWith(`pending/${ticket.upload.id}/`))).toEqual([]);
    }
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

  it("refuses an image over sharp's own pixel limit with a clear 413, from its header alone", async () => {
    expect(SHARP_MAX_INPUT_PIXELS).toBe(268_402_689); // sharp's default limitInputPixels, 16,383 × 16,383
    // sharp's own limit is this one: it reads the header of a file at the limit and refuses one just over.
    await expect(sharp(pngClaiming(16_383, 16_383)).metadata()).resolves.toMatchObject({ width: 16_383, height: 16_383 });
    await expect(sharp(pngClaiming(16_383, 16_384)).metadata()).rejects.toThrow();

    const bomb = pngClaiming(16_383, 16_384); // 268,419,072 pixels in under 100 bytes
    expect(bomb.length).toBeLessThan(100);
    await expect(processImage(bomb)).rejects.toMatchObject({ statusCode: 413, code: 'too_large', message: TOO_MANY_PIXELS_MESSAGE });
    expect(TOO_MANY_PIXELS_MESSAGE).toMatch(/at most about 268 million pixels/);
    // At the limit, the same file gets as far as decoding (and fails there, having no data).
    await expect(processImage(pngClaiming(16_383, 16_383))).rejects.toMatchObject({ statusCode: 415, code: 'image_unreadable' });
  });

  it("accepts an image between the old 200-million-pixel limit and sharp's (#98)", async () => {
    const large = flatPng(16_384, 13_000); // 212,992,000 pixels in a few tens of kB
    expect(large.length).toBeLessThan(100_000);
    const done = await processImage(large);
    expect(done).toMatchObject({ contentType: 'image/png', width: 16_384, height: 13_000 });
    expect(await sharp(done.display).metadata()).toMatchObject({ width: 2000, height: 1587 });
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
