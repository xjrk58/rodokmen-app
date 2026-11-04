import { createHash } from 'node:crypto';
import { UploadTicket, UploadView } from '@rodokmen/shared';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Account } from '../src/db/types.js';
import { BUSY_MESSAGE, QUEUE_LIMIT, queuedImages } from '../src/storage/process.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { GatedStorage } from './gated-storage.js';
import { createMember, ensureOwner, makeApp, portOf, signIn, type TestApp } from './helpers.js';

/**
 * Finishing uploads while others are checked (issues #95 and #97): POST /api/uploads/{id}/complete
 * waits for its turn in the image queue (server/src/storage/process.ts).
 */
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** A generated test picture (no real photo is ever committed). */
const picture = (width: number, height: number, format: 'jpeg' | 'png' = 'jpeg') =>
  sharp({ create: { width, height, channels: 3, background: { r: 120, g: 140, b: 90 } } })
    [format]()
    .toBuffer();

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n% Invented parish chronicle\n', 'latin1'), Buffer.alloc(1024, 0x20), Buffer.from('\n%%EOF\n')]);

describe('finishing uploads', () => {
  let t: TestDatabase;
  let a: TestApp;
  let storage: GatedStorage;
  let author: Account;
  let cookie: string;
  const complete = (id: string) => a.app.inject({ method: 'POST', url: `/api/uploads/${id}/complete`, headers: { cookie } });

  /** What the app does before finishing: ask for a link and PUT the bytes there. Returns the upload's id. */
  async function uploaded(body: Buffer, contentType = 'image/jpeg', declared = sha(body)): Promise<string> {
    const res = await a.app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { cookie },
      payload: { contentType, byteSize: body.length, sha256: declared },
    });
    expect(res.statusCode, res.body).toBe(201);
    const ticket = UploadTicket.parse(res.json());
    await storage.put(new URL(ticket.putUrl).pathname.replace('/bucket/', ''), body, contentType);
    return ticket.upload.id;
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t, { images: (clock) => (storage = new GatedStorage(clock)) });
    await ensureOwner(t.db);
    author = await createMember(t.db, 'contributor');
    cookie = await signIn(t.db, a.clock, author);
  });
  // A test that failed while holding a read must not leave its uploads in the queue for the next (#99).
  afterEach(async () => {
    storage.releaseAll();
    await vi.waitFor(() => expect(queuedImages()).toBe(0), { timeout: 10_000 });
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  it('the same upload finished three times at once answers 200 with the same view each time (#95)', async () => {
    const id = await uploaded(await picture(1600, 1200));
    const answers = await Promise.all([complete(id), complete(id), complete(id)]);
    expect(answers.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    const views = answers.map((r) => UploadView.parse(r.json()));
    expect(views[0]).toMatchObject({ id, status: 'ready', width: 1600, height: 1200 });
    expect(views[1]).toEqual(views[0]);
    expect(views[2]).toEqual(views[0]);
    expect(storage.objects.has(`pending/${id}/original`)).toBe(false);
  });

  it('a document finished three times at once answers 200 each time too', async () => {
    const id = await uploaded(PDF, 'application/pdf');
    const answers = await Promise.all([complete(id), complete(id), complete(id)]);
    expect(answers.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(new Set(answers.map((r) => r.body)).size).toBe(1);
  });

  it('a file other than the one announced is refused as such, before its type or pixels are checked (#97)', async () => {
    const announced = await picture(900, 700);
    const broken = Buffer.concat([announced.subarray(0, 64), Buffer.alloc(256, 0x55)]); // a JPEG that cannot be decoded
    const id = await uploaded(broken, 'image/jpeg', sha(announced));
    expect((await complete(id)).json()).toMatchObject({ statusCode: 400, code: 'checksum' });
    expect(storage.objects.has(`pending/${id}/original`)).toBe(false);
    expect(await t.db.selectFrom('upload').select('status').where('id', '=', id).executeTakeFirstOrThrow()).toEqual({ status: 'deleted' });
  });

  it('a file that never arrived is still 409; one refused while the request waited is 404', async () => {
    const res = await a.app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { cookie },
      payload: { contentType: 'image/jpeg', byteSize: 1234, sha256: 'b'.repeat(64) },
    });
    const missing = UploadTicket.parse(res.json()).upload.id;
    expect((await complete(missing)).json()).toMatchObject({ statusCode: 409, code: 'not_uploaded' });

    // Another upload holds the turn; while this one waits for it, another request refuses it.
    const before = await uploaded(await picture(800, 600));
    const release = storage.hold(`pending/${before}/original`);
    const first = complete(before);
    const id = await uploaded(await picture(800, 600));
    const waiting = complete(id);
    await vi.waitFor(() => expect(queuedImages()).toBe(2));
    await t.db.updateTable('upload').set({ status: 'deleted', deleted_at: a.clock.now() }).where('id', '=', id).execute();
    await storage.delete(`pending/${id}/original`);
    release();
    expect((await first).statusCode).toBe(200);
    expect((await waiting).json()).toMatchObject({ statusCode: 404, code: 'not_found' });
  });
  it('a full queue refuses one more upload at once, with 503 and Retry-After; it can be finished later (#97)', async () => {
    const image = await picture(640, 480);
    const ids = [];
    for (let i = 0; i <= QUEUE_LIMIT; i++) ids.push(await uploaded(image));
    const [first, ...rest] = ids;
    const refused = rest.pop()!;
    const release = storage.hold(`pending/${first}/original`);
    const waiting = [complete(first!), ...rest.map((id) => complete(id))];
    await vi.waitFor(() => expect(queuedImages()).toBe(QUEUE_LIMIT));
    const busy = await complete(refused);
    expect(busy.statusCode).toBe(503);
    expect(busy.headers['retry-after']).toBe('10');
    expect(busy.json()).toEqual({ statusCode: 503, error: 'Service Unavailable', message: BUSY_MESSAGE, code: 'busy' });
    release();
    expect((await Promise.all(waiting)).map((r) => r.statusCode)).toEqual(Array.from({ length: QUEUE_LIMIT }, () => 200));
    // The refused upload is untouched, and goes through when tried again.
    expect(storage.log).not.toContain(`get pending/${refused}/original`);
    expect(UploadView.parse((await complete(refused)).json())).toMatchObject({ id: refused, status: 'ready' });
  });

  it('skips an upload whose request was closed while it waited, and frees its place at once (#97)', async () => {
    await a.app.listen({ host: '127.0.0.1', port: 0 });
    const origin = `http://127.0.0.1:${portOf(a.app.server.address())}`;
    const image = await picture(640, 480);
    const first = await uploaded(image);
    const left = await uploaded(image);
    const release = storage.hold(`pending/${first}/original`);
    const holding = complete(first);
    await vi.waitFor(() => expect(queuedImages()).toBe(1));
    // A real connection, closed by the client while its upload waits for the first one.
    const closed = new AbortController();
    const request = expect(fetch(`${origin}/api/uploads/${left}/complete`, { method: 'POST', headers: { cookie }, signal: closed.signal })).rejects.toThrow();
    await vi.waitFor(() => expect(queuedImages()).toBe(2));
    closed.abort();
    await request;
    await vi.waitFor(() => expect(queuedImages()).toBe(1));
    release();
    expect((await holding).statusCode).toBe(200);
    expect(storage.log).not.toContain(`get pending/${left}/original`);
    // Still waiting, so the next request finishes it.
    expect(await t.db.selectFrom('upload').select('status').where('id', '=', left).executeTakeFirstOrThrow()).toEqual({ status: 'waiting' });
    expect(UploadView.parse((await complete(left)).json())).toMatchObject({ id: left, status: 'ready' });
  });
});
