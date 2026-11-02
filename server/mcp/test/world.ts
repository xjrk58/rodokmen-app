import type { CallToolResult } from '@modelcontextprotocol/client';
import { afterAll, beforeAll } from 'vitest';
import { buildApp, type RodokmenApp } from '../../src/app.js';
import type { Account } from '../../src/db/types.js';
import { createTestDatabase, type TestDatabase } from '../../test/db.js';
import { createAgentWithToken, createMember, ensureOwner, freePort, signIn, TestClock, testConfig } from '../../test/helpers.js';
import { OutboxMailer } from '../../src/mail/mailer.js';
import type { Reader } from '../../src/readings/reader.js';
import { MemoryImageStorage } from '../../src/storage/images.js';

/**
 * The world of the MCP tests: the real API on a fresh copy of the fixture Tree, listening on a
 * local port, with an Owner, an Editor and an Agent with a token. The MCP server reaches it
 * only over HTTP, as it does in production.
 */
export interface World {
  t: TestDatabase;
  app: RodokmenApp;
  /** Where the API listens, such as http://127.0.0.1:41234. */
  apiUrl: string;
  clock: TestClock;
  owner: Account;
  editor: Account;
  agent: Account;
  token: string;
  tokenId: string;
  /** The image store, in memory, served at /test-storage/ of the API (presigned links point there). */
  storage: MemoryImageStorage;
  /** Calls the API as the Owner or the Editor. */
  as: (who: 'owner' | 'editor', method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) => Promise<{ statusCode: number; json(): unknown }>;
}

export function useWorld(agentName = 'Register reader', options: { reader?: Reader } = {}): () => World {
  let world: World | undefined;
  beforeAll(async () => {
    const t = await createTestDatabase();
    const port = await freePort();
    const apiUrl = `http://127.0.0.1:${port}`;
    const clock = new TestClock(new Date());
    const storage = new MemoryImageStorage(clock, `${apiUrl}/test-storage/`);
    const app = await buildApp({
      config: testConfig(t.url, { PUBLIC_ORIGIN: apiUrl }),
      db: t.db,
      mailer: new OutboxMailer(),
      clock,
      images: storage,
      reader: options.reader ?? null,
      // Stands in for the image store that presigned upload links point at.
      extraRoutes: (scope) => {
        scope.addContentTypeParser(['image/jpeg', 'image/png', 'image/webp'], { parseAs: 'buffer', bodyLimit: 30 * 1024 * 1024 }, (_req, body, done) =>
          done(null, body),
        );
        scope.put('/test-storage/*', { config: { public: true }, schema: { hide: true } }, async (req, reply) => {
          const key = new URL(req.url, apiUrl).pathname.replace('/test-storage/', '');
          await storage.put(key, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.headers['content-type'] ?? 'application/octet-stream');
          return reply.code(200).send();
        });
      },
    });
    await app.listen({ host: '127.0.0.1', port });
    const owner = await ensureOwner(t.db);
    const editor = await createMember(t.db, 'editor', { displayName: 'Eva Editor' });
    const cookies = { owner: await signIn(t.db, clock, owner), editor: await signIn(t.db, clock, editor) };
    const { agent, token, tokenId } = await createAgentWithToken(t.db, clock, agentName);
    const as: World['as'] = (who, method, url, payload) =>
      app.inject({ method, url, headers: { cookie: cookies[who], origin: apiUrl }, ...(payload ? { payload } : {}) });
    world = { t, app, apiUrl, clock, owner, editor, agent, token, tokenId, as, storage };
  }, 60_000);
  afterAll(async () => {
    await world?.app.close();
    await world?.t.drop();
  });
  return () => {
    if (!world) throw new Error('the MCP test world is set up in beforeAll');
    return world;
  };
}

/** The JSON a tool answered, or the error text it gave. */
export function resultOf(result: CallToolResult): { error: string | null; json: unknown } {
  const text = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
  if (result.isError) return { error: text, json: null };
  const json: unknown = JSON.parse(text);
  return { error: null, json };
}
