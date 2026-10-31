// Shared Playwright fixtures. Every request that leaves the local test server
// is answered here: tiles and WMS images get a generated PNG, any other page
// (archive portals, map viewers) a small HTML stub. Nothing reaches the network.
import { test as base, expect } from '@playwright/test';
import { tilePng } from './tile-png.js';

export const TILE = tilePng();
export const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//;

/**
 * @typedef {object} Fixtures
 * @property {string[]} external URLs of requests answered by the mock, in order
 * @property {'cs' | 'en' | null} language the language chosen on the device before the app opens; null for none (the app's default, Czech)
 */

/**
 * Answers every non-local request of a browser context.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string[]} log
 */
export async function mockExternal(context, log) {
  await context.route(
    (url) => !LOCAL.test(url.href),
    async (route) => {
      const url = route.request().url();
      log.push(url);
      if (/\.png($|\?)/.test(url) || /[?&]request=GetMap/i.test(url)) {
        await route.fulfill({ status: 200, contentType: 'image/png', body: TILE, headers: { 'access-control-allow-origin': '*' } });
      } else {
        await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>stub</title><p>External page stub for ${url}</p>` });
      }
    },
  );
}

export const test = base.extend(
  /** @type {import('@playwright/test').Fixtures<Fixtures, {}, import('@playwright/test').PlaywrightTestArgs & import('@playwright/test').PlaywrightTestOptions>} */ ({
    external: async ({ context }, use) => {
      /** @type {string[]} */
      const log = [];
      await mockExternal(context, log);
      await use(log);
    },
    // The tests check English labels, so they choose English on the device first, as a
    // reader would in Settings; tests of the default language (Czech) set it to null.
    // A choice the test makes itself (the language switch) is kept across reloads.
    language: ['en', { option: true }],
    // Every test gets the mock, whether or not it reads the log, and the language choice.
    page: async ({ page, context, external, language }, use) => {
      void external;
      if (language) {
        await context.addInitScript((lang) => {
          try {
            if (!localStorage.getItem('rodokmen.language')) localStorage.setItem('rodokmen.language', lang);
          } catch {
            // about:blank has no storage
          }
        }, language);
      }
      await use(page);
    },
  }),
);

export { expect };

/**
 * Opens the app, optionally at "#map=zoom/lat/lon", and waits until it is ready.
 * @param {import('@playwright/test').Page} page
 * @param {{ zoom: number, lat: number, lon: number }} [view]
 */
export async function openApp(page, view) {
  await page.goto(view ? `./#map=${view.zoom}/${view.lat}/${view.lon}` : './');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
}

/**
 * Opens the app centred on a point and taps the map centre, which is that point.
 * @param {import('@playwright/test').Page} page
 * @param {number} lat
 * @param {number} lon
 * @param {number} [zoom]
 */
export async function tapPoint(page, lat, lon, zoom = 13) {
  await openApp(page, { zoom, lat, lon });
  const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await page.locator('#map').boundingBox());
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#place-sheet')).toBeVisible();
}
