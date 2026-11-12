// Task 6.4: when a new version is deployed while the app is open, it shows
// "New version, reload" and keeps the page until the reader taps it.
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stampSite } from '../../scripts/stamp-version.mjs';
import { municipality } from './data.js';
import { expect, test } from './fixtures.js';
import { cacheSizes, copyApp, serve, waitForServiceWorker } from './sw-helpers.js';

test.use({ serviceWorkers: 'allow', locale: 'en-US' });

/**
 * Simulates a deploy as the build makes one (#91): a changed precached file,
 * and the site stamped again with the version of its files.
 * @param {string} dir a copy of the site (copyApp)
 * @returns {Promise<string>} the new version
 */
async function deploy(dir) {
  await appendFile(join(dir, 'styles.css'), '\n/* a new deploy */\n');
  return stampSite(dir);
}

test('a new deploy shows "New version, reload" and updates only when tapped', async ({ page }) => {
  const app = await copyApp();
  const server = await serve(app.dir);
  try {
    await page.goto(server.url);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await waitForServiceWorker(page);
    await expect(page.locator('#update-toast')).toBeHidden();
    await page.locator('#settings-button').click();
    await expect(page.locator('#app-version')).toHaveText(`Version ${app.version}`);
    await page.keyboard.press('Escape');

    for (let i = 0; i < 2; i++) {
      // The reader is looking at a place when the new version arrives.
      const m = municipality('Pardubice');
      await page.locator('#search-input').fill(m.name);
      await page.locator('#search-results li').first().click();
      await expect(page.locator('#place-sheet')).toBeVisible();
      await page.evaluate(() => {
        /** @type {any} */ (window).notReloaded = true;
      });

      const version = await deploy(app.dir);
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.getRegistration())?.update();
      });
      const prompt = page.getByRole('button', { name: 'New version, reload' });
      await expect(prompt).toBeVisible();

      // Nothing changes until the reader agrees: the new worker waits, the page keeps its state.
      await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state ?? 'none')).toBe('installed');
      expect(await page.evaluate(() => /** @type {any} */ (window).notReloaded)).toBe(true);
      await expect(page.locator('#place-sheet')).toBeVisible();

      const reloaded = page.waitForEvent('load');
      await prompt.click();
      await reloaded;
      await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
      expect(await page.evaluate(() => /** @type {any} */ (window).notReloaded)).toBeUndefined();
      await expect(page.locator('#update-toast')).toBeHidden();
      const shells = Object.keys(await cacheSizes(page)).filter((k) => k.startsWith('rodokmen-shell-'));
      expect(shells).toEqual([`rodokmen-shell-${version}`]);
      await page.locator('#settings-button').click();
      await expect(page.locator('#app-version')).toHaveText(`Version ${version}`);
      await page.keyboard.press('Escape');
    }
  } finally {
    await server.close();
    await app.remove();
  }
});

test('with two tabs open, "New version, reload" works in the second tab too', async ({ page, context }) => {
  const app = await copyApp();
  const server = await serve(app.dir);
  try {
    await page.goto(server.url);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await waitForServiceWorker(page);
    const second = await context.newPage();
    await second.goto(server.url);
    await expect(second.locator('body')).toHaveAttribute('data-ready', 'true');

    const version = await deploy(app.dir);
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });
    const prompt = (/** @type {import('@playwright/test').Page} */ p) => p.getByRole('button', { name: 'New version, reload' });
    await expect(prompt(page)).toBeVisible();
    await expect(prompt(second)).toBeVisible();

    // The first tab activates the new version; the second keeps its prompt until tapped.
    const firstReloaded = page.waitForEvent('load');
    await prompt(page).click();
    await firstReloaded;
    await expect(prompt(second)).toBeVisible();

    const secondReloaded = second.waitForEvent('load', { timeout: 10_000 });
    await prompt(second).click();
    await secondReloaded;
    await expect(second.locator('body')).toHaveAttribute('data-ready', 'true');
    await expect(second.locator('#update-toast')).toBeHidden();
    await second.locator('#settings-button').click();
    await expect(second.locator('#app-version')).toHaveText(`Version ${version}`);
  } finally {
    await server.close();
    await app.remove();
  }
});
