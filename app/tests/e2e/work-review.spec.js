// Review, merge and "My Proposals" against a stand-in API.
import { expect, test } from './fixtures.js';
import { conflictingProposal, gate, ID, me, mockApi, personHit, submitted } from './work-api.js';

test('the Editor\'s conflict choices survive opening the corrections, and corrections closed again are not sent', async ({ page }) => {
  const accept = `POST proposals/${ID(400)}/accept`;
  const calls = await mockApi(page, {
    'GET me': { json: me('editor') },
    'GET review?limit=50': { json: { items: [conflictingProposal()], total: 1 } },
    [accept]: { json: submitted(ID(400)) },
  });
  await page.goto('./#work/review');
  const card = page.getByTestId('proposal');
  await card.getByTestId('choose-current-date').check();
  await card.getByTestId('correct').click();
  await expect(card.getByTestId('choose-current-date')).toBeChecked();
  await card.getByTestId('correct-1-transcription').fill('obiit 4. Novembris');
  await card.getByTestId('correct').click();
  await card.getByTestId('accept').click();
  await expect.poll(() => calls.filter((c) => c.key === accept).length).toBe(1);
  expect(calls.find((c) => c.key === accept)?.body).toEqual({ note: null, corrections: [], resolutions: [{ position: 0, fields: { date: 'current' } }] });
});

test('Merge cannot be tapped again while a merge runs', async ({ page }) => {
  const slow = gate();
  const merge = `POST persons/${ID(1)}/merge`;
  const calls = await mockApi(page, {
    'GET me': { json: me('editor') },
    'GET review?limit=50': { json: { items: [], total: 0 } },
    'GET persons': { json: { items: [personHit(1, 'Anna', 'Nováková'), personHit(2, 'Anna', 'Novakova')], limit: 8, offset: 0 } },
    [merge]: async () => {
      await slow.opened;
      return { json: submitted(ID(501)) };
    },
  });
  await page.goto('./#work/review');
  await page.locator('.merge-tool summary').click();
  await page.getByTestId('merge-keep-search').fill('Anna');
  await page.getByTestId('merge-keep-results').getByRole('button', { name: 'Anna Nováková' }).click();
  await page.getByTestId('merge-gone-search').fill('Anna');
  await page.getByTestId('merge-gone-results').getByRole('button', { name: 'Anna Novakova' }).click();
  await page.getByTestId('merge').click();
  await expect(page.getByTestId('merge')).toBeDisabled();
  slow.open();
  await expect(page.getByTestId('queue-count')).toHaveText('0 waiting, oldest first.');
  expect(calls.filter((c) => c.key === merge)).toHaveLength(1);
});

test('when the email setting cannot be saved, the switch turns back and says why', async ({ page }) => {
  await mockApi(page, {
    'GET me': { json: me('contributor') },
    'GET proposals?mine=true&limit=100': { json: { items: [submitted(ID(500))] } },
    'GET me/notifications': { json: { outcomeEmails: true } },
    'PUT me/notifications': { status: 503, json: { code: 'unavailable', message: 'Try again in a minute.' } },
  });
  await page.goto(`./#work/mine/${ID(500)}`);
  const toggle = page.getByTestId('outcome-emails');
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(page.getByTestId('outcome-status')).toHaveText('Try again in a minute.');
  await expect(toggle).toBeChecked();
});
