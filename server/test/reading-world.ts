import { ReadingView, UploadTicket } from '@rodokmen/shared';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import type { RodokmenApp } from '../src/app.js';
import type { Account } from '../src/db/types.js';
import { MemoryImageStorage } from '../src/storage/images.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { fakeAnthropic, fakeReader, recording, type FakeApi } from './fake-anthropic.js';
import { createMember, ensureOwner, makeApp, signIn, TestClock } from './helpers.js';

/** An invented register page: ruled scribbles on paper, with a heading. */
export async function page(width = 1200, height = 1600, text = 'Anno 1830'): Promise<Buffer> {
  const lines = Array.from(
    { length: 20 },
    (_, i) => `<path d="M60 ${200 + i * 60} q 100 -16 200 0 t 200 0 t 200 0" stroke="#4a3b28" stroke-width="5" fill="none"/>`,
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#e9dfc7"/><text x="60" y="120" font-size="64">${text}</text>${lines}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

/** The images of a request the reader sent. */
export const imagesIn = (api: FakeApi, n = 0) => api.requests[n]!.body.messages[0]!.content.filter((c) => c.type === 'image');

/** An answer of the API, as the tests read it. */
export interface Answer {
  statusCode: number;
  body: string;
  headers: Record<string, string | string[] | number | undefined>;
  json(): unknown;
}

/**
 * The world of the scan reading tests: the API on a fresh copy of the fixture Tree, objects in
 * memory, the reader on recorded answers of the Messages API, an Owner, a Contributor and an
 * Editor. Before each test scan reading is switched on with a limit of 10, no reading is left,
 * and the API answers with the baptism page.
 */
export interface ReadingWorld {
  t: TestDatabase;
  app: RodokmenApp;
  storage: MemoryImageStorage;
  api: FakeApi;
  clock: TestClock;
  owner: Account;
  contributor: Account;
  editor: Account;
  as: (member: Account, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => Promise<Answer>;
  /** Uploads an image as the app does, and returns the upload id. */
  upload: (member: Account, body: Buffer) => Promise<string>;
  setSwitch: (enabled: boolean, dailyLimit?: number) => Promise<void>;
  /** Asks for a reading, lets the queue run it, and reads it back. */
  read: (member: Account, body: object) => Promise<ReadingView>;
}

export function useReadingWorld(): () => ReadingWorld {
  let w: ReadingWorld | undefined;
  const clock = new TestClock(new Date('2026-11-02T09:00:00Z'));
  beforeAll(async () => {
    const t = await createTestDatabase();
    const api = fakeAnthropic(recording('baptism-page'));
    let storage: MemoryImageStorage | undefined;
    const { app } = await makeApp(t, { clock, images: (c) => (storage = new MemoryImageStorage(c)), reader: fakeReader(api) });
    const as: ReadingWorld['as'] = async (member, method, url, payload) =>
      app.inject({ method, url, headers: { cookie: await signIn(t.db, clock, member), origin: 'http://localhost:3000' }, ...(payload ? { payload } : {}) });
    const world: ReadingWorld = {
      t,
      app,
      storage: storage!,
      api,
      clock,
      owner: await ensureOwner(t.db),
      contributor: await createMember(t.db, 'contributor', { displayName: 'Karel Contributor' }),
      editor: await createMember(t.db, 'editor', { displayName: 'Eva Editor' }),
      as,
      async upload(member, body) {
        const sha256 = createHash('sha256').update(body).digest('hex');
        const ticket = UploadTicket.parse((await as(member, 'POST', '/api/uploads', { contentType: 'image/jpeg', byteSize: body.length, sha256 })).json());
        await world.storage.put(`pending/${ticket.upload.id}/original`, body, 'image/jpeg');
        expect((await as(member, 'POST', `/api/uploads/${ticket.upload.id}/complete`)).statusCode).toBe(200);
        return ticket.upload.id;
      },
      async setSwitch(enabled, dailyLimit = 10) {
        const res = await as(world.owner, 'PUT', '/api/settings/scan-reading', { enabled, dailyLimit });
        expect(res.statusCode, res.body).toBe(200);
      },
      async read(member, body) {
        const res = await as(member, 'POST', '/api/readings', body);
        expect(res.statusCode, res.body).toBe(202);
        await app.readingJobs.idle();
        const done = await as(member, 'GET', `/api/readings/${ReadingView.parse(res.json()).id}`);
        expect(done.statusCode, done.body).toBe(200);
        return ReadingView.parse(done.json());
      },
    };
    w = world;
  });
  afterAll(async () => {
    await w?.app.close();
    await w?.t.drop();
  });
  beforeEach(async () => {
    const world = w!;
    world.api.requests.length = 0;
    world.api.answers.splice(0, world.api.answers.length, recording('baptism-page'));
    await world.t.db.deleteFrom('reading').execute();
    await world.setSwitch(true, 10);
  });
  return () => {
    if (!w) throw new Error('the reading world is set up in beforeAll');
    return w;
  };
}
