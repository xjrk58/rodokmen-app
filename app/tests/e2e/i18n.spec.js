// Task 1.2: Czech and English interface, from the browser language with
// English as the fallback, and switchable by the reader.
import { expect, openApp, test } from './fixtures.js';

test.describe('Czech browser', () => {
  test.use({ locale: 'cs-CZ' });
  test('shows Czech labels', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'cs');
    await expect(page.locator('#search-input')).toHaveAttribute('placeholder', 'Najít obec');
    await expect(page.locator('#layers-button')).toHaveAttribute('aria-label', 'Vrstvy mapy');
    await expect(page.locator('#settings-button')).toHaveAttribute('aria-label', 'Nastavení');
    await page.locator('#search-input').fill('Pardubice');
    await expect(page.locator('#search-results li').first()).toContainText('okres Pardubice');
    await page.locator('#search-results li').first().click();
    await expect(page.locator('[data-testid="open-scans"]')).toHaveText('Otevřít skeny');
    await expect(page.locator('[data-testid="historical"] h3')).toHaveText('Historické mapy');
  });
});

test.describe('English browser', () => {
  test.use({ locale: 'en-US' });
  test('shows English labels', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#search-input')).toHaveAttribute('placeholder', 'Find a municipality');
    await expect(page.locator('#layers-button')).toHaveAttribute('aria-label', 'Map layers');
    await page.locator('#search-input').fill('Pardubice');
    await page.locator('#search-results li').first().click();
    await expect(page.locator('[data-testid="open-scans"]')).toHaveText('Open scans');
  });
});

test.describe('Other browser language', () => {
  test.use({ locale: 'de-DE' });
  test('falls back to English', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#search-input')).toHaveAttribute('placeholder', 'Find a municipality');
  });
});

test.describe('Language switch', () => {
  test.use({ locale: 'en-US' });
  test('switches to Czech and keeps the choice', async ({ page }) => {
    await openApp(page);
    await page.locator('#settings-button').click();
    await page.getByLabel('Čeština').check();
    await expect(page.locator('#settings-title')).toHaveText('Nastavení');
    await expect(page.locator('#search-input')).toHaveAttribute('placeholder', 'Najít obec');
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#search-input')).toHaveAttribute('placeholder', 'Najít obec');
  });
});
