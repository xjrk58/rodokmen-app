// Tasks 4.1 and 4.2: diacritic-insensitive search with district labels, and
// jumping to a result.
import { municipalities, municipality } from './data.js';
import { expect, openApp, test } from './fixtures.js';

test.use({ locale: 'en-US' });

/**
 * The map view as [zoom, lat, lon], which the app mirrors in the URL as #map=zoom/lat/lon once any animation ends.
 * @param {import('@playwright/test').Page} page
 */
async function mapView(page) {
  const match = (await page.evaluate(() => location.hash)).match(/^#map=([\d.]+)\/([\d.]+)\/([\d.]+)$/);
  return match ? match.slice(1).map(Number) : [];
}

test('"zdar" finds Žďár nad Sázavou', async ({ page }) => {
  await openApp(page);
  await page.locator('#search-input').fill('zdar');
  const result = page.locator('#search-results li', { hasText: 'Žďár nad Sázavou' });
  await expect(result).toHaveCount(1);
  await expect(result).toContainText('district Žďár nad Sázavou');
});

test('case and diacritics do not matter in the query either', async ({ page }) => {
  await openApp(page);
  for (const query of ['ŽĎÁR NAD', 'Zdar nad sazavou', 'žďár nad sázavou']) {
    await page.locator('#search-input').fill(query);
    await expect(page.locator('#search-results li', { hasText: 'Žďár nad Sázavou' })).toHaveCount(1);
  }
});

test('"Adamov" lists every Adamov with its district', async ({ page }) => {
  await openApp(page);
  await page.locator('#search-input').fill('Adamov');
  const expected = municipalities
    .filter((m) => m.name === 'Adamov')
    .map((m) => m.district)
    .sort();
  expect(expected.length).toBeGreaterThan(1);
  const rows = page.locator('#search-results li').filter({ has: page.locator('.name', { hasText: /^Adamov$/ }) });
  await expect(rows).toHaveCount(expected.length);
  const districts = (await rows.locator('.district').allTextContents()).map((s) => s.replace(/^district /, '')).sort();
  expect(districts).toEqual(expected);
});

test('a query that matches nothing says so', async ({ page }) => {
  await openApp(page);
  await page.locator('#search-input').fill('xyzzy');
  await expect(page.locator('#search-results li')).toHaveCount(0);
  await expect(page.locator('#search-note')).toContainText('No municipality matches');
});

test('Enter in an emptied search box opens nothing', async ({ page }) => {
  await openApp(page);
  const input = page.locator('#search-input');
  await input.fill('Adamov');
  await expect(page.locator('#search-results li').first()).toBeVisible();
  // Emptied with the clear button, and with the keyboard.
  await page.locator('#search-clear').click();
  await input.press('Enter');
  await input.fill('Adamov');
  await expect(page.locator('#search-results li').first()).toBeVisible();
  await input.fill('');
  await input.press('Enter');
  await expect(page.locator('#search-results-box')).toBeHidden();
  await expect(page.locator('#place-sheet')).toBeHidden();
});

test('choosing a result centres the map on it and opens its place sheet', async ({ page }) => {
  const target = municipality('Adamov', 'Blansko');
  await openApp(page);
  await page.locator('#search-input').fill('Adamov');
  await page
    .locator('#search-results li', { hasText: 'district Blansko' })
    .filter({ has: page.locator('.name', { hasText: /^Adamov$/ }) })
    .click();
  await expect(page.locator('#place-sheet')).toBeVisible();
  await expect(page.locator('[data-testid="municipality"]')).toHaveText('Adamov');
  await expect(page.locator('[data-testid="district"]')).toHaveText('District Blansko');
  await expect(page.locator('[data-testid="archive"]')).toHaveText('MZA Brno');
  await expect(page.locator('#search-results-box')).toBeHidden();
  await expect.poll(async () => (await mapView(page))[0]).toBeGreaterThanOrEqual(12);
  const [, lat, lon] = await mapView(page);
  expect(lat).toBeCloseTo(target.lat, 3);
  expect(lon).toBeCloseTo(target.lon, 3);
  await expect(page.locator('path.place-marker')).toHaveCount(1);
});

test('keyboard: arrow down and Enter choose a result', async ({ page }) => {
  await openApp(page);
  await page.locator('#search-input').fill('Pelhřimov');
  await page.locator('#search-input').press('ArrowDown');
  await expect(page.locator('#search-results li').first()).toHaveAttribute('aria-selected', 'true');
  await page.locator('#search-input').press('Enter');
  await expect(page.locator('[data-testid="municipality"]')).toHaveText('Pelhřimov');
  await expect(page.locator('[data-testid="archive"]')).toHaveText('SOA Třeboň');
});
