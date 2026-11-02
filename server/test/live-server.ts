import { buildApp, type RodokmenApp } from '../src/app.js';
import { OutboxMailer } from '../src/mail/mailer.js';
import { DEFAULT_APP_DIR } from '../src/routes/pages.js';
import { MemoryImageStorage } from '../src/storage/images.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { freePort, TestClock, testConfig } from './helpers.js';

/** The real server on a free port with the fixture Tree and the app, its bucket in memory and served at /test-storage/. */
export interface LiveServer {
  t: TestDatabase;
  app: RodokmenApp;
  origin: string;
  clock: TestClock;
  images: MemoryImageStorage;
  close(): Promise<void>;
}

export async function startLiveServer(): Promise<LiveServer> {
  const t = await createTestDatabase();
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const clock = new TestClock(new Date());
  const images = new MemoryImageStorage(clock, `${origin}/test-storage/`);
  const app = await buildApp({
    config: testConfig(t.url, { PUBLIC_ORIGIN: origin, APP_DIR: DEFAULT_APP_DIR }),
    db: t.db,
    mailer: new OutboxMailer(),
    clock,
    images,
    // LIVE_SERVER_LOG=1 prints the server's errors while a test is being debugged.
    logger: process.env.LIVE_SERVER_LOG ? { level: 'error' } : false,
    // The bucket on the same server: the app PUTs uploads to /test-storage/… and reads links from there.
    extraRoutes: (scope) => {
      scope.addContentTypeParser(
        ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'application/msword'],
        { parseAs: 'buffer', bodyLimit: 60 * 1024 * 1024 },
        (_req, body, done) => done(null, body),
      );
      // Public, as a presigned link is: it needs no session.
      scope.put('/test-storage/*', { config: { public: true }, schema: { hide: true } }, async (req, reply) => {
        const key = new URL(req.url, origin).pathname.replace('/test-storage/', '');
        await images.put(key, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.headers['content-type'] ?? 'application/octet-stream');
        return reply.code(200).send();
      });
      scope.get('/test-storage/*', { schema: { hide: true } }, async (req, reply) => {
        const key = new URL(req.url, origin).pathname.replace('/test-storage/', '');
        const object = images.objects.get(key);
        if (!object) return reply.code(404).send();
        return reply.type(key.endsWith('.webp') ? 'image/webp' : object.contentType).send(object.body);
      });
    },
  });
  await app.listen({ host: 'localhost', port });
  return {
    t,
    app,
    origin,
    clock,
    images,
    async close() {
      await app.close();
      await t.drop();
    },
  };
}
