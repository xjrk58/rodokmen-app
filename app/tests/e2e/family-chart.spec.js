// add-tree-charts (tree-charts spec), against the mocked API at both viewports: the downloaded SVG
// equals the golden file of the unit tests byte for byte ("Two devices"), and a Chart viewed
// yesterday opens and prints offline with "as of" ("Offline"). The mock answers the Chart routes
// with the golden models of shared/test/golden/charts/, which the golden SVG files are made from.
// add-kinship task 8.2 (tree-charts spec, "Kinship on Chart cards"): the switch "Kinship to me",
// with each card's kinship from tests/e2e/chart-kinship.json, the server's rules on the same
// invented family (tests/unit/chart-kinship.test.mjs). The real server's flow is in
// server/test/charts.e2e.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fontFaceCss, FONT_FILES } from '../../src/chart-fonts.js';
import { member, mockFamilyApi } from './family-api.js';
import { ID, P } from './family-data.js';
import { APP_DIR } from './data.js';
import { expect, test } from './fixtures.js';
import { serve, waitForServiceWorker } from './sw-helpers.js';

const golden = (/** @type {string} */ name) => readFileSync(join(APP_DIR, '..', 'shared', 'test', 'golden', 'charts', `${name}.json`), 'utf8');
/** @type {unknown} */
const shortForms = JSON.parse(readFileSync(new URL('./chart-kinship.json', import.meta.url), 'utf8'));
/** Each reader's short form of every Person of the Chart, by id (tests/unit/chart-kinship.test.mjs). */
const SHORT = /** @type {Record<string, Record<string, unknown>>} */ (shortForms);
/** Persons of the invented family of the Chart (shared/test/chart-fixture.ts): the start, a grandson, and the readers, father and son. */
const C = { start: ID(1), karel: ID(4), reader: ID(13), son: ID(14) };

/**
 * The Chart routes: the screen's model, or the Sheet's of the variant asked for. With kinship=1,
 * every card carries the reader's short form, as the server answers; the mock adds it to any reply
 * asked for with kinship=1, a Sheet's too, so that a Sheet asked for with kinship would show it.
 * @param {string | null} [reader] the Member's own Person
 */
const chartsFor = (reader = null) => ({
  'GET charts/descendants': (/** @type {RegExpExecArray} */ _m, /** @type {URL} */ url) => {
    const sheet = url.searchParams.get('sheet');
    /** @type {unknown} */
    const parsed = JSON.parse(golden(sheet === 'nameless' ? 'novak-tree-nameless' : sheet === 'reduced' ? 'novak-tree-reduced' : 'novak-tree-4'));
    const model = /** @type {{ persons: Array<{ id: string }> }} */ (parsed);
    if (reader && url.searchParams.get('kinship') === '1') model.persons = model.persons.map((p) => ({ ...p, kinship: SHORT[reader]?.[p.id] ?? null }));
    return { json: /** @type {unknown} */ (model) };
  },
});
const charts = chartsFor();
const address = `#chart/descendants/person/${P.jan}`;
/** @type {unknown} */
const screenModel = JSON.parse(golden('novak-tree-4'));
const firstId = /** @type {{ nodes: Array<{ personId: string }> }} */ (screenModel).nodes[0]?.personId ?? '';

test.use({ language: null });

/** The SVG file the Chart's download button gives. @param {import('@playwright/test').Page} page */
async function downloadedSvg(page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('chart-svg').click()]);
  return readFileSync(/** @type {string} */ (await download.path()), 'utf8');
}
const fonts = fontFaceCss(FONT_FILES.map(([, , , path]) => readFileSync(join(APP_DIR, path)).toString('base64')));
/** The golden SVG file of the reduced Sheet, with the fonts' rules a download carries. */
const goldenSvg = readFileSync(join(APP_DIR, 'tests', 'unit', 'golden', 'charts', 'novak-tree-reduced.cs.svg'), 'utf8').replace('/*FONTS*/', fonts);
/** A Person's first card on screen. @param {import('@playwright/test').Page} page @param {string} id */
const cardOf = (page, id) => page.getByTestId('chart').locator(`[data-card="person"][data-person="${id}"]`).first();
/** A Member whose own Person is one of the readers of tests/e2e/chart-kinship.json. @param {string} reader */
const readerMember = (reader) => member('contributor', { language: 'cs', person: Number(reader.slice(-12)) });
/** Switches kinship on on the device before the app opens. @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} target */
const kinshipOnDevice = (target) =>
  target.addInitScript(() => {
    try {
      localStorage.setItem('rodokmen.chartKinship', 'on');
    } catch {
      // about:blank has no storage
    }
  });

test('"Two devices": the downloaded SVG is the golden file, byte for byte, with its fonts inside', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor', { language: 'cs' }), extra: charts });
  await page.goto(`./${address}`);
  await expect(page.getByTestId('chart').locator('[data-card]').first()).toBeVisible();
  expect((await downloadedSvg(page)) === goldenSvg).toBe(true);
});

