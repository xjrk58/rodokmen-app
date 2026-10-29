// Task 6.4: when a new version is deployed while the app is open, it shows
// "New version, reload" and keeps the page until the reader taps it.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { municipality } from './data.js';
import { expect, test } from './fixtures.js';
import { cacheSizes, copyApp, serve, waitForServiceWorker } from './sw-helpers.js';

test.use({ serviceWorkers: 'allow', locale: 'en-US' });

/**
 * Simulates a deploy: a changed file and a new version stamp.
 * @param {string} dir
 * @param {string} version
 */
async function deploy(dir, version) {
  for (const [file, pattern, replacement] of [
    ['sw.js', /const VERSION = '[^']*';/, `const VERSION = '${version}';`],
    ['src/version.js', /export const APP_VERSION = '[^']*';/, `export const APP_VERSION = '${version}';`],
  ]) {
    const path = join(dir, /** @type {string} */ (file));
    await writeFile(path, (await readFile(path, 'utf8')).replace(/** @type {RegExp} */ (pattern), /** @type {string} */ (replacement)));
  }
}

test('a new deploy shows "New version, reload" and updates only when tapped', async ({ page }) => {
  const app = await copyApp();
  const server = await serve(app.dir);
  try {
    await deploy(app.dir, 'test-1');
    await page.goto(server.url);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await waitForServiceWorker(page);
    await expect(page.locator('#update-toast')).toBeHidden();

    for (const version of ['test-2', 'test-3']) {
      // The reader is looking at a place when the new version arrives.
      const m = municipality('Pardubice');
      await page.locator('#search-input').fill(m.name);
      await page.locator('#search-results li').first().click();
      await expect(page.locator('#place-sheet')).toBeVisible();
      await page.evaluate(() => {
        /** @type {any} */ (window).notReloaded = true;
      });

      await deploy(app.dir, version);
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.getRegistration())?.update();
      });
      const prompt = page.getByRole('button', { name: 'New version, reload' });
      await expect(prompt).toBeVisible();

      // Nothing changes until the reader agrees.
      await page.waitForTimeout(1000);
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
