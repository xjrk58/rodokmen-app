// Task 3.3: the archive regions layer and its legend.
import { archives } from './data.js';
import { expect, openApp, test } from './fixtures.js';

test('every archive appears in the legend and each district is tinted by its archive', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('[data-testid="legend"]')).toHaveCount(0);
  await page.locator('#layers-button').click();
  await page.locator('#regions-toggle').check();
  const legend = page.locator('[data-testid="legend"]');
  await expect(legend).toBeVisible();
  const items = legend.locator('li');
  await expect(items).toHaveText(archives.archives.map((a) => a.name));
  for (const archive of archives.archives) {
    await expect(legend.locator(`[data-archive="${archive.id}"]`)).toBeVisible();
  }
  const fills = await page.locator('path.archive-region').evaluateAll((paths) => paths.map((p) => p.getAttribute('fill')));
  expect(fills).toHaveLength(77);
  expect(new Set(fills)).toEqual(new Set(archives.archives.map((a) => a.color)));
});

test('the regions layer stays on after a reload and can be switched off', async ({ page }) => {
  await openApp(page);
  await page.locator('#layers-button').click();
  await page.locator('#regions-toggle').check();
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('path.archive-region')).toHaveCount(77);
  await page.locator('#layers-button').click();
  await page.locator('#regions-toggle').uncheck();
  await expect(page.locator('path.archive-region')).toHaveCount(0);
  await expect(page.locator('[data-testid="legend"]')).toHaveCount(0);
});
