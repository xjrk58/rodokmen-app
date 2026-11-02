import { createHash } from 'node:crypto';
import { UploadTicket, UploadView } from '@rodokmen/shared';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Account } from '../src/db/types.js';
import { MemoryImageStorage } from '../src/storage/images.js';
import { queuedImages } from '../src/storage/process.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, makeApp, signIn, type TestApp } from './helpers.js';

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

/** The bucket in memory, where a test can hold up the reads of a key until it lets them go. */
class GatedStorage extends MemoryImageStorage {
  /** Every key read, in order. */
  readonly reads: string[] = [];
  private readonly holds = new Map<string, Promise<void>>();

  /** Reads of `key` wait from now until the returned function is called. */
  hold(key: string): () => void {
    let release!: () => void;
    this.holds.set(key, new Promise<void>((resolve) => (release = resolve)));
    return () => {
      this.holds.delete(key);
      release();
    };
  }

  override async get(storageKey: string): Promise<Buffer | null> {
    this.reads.push(storageKey);
    await this.holds.get(storageKey);
    return super.get(storageKey);
  }
}

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
});
