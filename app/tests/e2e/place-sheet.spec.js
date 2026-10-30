// Task 3.2 and 5.3: the place sheet with "Open scans", the near-border hint,
// the Jewish registers link and the historical map links.
import { archives, municipality } from './data.js';
import { expect, tapPoint, test } from './fixtures.js';

// In the Svitavy district (SOA Zámrsk), near Bystré, 3.0 km from the nearest
// MZA Brno district (found with the app's own data; no other archive within 5 km).
const NEAR_MZA = { lat: 49.642, lon: 16.34 };

test.describe('English', () => {
  test.use({ locale: 'en-US' });

  test('3 km from the SOA Zámrsk–MZA Brno boundary: also check MZA Brno', async ({ page }) => {
    await tapPoint(page, NEAR_MZA.lat, NEAR_MZA.lon);
    await expect(page.locator('[data-testid="archive"]')).toHaveText('SOA Zámrsk');
    const hint = page.locator('[data-testid="also-check"]');
    await expect(hint).toHaveCount(1);
    await expect(hint).toContainText('also check MZA Brno');
    await expect(hint).toContainText('3.0 km');
  });

  test('far from any archive boundary: no hint', async ({ page }) => {
    const m = municipality('Pardubice');
    await tapPoint(page, m.lat, m.lon);
    await expect(page.locator('[data-testid="archive"]')).toHaveText('SOA Zámrsk');
    await expect(page.locator('[data-testid="also-check"]')).toHaveCount(0);
  });

  test('Escape in Settings closes only Settings, not the place sheet behind it', async ({ page }) => {
    await tapPoint(page, NEAR_MZA.lat, NEAR_MZA.lon);
    await page.locator('#settings-button').click();
    await expect(page.locator('#settings')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings')).toBeHidden();
    await expect(page.locator('#place-sheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#place-sheet')).toBeHidden();
  });

  test('a tap in the countryside shows the nearest municipality and its district', async ({ page }) => {
    await tapPoint(page, NEAR_MZA.lat, NEAR_MZA.lon);
    await expect(page.locator('#place-sheet .eyebrow')).toContainText('Nearest municipality');
    await expect(page.locator('[data-testid="municipality"]')).toHaveText('Bystré');
    await expect(page.locator('[data-testid="district"]')).toHaveText('District Svitavy');
  });

  test('"Open scans" opens the register viewer outside the app and the map keeps its position', async ({ page, context }) => {
    const m = municipality('Pardubice');
    await tapPoint(page, m.lat, m.lon);
    const zamrsk = archives.archives.find((a) => a.id === 'soa-zamrsk');
    const link = page.locator('[data-testid="open-scans"]');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    const before = { url: page.url() };
    const [popup] = await Promise.all([context.waitForEvent('page'), link.click()]);
    await popup.waitForLoadState();
    expect(popup.url()).toBe(zamrsk?.portal.url);
    expect(page.url()).toBe(before.url);
    await expect(page.locator('#place-sheet')).toBeVisible();
  });

  test('every place sheet links to the National Archives for Jewish registers', async ({ page }) => {
    for (const name of ['Pardubice', 'Vsetín']) {
      const m = municipality(name);
      await tapPoint(page, m.lat, m.lon);
      const link = page.locator('[data-testid="jewish-link"]');
      await expect(link).toHaveAttribute('href', archives.jewishRegisters.portal.url);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(page.locator('[data-testid="jewish"]')).toContainText('Národní archiv');
    }
    // Inline link icons stay text-sized.
    for (const svg of await page.locator('#place-sheet a svg').all()) {
      expect((await svg.boundingBox())?.width ?? 0).toBeLessThanOrEqual(20);
    }
  });

  test('the three historical map links each open outside the app', async ({ page, context }) => {
    const m = municipality('Žďár nad Sázavou');
    await tapPoint(page, m.lat, m.lon);
    const expected = {
      cuzk: 'https://ags.cuzk.cz/archiv/',
      oldmaps: `https://www.oldmapsonline.org/en/${encodeURIComponent('Žďár nad Sázavou')}`,
      arcanum: 'https://maps.arcanum.com/en/',
    };
    const links = page.locator('[data-testid="historical"] a');
    await expect(links).toHaveCount(3);
    const start = page.url();
    for (const [id, url] of Object.entries(expected)) {
      const link = page.locator(`[data-viewer="${id}"]`);
      await expect(link).toHaveAttribute('target', '_blank');
      const [popup] = await Promise.all([context.waitForEvent('page'), link.click()]);
      await popup.waitForLoadState();
      expect(popup.url()).toBe(url);
      await popup.close();
      expect(page.url()).toBe(start);
    }
  });

  test('the sheet closes with its close button', async ({ page }) => {
    const m = municipality('Pelhřimov');
    await tapPoint(page, m.lat, m.lon);
    await page.locator('#place-sheet').getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('#place-sheet')).toBeHidden();
    await expect(page.locator('path.place-marker')).toHaveCount(0);
  });
});
