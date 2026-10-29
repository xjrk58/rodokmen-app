// Helpers for tests that run the service worker against their own server, so
// a test can stop the server (offline) or change the files (a new deploy).
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { startServer } from '../../scripts/lib/static-server.mjs';
import { APP_DIR } from './data.js';
import { expect } from './fixtures.js';

const NOT_DEPLOYED = ['node_modules', 'tests', 'scripts', '.cache', 'test-results', 'playwright-report'];

/** Copies the deployable part of app/ to a temporary directory. */
export async function copyApp() {
  const dir = await mkdtemp(join(tmpdir(), 'rodokmen-app-'));
  await cp(APP_DIR, dir, {
    recursive: true,
    filter: (src) => {
      const rel = relative(APP_DIR, src);
      return rel === '' || !NOT_DEPLOYED.includes(rel.split(sep)[0]);
    },
  });
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) };
}

/** @param {string} root */
export function serve(root) {
  return startServer({ root, base: '/rodokmen-app/' });
}

/**
 * Waits until the page is controlled by an activated service worker.
 * @param {import('@playwright/test').Page} page
 */
export async function waitForServiceWorker(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state ?? 'none')).toBe('activated');
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Record<string, number>>} entries per cache
 */
export function cacheSizes(page) {
  return page.evaluate(async () => {
    /** @type {Record<string, number>} */
    const out = {};
    for (const name of await caches.keys()) out[name] = (await (await caches.open(name)).keys()).length;
    return out;
  });
}