test.describe('kinship on the cards (add-kinship 8.2)', () => {
  test('"Switched on": off by default, then each card shows the reader\'s kinship; remembered on the device, kept out of the address, no overflow', async ({
    page,
  }) => {
    const calls = await mockFamilyApi(page, { me: readerMember(C.reader), extra: chartsFor(C.reader) });
    await page.goto(`./${address}`);
    await expect(cardOf(page, C.start)).toBeVisible();
    await page.getByTestId('chart-options').locator('summary').click();
    const box = page.getByTestId('chart-kinship');
    await expect(box).not.toBeChecked();
    await expect(cardOf(page, C.start)).not.toContainText('praděd');
    await box.check();
    await expect(cardOf(page, C.start)).toContainText('praděd');
    await expect(cardOf(page, C.reader)).toContainText('vy');
    // A grandfather only through a link with no confirming Citation.
    await expect(cardOf(page, C.karel)).toContainText('možná děd');
    expect(page.url()).not.toContain('kinship');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.reload();
    await expect(cardOf(page, C.start)).toContainText('praděd');
    await page.getByTestId('chart-options').locator('summary').click();
    await expect(page.getByTestId('chart-kinship')).toBeChecked();
    expect(calls.filter((c) => c.includes('kinship=1')).length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.includes('sheet=') && c.includes('kinship'))).toEqual([]);
  });

  test('a Member with no own Person has no switch', async ({ page }) => {
    await mockFamilyApi(page, { me: member('contributor', { language: 'cs' }), extra: chartsFor(C.reader) });
    await kinshipOnDevice(page);
    await page.goto(`./${address}`);
    await expect(cardOf(page, C.start)).toBeVisible();
    await page.getByTestId('chart-options').locator('summary').click();
    await expect(page.getByTestId('chart-kinship')).toHaveCount(0);
    await expect(cardOf(page, C.start)).not.toContainText('praděd');
  });

  test('"Printing": the downloaded SVG is the golden file with kinship switched off and on, and the print shows no kinship', async ({ page }) => {
    const calls = await mockFamilyApi(page, { me: readerMember(C.reader), extra: chartsFor(C.reader) });
    await page.goto(`./${address}`);
    await expect(cardOf(page, C.start)).toBeVisible();
    expect((await downloadedSvg(page)) === goldenSvg).toBe(true);
    await page.getByTestId('chart-options').locator('summary').click();
    await page.getByTestId('chart-kinship').check();
    await expect(cardOf(page, C.start)).toContainText('praděd');
    const svg = await downloadedSvg(page);
    expect(svg).not.toContain('praděd');
    expect(svg === goldenSvg).toBe(true);
    await page.evaluate(() => {
      window.print = () => undefined;
    });
    await page.getByTestId('chart-print').click();
    await expect.poll(() => page.getByTestId('print-page').count()).toBeGreaterThan(0);
    expect(await page.getByTestId('chart-print-pages').textContent()).not.toMatch(/praděd|prababička|možná/);
    expect(calls.filter((c) => c.includes('sheet=') && c.includes('kinship'))).toEqual([]);
  });

  test('"Shared link": the same address shows each Member their own kinship', async ({ page, browser }) => {
    await mockFamilyApi(page, { me: readerMember(C.reader), extra: chartsFor(C.reader) });
    await kinshipOnDevice(page);
    await page.goto(`./${address}`);
    await expect(cardOf(page, C.reader)).toContainText('vy');
    await expect(cardOf(page, C.start)).toContainText('praděd');
    const other = await browser.newContext({ viewport: page.viewportSize() });
    try {
      await mockFamilyApi(other, { me: readerMember(C.son), extra: chartsFor(C.son) });
      await kinshipOnDevice(other);
      const theirs = await other.newPage();
      await theirs.goto(page.url());
      await expect(cardOf(theirs, C.reader)).toContainText('otec');
      await expect(cardOf(theirs, C.start)).toContainText('prapraděd');
    } finally {
      await other.close();
    }
  });
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

  test('a Chart kept without kinship shows none offline with kinship switched on, and says why', async ({ page, context }) => {
    await mockFamilyApi(context, { me: readerMember(C.reader), extra: chartsFor(C.reader) });
    const server = await serve(APP_DIR);
    try {
      await page.goto(server.url);
      await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
      await waitForServiceWorker(page);
      await page.goto(`${server.url}${address}`);
      await expect(cardOf(page, C.start)).toBeVisible();
      await expect(page.getByTestId('chart-screen')).toHaveAttribute('data-sheet-ready', 'true');
    } finally {
      await server.close();
    }
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.route('**/*', (route) => route.abort('internetdisconnected'));
    await context.setOffline(true);
    await page.evaluate(() => localStorage.setItem('rodokmen.chartKinship', 'on'));
    await page.goto('about:blank');
    await page.goto(`${server.url}${address}`);
    await expect(cardOf(page, C.start)).toBeVisible();
    await expect(page.getByTestId('chart-kinship-offline')).toBeVisible();
    await expect(cardOf(page, C.start)).not.toContainText('praděd');
    await expect(cardOf(page, C.reader)).not.toContainText('vy');
  });
});
