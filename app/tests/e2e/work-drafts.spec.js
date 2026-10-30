// Drafts against a stand-in API: submitting from the list, failing device
// storage, and a submit whose answer was lost.
import { expect, test, TILE } from './fixtures.js';
import { ID, me, mockApi, SIGNED_OUT, submitted } from './work-api.js';

/**
 * Starts a death or burial Draft with a new Person.
 * @param {import('@playwright/test').Page} page
 */
async function startDeath(page) {
  await page.goto('./#work/propose/death');
  await page.getByTestId('person-new').click();
  await page.getByTestId('person-given').fill('Apolena');
  await page.getByTestId('person-surname').fill('Invented');
}

test('a Draft submitted from the list is checked before its photos are uploaded', async ({ page }) => {
  const calls = await mockApi(page, { 'GET me': { json: me('contributor') } });
  await startDeath(page);
  await page.getByTestId('photo-input').setInputFiles({ name: 'page.png', mimeType: 'image/png', buffer: TILE });
  await expect(page.getByTestId('photos').locator('img')).toHaveCount(1);
  await page.getByTestId('tab-drafts').click();
  await page.getByTestId('submit-draft').click();
  await expect(page.getByTestId('draft').locator('.form-status')).toHaveText('Evidence is missing: add the register entry, a document or a Family account, with a transcription.');
  expect(calls.map((c) => c.key).filter((key) => key.startsWith('POST'))).toEqual([]);
});

test('a photo\'s thumbnail lets go of the photo\'s memory once shown', async ({ page }) => {
  await page.addInitScript(() => {
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      const count = document.documentElement.dataset;
      count.revoked = String(Number(count.revoked ?? '0') + 1);
      revoke(url);
    };
  });
  await mockApi(page, { 'GET me': SIGNED_OUT });
  await startDeath(page);
  await page.getByTestId('photo-input').setInputFiles({ name: 'page.png', mimeType: 'image/png', buffer: TILE });
  await expect(page.getByTestId('photos').locator('img')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-revoked', '1');
});

test('when the device storage fails, the Member is told', async ({ page }) => {
  await mockApi(page, { 'GET me': SIGNED_OUT });
  page.on('dialog', (dialog) => void dialog.accept());
  await startDeath(page);
  await page.getByTestId('save-draft').click();
  await expect(page.getByTestId('form-status')).toHaveText('The Draft is saved on this device.');
  await page.getByTestId('tab-drafts').click();
  await expect(page.getByTestId('draft')).toHaveCount(1);
  await page.evaluate(() => {
    const full = () => {
      throw new DOMException('The disk is full', 'QuotaExceededError');
    };
    IDBObjectStore.prototype.put = full;
    IDBObjectStore.prototype.delete = full;
  });
  await page.getByTestId('delete-draft').click();
  await expect(page.getByTestId('draft').locator('.form-status')).toHaveText('The disk is full');
  await page.getByTestId('draft-title').click();
  await page.getByTestId('save-draft').click();
  await expect(page.getByTestId('form-status')).toHaveText('The disk is full');
});

test('after an interrupted submit the Draft can only be sent again unchanged, and the Member is told why', async ({ page }) => {
  let posts = 0;
  const calls = await mockApi(page, {
    'GET me': { json: me('contributor') },
    'POST proposals': () => (++posts === 1 ? { abort: true } : { status: 201, json: submitted(ID(500)) }),
    'GET proposals?mine=true&limit=100': { json: { items: [submitted(ID(500))] } },
    'GET me/notifications': { json: { outcomeEmails: true } },
  });
  await startDeath(page);
  await page.getByTestId('source-title').fill('Invented burial register 1860–1880');
  await page.getByTestId('transcription').fill('Apollonia, vidua, sepulta');
  await page.getByTestId('submit').click();
  await expect(page.getByTestId('form-status')).toContainText('The submit was interrupted');
  await expect(page.getByTestId('pending-notice')).toBeVisible();
  await expect(page.getByTestId('note')).toBeDisabled();
  await expect(page.getByTestId('person-given')).toBeDisabled();

  // Opened again from the list, it is still locked.
  await page.getByTestId('tab-drafts').click();
  await page.getByTestId('draft-title').click();
  await expect(page.getByTestId('pending-notice')).toBeVisible();
  await expect(page.getByTestId('transcription')).toBeDisabled();
  await page.getByTestId('submit').click();
  await page.waitForURL(/#work\/mine\//);
  const bodies = calls.filter((c) => c.key === 'POST proposals').map((c) => c.body);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
});

test('Drafts work again after the device storage failed to open once', async ({ page }) => {
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open.bind(indexedDB);
    let failures = 1;
    /** @param {string} name @param {number} [version] */
    IDBFactory.prototype.open = (name, version) => {
      if (failures-- > 0) throw new DOMException('Storage is starting', 'UnknownError');
      return open(name, version);
    };
  });
  await mockApi(page, { 'GET me': SIGNED_OUT });
  await page.goto('./#work/drafts');
  await page.getByTestId('tab-propose').click();
  await page.getByTestId('tab-drafts').click();
  await expect(page.getByText('No Drafts.')).toBeVisible();
});
