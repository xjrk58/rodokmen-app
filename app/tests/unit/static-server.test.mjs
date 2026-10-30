// The local static server (scripts/serve.mjs and the service worker tests).
import assert from 'node:assert/strict';
import { relative } from 'node:path';
import { test } from 'node:test';
import { startServer } from '../../scripts/lib/static-server.mjs';
import { APP } from './helpers.mjs';

/**
 * @param {string} root
 * @param {(url: string) => Promise<void>} check
 */
async function withServer(root, check) {
  const server = await startServer({ root, base: '/rodokmen-app/' });
  try {
    await check(server.url);
  } finally {
    await server.close();
  }
}

test('a relative root serves its files', async () => {
  await withServer(relative(process.cwd(), APP) || '.', async (url) => {
    assert.equal((await fetch(`${url}index.html`)).status, 200);
    assert.equal((await fetch(url)).status, 200);
  });
});

test('a malformed escape in the path is a bad request, not a server error', async () => {
  await withServer(APP, async (url) => {
    assert.equal((await fetch(`${url}%E0%A4%A`)).status, 400);
  });
});

test('a path that leaves the root is refused', async () => {
  await withServer(APP, async (url) => {
    assert.equal((await fetch(`${url}..%2f..%2fpackage.json`)).status, 403);
  });
});
