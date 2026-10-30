// Task 5.4 and the overlay controls of 5.2: "Check map layers" reports each
// overlay as working or not; overlays switch on with an opacity control.
import { layers } from './data.js';
import { TILE, expect, openApp, test } from './fixtures.js';

test.use({ locale: 'en-US' });

/** @param {string} id */
function overlay(id) {
  const found = layers.overlays.find((o) => o.id === id);
  if (!found) throw new Error(`layers.json has no overlay ${id}`);
  return found;
}
const survey2 = overlay('survey2');
const survey3 = overlay('survey3');

test('"Check map layers" reports a blocked overlay as not working', async ({ page }) => {
  await openApp(page);
  // Routes added later take precedence over the fixture's catch-all mock.
  await page.route((url) => url.href.startsWith(survey2.url), (route) => route.abort('blockedbyclient'));
  await page.route((url) => url.href.startsWith(survey3.url), (route) => route.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  await page.locator('#settings-button').click();
  await page.getByRole('button', { name: 'Check map layers' }).click();
  await expect(page.locator(`#check-results [data-overlay="${survey2.id}"]`)).toContainText('not working');
  await expect(page.locator(`#check-results [data-overlay="${survey2.id}"]`)).toHaveAttribute('data-working', 'false');
  await expect(page.locator(`#check-results [data-overlay="${survey3.id}"]`)).toHaveAttribute('data-working', 'true');
  await expect(page.locator(`#check-results [data-overlay="${survey3.id}"] .status`)).toHaveText('working');
});

test('a service answering with an error page counts as not working', async ({ page }) => {
  await openApp(page);
  await page.route((url) => url.href.startsWith(survey2.url) || url.href.startsWith(survey3.url), (route) =>
    route.fulfill({ status: 200, contentType: 'text/xml', body: '<ServiceExceptionReport><ServiceException>CRS not supported</ServiceException></ServiceExceptionReport>' }));
  await page.locator('#settings-button').click();
  await page.getByRole('button', { name: 'Check map layers' }).click();
  await expect(page.locator('#check-results [data-working="false"]')).toHaveCount(2);
});

test('the check asks for a Web Mercator image', async ({ page, external }) => {
  await openApp(page);
  await page.locator('#settings-button').click();
  await page.getByRole('button', { name: 'Check map layers' }).click();
  await expect(page.locator('#check-results [data-working="true"]')).toHaveCount(2);
  const request = external.find((u) => u.startsWith(survey2.url));
  expect(request).toBeDefined();
  const params = new URL(/** @type {string} */ (request)).searchParams;
  expect(params.get('crs')).toBe('EPSG:3857');
  expect(params.get('request')).toBe('GetMap');
  expect(params.get('layers')).toBe('0');
});

test('an overlay switches on and its opacity follows the slider', async ({ page, external }) => {
  await openApp(page, { zoom: 12, lat: 49.91, lon: 15.39 });
  await page.locator('#layers-button').click();
  await page.locator(`input[data-overlay="${survey2.id}"]`).check();
  const layer = page.locator(`.overlay-${survey2.id}`);
  await expect(layer).toHaveCount(1);
  await expect.poll(() => external.filter((u) => u.startsWith(survey2.url)).length).toBeGreaterThan(0);
  const tileRequest = /** @type {string} */ (external.find((u) => u.startsWith(survey2.url)));
  expect(new URL(tileRequest).searchParams.get('crs')).toBe('EPSG:3857');
  await expect(layer).toHaveCSS('opacity', String(survey2.opacity));
  await page.locator(`input[data-opacity="${survey2.id}"]`).fill('30');
  await expect(layer).toHaveCSS('opacity', '0.3');
  await page.locator(`input[data-overlay="${survey2.id}"]`).uncheck();
  await expect(layer).toHaveCount(0);
});
