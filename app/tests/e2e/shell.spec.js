// Task 1.1 and map-view: the full-screen map of the Czech Republic, with
// boundaries that draw without tiles.
import { expect, openApp, test } from './fixtures.js';

test('opens on the whole Czech Republic with district and national borders', async ({ page }) => {
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await openApp(page);
  await expect(page.locator('path.district-boundary')).toHaveCount(77);
  const border = page.locator('path.national-border');
  await expect(border).toHaveCount(1);
  const box = await border.boundingBox();
  const viewport = /** @type {{ width: number, height: number }} */ (page.viewportSize());
  expect(box).not.toBeNull();
  if (!box) return;
  // The whole country is on screen and fills most of the width.
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(box.width).toBeGreaterThan(viewport.width * 0.5);
  await expect(page.locator('img.leaflet-tile-loaded').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('borders and archive regions draw when the tile server cannot be reached', async ({ page, context }) => {
  await context.route(/tile\.openstreetmap\.org/, (route) => route.abort('internetdisconnected'));
  await openApp(page);
  await expect(page.locator('path.district-boundary')).toHaveCount(77);
  await expect(page.locator('path.national-border')).toHaveCount(1);
  // The tiles were asked for and have all failed (a failed image is "complete" too).
  const tiles = page.locator('img.leaflet-tile');
  await expect(tiles).not.toHaveCount(0);
  await expect.poll(() => tiles.evaluateAll((imgs) => imgs.every((img) => img instanceof HTMLImageElement && img.complete))).toBe(true);
  await expect(page.locator('img.leaflet-tile-loaded')).toHaveCount(0);
  await page.locator('#layers-button').click();
  await page.locator('#regions-toggle').check();
  await expect(page.locator('path.archive-region')).toHaveCount(77);
});

test('the map pans and zooms', async ({ page }) => {
  await openApp(page);
  const before = await page.evaluate(() => location.hash);
  await page.locator('.leaflet-control-zoom-in').click();
  await expect.poll(() => page.evaluate(() => location.hash)).not.toBe(before);
  const zoomed = await page.evaluate(() => location.hash);
  const map = page.locator('#map');
  const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await map.boundingBox());
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 - 60, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => location.hash)).not.toBe(zoomed);
});
