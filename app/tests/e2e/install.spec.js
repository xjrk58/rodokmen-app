// Task 6.1: the manifest and icons make the app installable in Chrome.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_DIR } from './data.js';
import { expect, openApp, test } from './fixtures.js';

test.use({ serviceWorkers: 'allow' });

/** @param {Buffer} png */
const pngSize = (png) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

test('the manifest lists 192, 512 and maskable 512 icons that exist', () => {
  const manifest = JSON.parse(readFileSync(join(APP_DIR, 'manifest.webmanifest'), 'utf8'));
  expect(manifest.display).toBe('standalone');
  expect(manifest.name).toBe('Rodokmen');
  /** @type {{ src: string, sizes: string, type: string, purpose: string }[]} */
  const icons = manifest.icons;
  const want = [
    ['192x192', 'any'],
    ['512x512', 'any'],
    ['512x512', 'maskable'],
  ];
  for (const [sizes, purpose] of want) {
    const icon = icons.find((i) => i.sizes === sizes && i.purpose === purpose && i.type === 'image/png');
    expect(icon, `${sizes} ${purpose}`).toBeDefined();
    const [w, h] = sizes.split('x').map(Number);
    expect(pngSize(readFileSync(join(APP_DIR, /** @type {{src: string}} */ (icon).src)))).toEqual({ width: w, height: h });
  }
});

test("Chrome's installability check passes", async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'uses the Chrome DevTools Protocol');
  await openApp(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cdp = await page.context().newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  expect(manifest.errors).toEqual([]);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
});
