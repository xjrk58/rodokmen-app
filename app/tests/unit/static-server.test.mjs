// The local static server (scripts/serve.mjs and the service worker tests).
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { startServer } from '../../scripts/lib/static-server.mjs';
import { copySite } from '../../scripts/site-files.mjs';
import { computeVersion, STAMPED_FILES, stampIn, stampText, UNSTAMPED } from '../../scripts/stamp-version.mjs';
import { APP } from './helpers.mjs';

/**
 * @param {string} root
 * @param {(url: string) => Promise<void>} check
 * @param {boolean} [stamp]
 */
async function withServer(root, check, stamp = false) {
  const server = await startServer({ root, base: '/rodokmen-app/', stamp });
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

/** @param {string} url */
const servedStamps = async (url) => Promise.all(STAMPED_FILES.map(async (file) => stampIn(file, await (await fetch(`${url}${file}`)).text())));

test('with stamp, sw.js and src/version.js go out stamped with the files as they are at that moment (#91)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'site-'));
  try {
    // A copy of the site with the placeholder, as app/ has it in a checkout.
    await copySite(dir);
    for (const file of STAMPED_FILES) {
      const path = join(dir, file);
      await writeFile(path, stampText(file, await readFile(path, 'utf8'), UNSTAMPED));
    }
    await withServer(
      dir,
      async (url) => {
        const before = await computeVersion(dir);
        assert.deepEqual(await servedStamps(url), [before, before]);
        await appendFile(join(dir, 'styles.css'), '\n/* changed */\n');
        const after = await computeVersion(dir);
        assert.notEqual(after, before);
        assert.deepEqual(await servedStamps(url), [after, after]);
      },
      true,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('without stamp, the files go out as they are on disk', async () => {
  await withServer(APP, async (url) => {
    assert.deepEqual(await servedStamps(url), [UNSTAMPED, UNSTAMPED]);
  });
});
