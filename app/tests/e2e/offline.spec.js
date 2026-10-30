// Task 6.2 and offline-app: after one online visit the shell, search, archive
// lookup and borders work without network; viewed tiles come from the cache.
import { PRECACHE } from '../../src/precache.js';
import { APP_DIR } from './data.js';
import { LOCAL, expect, test } from './fixtures.js';
import { cacheSizes, serve, waitForServiceWorker } from './sw-helpers.js';

test.use({ serviceWorkers: 'allow', locale: 'en-US' });

test('offline reload opens the map, searches and shows a place sheet', async ({ page, context }) => {
  const server = await serve(APP_DIR);
  try {
    // First visit, online.
    await page.goto(`${server.url}#map=9/49.75/15.5`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await waitForServiceWorker(page);
    await expect.poll(async () => Object.entries(await cacheSizes(page)).find(([k]) => k.startsWith('rodokmen-shell-'))?.[1]).toBe(PRECACHE.length);
    // The reader moves the map once the worker is in control; those tiles are cached.
    await page.evaluate(() => {
      location.hash = '#map=10/49.6/15.9';
    });
    await expect.poll(async () => (await cacheSizes(page))['rodokmen-tiles'] ?? 0).toBeGreaterThan(0);
  } finally {
    await server.close();
  }

  // No network from here on: the server is gone and every external request fails.
  /** @type {string[]} */
  const blocked = [];
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  await context.route(
    (url) => !LOCAL.test(url.href),
    (route) => {
      blocked.push(route.request().url());
      return route.abort('internetdisconnected');
    },
  );
  await context.setOffline(true);

  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('path.district-boundary')).toHaveCount(77);
  await expect(page.locator('path.national-border')).toHaveCount(1);
  // Tiles viewed online are served from the tile cache.
  await expect(page.locator('img.leaflet-tile-loaded').first()).toBeVisible();

  await page.locator('#search-input').fill('zdar');
  await page.locator('#search-results li', { hasText: 'Žďár nad Sázavou' }).click();
  await expect(page.locator('[data-testid="municipality"]')).toHaveText('Žďár nad Sázavou');
  await expect(page.locator('[data-testid="archive"]')).toHaveText('MZA Brno');

  await page.locator('#layers-button').click();
  await page.locator('#regions-toggle').check();
  await expect(page.locator('path.archive-region')).toHaveCount(77);
  // Only tiles never viewed online are missing.
  expect(blocked.every((u) => /tile\.openstreetmap\.org/.test(u))).toBe(true);
});

test('tiles are cached only as they are viewed', async ({ page }) => {
  const server = await serve(APP_DIR);
  try {
    await page.goto(`${server.url}#map=8/49.8/15.5`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await waitForServiceWorker(page);
    // Reload so the first tiles go through the worker.
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await expect.poll(async () => (await cacheSizes(page))['rodokmen-tiles'] ?? 0).toBeGreaterThan(0);
    const viewed = await page.locator('img.leaflet-tile').evaluateAll((imgs) => imgs.map((i) => /** @type {HTMLImageElement} */ (i).src));
    const cached = await page.evaluate(async () => (await (await caches.open('rodokmen-tiles')).keys()).map((r) => r.url));
    // Nothing is cached that was not on screen.
    for (const url of cached) expect(viewed).toContain(url);
  } finally {
    await server.close();
  }
});

test('a damaged tile index does not stop the map tiles: they come from the network and are cached again', async ({ page }) => {
  const server = await serve(APP_DIR);
  try {
    await page.goto(`${server.url}#map=8/49.8/15.5`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await waitForServiceWorker(page);
    // The saved use order is unreadable (a write cut short, a bug in an older version).
    await page.evaluate(async (key) => {
      await (
        await caches.open('rodokmen-meta')
      ).put(key, new Response('["https://tile.openstreetmap.org/8/1', { headers: { 'content-type': 'application/json' } }));
    }, `${server.url}__tile-lru__.json`);
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('img.leaflet-tile-loaded').first()).toBeVisible();
    await expect.poll(async () => (await cacheSizes(page))['rodokmen-tiles'] ?? 0).toBeGreaterThan(0);
  } finally {
    await server.close();
  }
});
