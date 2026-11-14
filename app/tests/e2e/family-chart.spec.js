// add-tree-charts (tree-charts spec), against the mocked API at both viewports: the downloaded SVG
// equals the golden file of the unit tests byte for byte ("Two devices"), and a Chart viewed
// yesterday opens and prints offline with "as of" ("Offline"). The mock answers the Chart routes
// with the golden models of shared/test/golden/charts/, which the golden SVG files are made from.
// The real server's flow is in server/test/charts.e2e.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fontFaceCss, FONT_FILES } from '../../src/chart-fonts.js';
import { member, mockFamilyApi } from './family-api.js';
import { P } from './family-data.js';
import { APP_DIR } from './data.js';
import { expect, test } from './fixtures.js';
import { serve, waitForServiceWorker } from './sw-helpers.js';

const golden = (/** @type {string} */ name) => readFileSync(join(APP_DIR, '..', 'shared', 'test', 'golden', 'charts', `${name}.json`), 'utf8');
/** The Chart routes: the screen's model, or the Sheet's of the variant asked for. */
const charts = {
  'GET charts/descendants': (/** @type {RegExpExecArray} */ _m, /** @type {URL} */ url) => {
    const sheet = url.searchParams.get('sheet');
    return {
      json: /** @type {unknown} */ (
        JSON.parse(golden(sheet === 'nameless' ? 'novak-tree-nameless' : sheet === 'reduced' ? 'novak-tree-reduced' : 'novak-tree-4'))
      ),
    };
  },
};
const address = `#chart/descendants/person/${P.jan}`;
/** @type {unknown} */
const screenModel = JSON.parse(golden('novak-tree-4'));
const firstId = /** @type {{ nodes: Array<{ personId: string }> }} */ (screenModel).nodes[0]?.personId ?? '';

test.use({ language: null });

test('"Two devices": the downloaded SVG is the golden file, byte for byte, with its fonts inside', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor', { language: 'cs' }), extra: charts });
  await page.goto(`./${address}`);
  await expect(page.getByTestId('chart').locator('[data-card]').first()).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('chart-svg').click()]);
  const svg = readFileSync(/** @type {string} */ (await download.path()), 'utf8');
  const fonts = fontFaceCss(FONT_FILES.map(([, , , path]) => readFileSync(join(APP_DIR, path)).toString('base64')));
  const expected = readFileSync(join(APP_DIR, 'tests', 'unit', 'golden', 'charts', 'novak-tree-reduced.cs.svg'), 'utf8').replace('/*FONTS*/', fonts);
  expect(svg === expected).toBe(true);
});

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow', timezoneId: 'Europe/Prague' });

  test('"Offline": a Chart viewed yesterday opens without a connection, with "as of", and prints', async ({ page, context }) => {
    await mockFamilyApi(context, { me: member('contributor', { language: 'cs' }), extra: charts });
    const server = await serve(APP_DIR);
    try {
      await page.clock.setFixedTime(new Date('2026-11-13T18:20:00+01:00'));
      await page.goto(server.url);
      await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
      await waitForServiceWorker(page);
      await page.goto(`${server.url}${address}`);
      await expect(page.getByTestId('chart').locator('[data-card]').first()).toBeVisible();
      // The Sheet's variant is kept too, so that the Chart prints offline.
      await expect(page.getByTestId('chart-screen')).toHaveAttribute('data-sheet-ready', 'true');
    } finally {
      await server.close();
    }
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.route('**/*', (route) => route.abort('internetdisconnected'));
    await context.setOffline(true);
    await page.clock.setFixedTime(new Date('2026-11-14T09:30:00+01:00'));
    await page.goto('about:blank');
    await page.goto(`${server.url}${address}`);
    await expect(page.getByTestId('chart').locator(`[data-person="${firstId}"]`).first()).toBeVisible();
    await expect(page.getByTestId('as-of')).toContainText('2026');
    await page.evaluate(() => {
      window.print = () => undefined;
    });
    await page.getByTestId('chart-print').click();
    await expect(page.getByTestId('print-page')).toHaveCount(1);
  });
});
