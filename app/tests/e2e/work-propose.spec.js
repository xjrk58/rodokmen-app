// The Propose forms against a stand-in API: slow and stale answers, and
// typing that must survive leaving the form.
import { expect, test } from './fixtures.js';
import { gate, ID, me, mockApi, personDetail, personHit, places, settled, SIGNED_OUT, sources } from './work-api.js';

test('a slow screen does not replace the one the Member moved on to', async ({ page }) => {
  const slow = gate();
  await mockApi(page, {
    'GET me': { json: me('editor') },
    'GET review?limit=50': async () => {
      await slow.opened;
      return { json: { items: [], total: 0 } };
    },
    'GET places': { json: places('Kamenná Lhota') },
  });
  const reviewDone = settled(page, '/api/review');
  await page.goto('./#work/review');
  await expect(page.getByText('Loading…')).toBeVisible();
  await page.getByTestId('tab-propose').click();
  await page.getByTestId('kind-death').click();
  await page.getByTestId('date').fill('1866-03');
  slow.open();
  await reviewDone;
  // A later round trip; by its end the review answer has long been handled.
  await page.getByTestId('place-search').fill('Kamenná');
  await expect(page.getByTestId('place-results').getByRole('button')).toHaveCount(1);
  await expect(page.getByTestId('date')).toHaveValue('1866-03');
  await expect(page.getByTestId('queue-count')).toBeHidden();
});

test('what the Member types is kept as a Draft without "Save draft": across tabs, a language change and closing the app', async ({ page }) => {
  await mockApi(page, { 'GET me': SIGNED_OUT });
  await page.goto('./#work/propose/death');
  await page.getByTestId('person-new').click();
  await page.getByTestId('person-given').fill('Apolena');
  await page.getByTestId('transcription').fill('Apollonia, vidua');
  await page.getByTestId('tab-drafts').click();
  await expect(page.getByTestId('draft-title')).toHaveText(['Death or burial: Apolena']);

  await page.getByTestId('draft-title').click();
  await expect(page.getByTestId('transcription')).toHaveValue('Apollonia, vidua');
  await page.getByTestId('note').fill('Found in the 1866 volume');
  await page.evaluate(async (path) => {
    /** @type {unknown} */
    const loaded = await import(path);
    const i18n = /** @type {typeof import('../../src/i18n.js')} */ (loaded);
    await i18n.setLanguage('cs');
  }, './src/i18n.js');
  await expect(page.getByTestId('tab-drafts')).toHaveText('Koncepty');
  await expect(page.getByTestId('note')).toHaveValue('Found in the 1866 volume');

  await page.getByTestId('date').fill('1866-03');
  await page.reload();
  await expect(page.getByTestId('date')).toHaveValue('1866-03');
  await expect(page.getByTestId('person-given')).toHaveValue('Apolena');
});

test('an untouched form is not kept as a Draft', async ({ page }) => {
  await mockApi(page, { 'GET me': SIGNED_OUT });
  await page.goto('./#work/propose/marriage');
  await page.getByTestId('tab-drafts').click();
  await expect(page.getByText('No Drafts.')).toBeVisible();
});

test("switching the Person to correct while the first one loads shows the second one's records", async ({ page }) => {
  const slow = gate();
  await mockApi(page, {
    'GET me': { json: me('contributor') },
    'GET persons': { json: { items: [personHit(1, 'Anna', 'Králová'), personHit(2, 'Barbora', 'Králová')], limit: 8, offset: 0 } },
    [`GET persons/${ID(1)}`]: async () => {
      await slow.opened;
      return { json: personDetail(1, 'Anna', 'Králová') };
    },
    [`GET persons/${ID(2)}`]: { json: personDetail(2, 'Barbora', 'Králová') },
    'GET sources': { json: sources('Invented register N 1830–1850', 'parish_register') },
  });
  const annaDone = settled(page, `/api/persons/${ID(1)}`);
  await page.goto('./#work/propose/correction');
  await page.getByTestId('person-search').fill('Králová');
  await page.getByTestId('person-results').getByRole('button', { name: 'Anna Králová' }).click();
  await page.getByTestId('person').getByRole('button', { name: 'Change' }).click();
  await page.getByTestId('person-search').fill('Králová');
  await page.getByTestId('person-results').getByRole('button', { name: 'Barbora Králová' }).click();
  const targets = page.getByTestId('targets');
  await expect(targets).toContainText('Barbora Králová');
  slow.open();
  await annaDone;
  // A later round trip, as above.
  await page.getByTestId('source-mode-existing').check();
  await page.getByTestId('source-search').fill('Invented');
  await expect(page.getByTestId('source-results').getByRole('button')).toHaveCount(1);
  await expect(targets).toContainText('Barbora Králová');
  await expect(targets).not.toContainText('Anna');
});

test('a Person that cannot be loaded says why, not that the connection is missing', async ({ page }) => {
  await mockApi(page, {
    'GET me': { json: me('contributor') },
    'GET persons': { json: { items: [personHit(3, 'Cyril', 'Novák')], limit: 8, offset: 0 } },
    [`GET persons/${ID(3)}`]: { status: 404, json: { code: 'not_found', message: 'No such Person.' } },
  });
  await page.goto('./#work/propose/correction');
  await page.getByTestId('person-search').fill('Novák');
  await page.getByTestId('person-results').getByRole('button', { name: 'Cyril Novák' }).click();
  await expect(page.getByTestId('targets')).toHaveText('No such Person.');
});

test('clearing a search while it runs leaves its results empty', async ({ page }) => {
  const slow = gate();
  await mockApi(page, {
    'GET me': { json: me('contributor') },
    'GET places': async () => {
      await slow.opened;
      return { json: places('Kamenná Lhota') };
    },
    'GET persons': { json: { items: [personHit(1, 'Josef', 'Dvořák')], limit: 8, offset: 0 } },
  });
  await page.goto('./#work/propose/baptism');
  const asked = page.waitForRequest((r) => r.url().includes('/api/places?'));
  await page.getByTestId('place-search').fill('Kamenná');
  await asked;
  await page.getByTestId('place-search').fill('');
  const placesDone = settled(page, '/api/places?');
  slow.open();
  await placesDone;
  await page.getByTestId('father-search').fill('Dvořák');
  await expect(page.getByTestId('father-results').getByRole('button')).toHaveCount(1);
  await expect(page.getByTestId('place-results').getByRole('button')).toHaveCount(0);
});

test('Drafts and #work links work when the map data cannot be loaded', async ({ page }) => {
  await page.route('**/data/municipalities.json', (route) => route.fulfill({ status: 500, body: 'down' }));
  await mockApi(page, { 'GET me': SIGNED_OUT });
  await page.goto('./');
  await expect(page.locator('#message')).toHaveText(/map data could not be loaded/);
  await page.locator('#work-button').click();
  await expect(page.locator('#work')).toBeVisible();
  await expect(page.getByTestId('kind-baptism')).toBeVisible();
});
