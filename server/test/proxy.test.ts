import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './db.js';
import { caddyBlock, caddyfile, caddySetting, durationMs } from './deploy-files.js';
import { makeApp } from './helpers.js';

/**
 * Caddy (deploy/caddy/Caddyfile) and the API behind it agree on idle keep-alive connections
 * (#90). If the API closed one first, Caddy could send a request on it at that very moment, and a
 * POST would fail with 502.
 */

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

describe('Caddy in front of the API', () => {
  it('reaches the API slots only through the snippet api-slot', () => {
    expect(caddyfile().match(/reverse_proxy\s+api-/g)).toHaveLength(1);
    expect(caddyBlock('(api-slot)')).toMatch(/reverse_proxy\s+api-/);
  });

  it('gives up an idle connection to the API at least 10 s before the API would close it', async () => {
    const { app } = await makeApp(t);
    const caddy = durationMs(caddySetting(caddyBlock('(api-slot)'), 'keepalive'));
    expect(caddy).toBeLessThanOrEqual(app.server.keepAliveTimeout - 10_000);
    await app.close();
  });
});
