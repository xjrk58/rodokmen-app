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

test.describe('Two quick language changes', () => {
  test.use({ locale: 'en-US' });
  test('end in the language chosen last, even when the first one loads slower', async ({ page }) => {
    await openApp(page);
    /** @type {() => void} */
    let englishServed = () => {};
    const served = new Promise((resolve) => (englishServed = () => resolve(undefined)));
    await page.route('**/i18n/cs.json', async (route) => {
      await served;
      await route.continue();
    });
    await page.route('**/i18n/en.json', async (route) => {
      await route.continue();
      englishServed();
    });
    const lang = await page.evaluate(async (path) => {
      /** @type {unknown} */
      const loaded = await import(path);
      const i18n = /** @type {typeof import('../../src/i18n.js')} */ (loaded);
      const czech = i18n.setLanguage('cs', { remember: true });
      await i18n.setLanguage('en', { remember: true });
      await czech;
      return { html: document.documentElement.lang, current: i18n.language(), stored: localStorage.getItem('rodokmen.language') };
    }, './src/i18n.js');
    expect(lang).toEqual({ html: 'en', current: 'en', stored: 'en' });
    await expect(page.locator('#search-input')).toHaveAttribute('placeholder', 'Find a municipality');
  });
});

test('when the interface strings cannot be loaded, the page says so in Czech and English', async ({ page }) => {
  await page.route('**/i18n/*.json', (route) => route.fulfill({ status: 503, body: 'down' }));
  await page.goto('./');
  await expect(page.locator('#message')).toBeVisible();
  await expect(page.locator('#message')).toContainText('Aplikaci se nepodařilo načíst');
  await expect(page.locator('#message')).toContainText('The app could not be loaded');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'error');
});
