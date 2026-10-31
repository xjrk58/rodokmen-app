// add-family-view task 1.2 (family-view spec, "Sign-in in the app"), against the mocked API at
// both viewports. Registering and using a real passkey with a virtual authenticator is in
// server/test/passkeys.e2e.test.ts, against the real server.
import { member, mockFamilyApi } from './family-api.js';
import { P } from './family-data.js';
import { expect, openApp, test } from './fixtures.js';

const TOKEN = 'invented-token-0123456789abcdef';

test('not signed in: the map, search and place sheets, and nothing about any Person', async ({ page }) => {
  const calls = await mockFamilyApi(page, { me: null });
  await openApp(page);
  await page.locator('#search-input').fill('Pardubice');
  await page.locator('#search-results li').first().click();
  await expect(page.locator('[data-testid="open-scans"]')).toBeVisible();
  await expect(page.getByTestId('family-here')).toHaveCount(0);
  for (const address of [`#person-${P.jan}`, '#people', `#people/${P.jan}`, '#settings', `#life/${P.jan}`]) {
    await page.goto(`./${address}`);
    await expect(page.getByTestId('sign-in-required')).toBeVisible();
    await expect(page.getByTestId('tree')).toHaveCount(0);
    await expect(page.getByTestId('person-screen')).toHaveCount(0);
  }
  expect(calls.filter((c) => !c.startsWith('GET me'))).toEqual([]);
  await page.getByTestId('to-map').click();
  await expect(page.locator('#search-input')).toBeVisible();
});

test('first visit from an invitation: name and language, then a passkey (or not now), then the tree', async ({ page }) => {
  let signedIn = false;
  /** @type {unknown[]} */
  const accepted = [];
  await mockFamilyApi(page, {
    me: null,
    extra: {
      'GET me': () => (signedIn ? { json: member('contributor') } : { status: 401, json: { code: 'unauthorized' } }),
      'POST auth/invitation/check': () => ({
        json: { status: 'pending', language: 'en', message: 'The invitation is valid. Choose your name and language, then save a passkey.' },
      }),
      'POST auth/invitation/accept': (_m, _u, body) => {
        accepted.push(body);
        signedIn = true;
        return { status: 201, json: { ok: true, member: member('contributor') } };
      },
    },
  });
  await page.goto(`./#invite/${TOKEN}`);
  await expect(page.getByTestId('invite-form')).toBeVisible();
  // The token leaves the address at once.
  await expect(page).toHaveURL(/#invite$/);
  await page.getByTestId('invite-name').fill('Marta');
  await page.getByTestId('invite-language').selectOption('en');
  await page.getByTestId('accept-invitation').click();
  await expect(page.getByTestId('passkey-step')).toContainText('Welcome! Now save a passkey.');
  await expect(page.getByTestId('register-passkey')).toBeVisible();
  await page.getByTestId('skip-passkey').click();
  await expect(page.getByTestId('tree-start')).toBeVisible();
  await expect(page.getByTestId('tabbar-tree')).toHaveAttribute('aria-current', 'page');
  expect(accepted).toEqual([{ token: TOKEN, displayName: 'Marta', language: 'en' }]);
});

test('an invitation already used says so, and offers nothing else', async ({ page }) => {
  await mockFamilyApi(page, {
    me: null,
    extra: { 'POST auth/invitation/check': () => ({ json: { status: 'accepted', language: 'en', message: 'This invitation has already been used.' } }) },
  });
  await page.goto(`./#invite/${TOKEN}`);
  await expect(page.getByTestId('sign-in-status')).toHaveText('This invitation has already been used.');
  await expect(page.getByTestId('invite-form')).toHaveCount(0);
});

test('shared link, signed in with an emailed link: the address opened first opens after signing in', async ({ page }) => {
  let signedIn = false;
  await mockFamilyApi(page, {
    me: null,
    extra: {
      'GET me': () => (signedIn ? { json: member('contributor', { person: 23 }) } : { status: 401, json: { code: 'unauthorized' } }),
      'POST auth/email-link': () => ({ status: 202, json: { ok: true, message: 'sent' } }),
      'POST auth/email-link/verify': () => ((signedIn = true), { json: { ok: true, member: member('contributor', { person: 23 }) } }),
    },
  });
  await page.goto(`./#person-${P.karel}`);
  await expect(page.getByTestId('sign-in-required')).toBeVisible();
  await page.getByTestId('sign-in-email').fill('eliska@example.test');
  await page.getByTestId('send-link').click();
  await expect(page.getByTestId('sign-in-status')).toContainText('the link is on its way');
  // The emailed link opens the app again.
  await page.goto(`./#link/${TOKEN}`);
  await expect(page).toHaveURL(/#link$/);
  await page.getByTestId('link-sign-in').click();
  await page.getByTestId('skip-passkey').click();
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.karel);
});

test('an expired emailed link says so', async ({ page }) => {
  await mockFamilyApi(page, {
    me: null,
    extra: {
      'POST auth/email-link/verify': () => ({
        status: 410,
        json: { code: 'link_invalid', message: 'This sign-in link has expired or was already used. Request a new one.' },
      }),
    },
  });
  await page.goto(`./#link/${TOKEN}`);
  await page.getByTestId('link-sign-in').click();
  await expect(page.getByTestId('sign-in-status')).toHaveText('This sign-in link has expired or was already used. Request a new one.');
  await expect(page.getByTestId('sign-in-status')).toHaveClass(/error/);
});

test.describe('a browser without passkeys', () => {
  test('is offered the emailed link only, and skips saving a passkey', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(window, 'PublicKeyCredential', { value: undefined }));
    let signedIn = false;
    await mockFamilyApi(page, {
      me: null,
      extra: {
        'GET me': () => (signedIn ? { json: member('contributor', { person: 10 }) } : { status: 401, json: { code: 'unauthorized' } }),
        'POST auth/email-link/verify': () => ((signedIn = true), { json: { ok: true, member: member('contributor', { person: 10 }) } }),
      },
    });
    await page.goto('./#sign-in');
    await expect(page.getByTestId('send-link')).toBeVisible();
    await expect(page.getByTestId('passkey-sign-in')).toHaveCount(0);
    await page.goto(`./#link/${TOKEN}`);
    await page.getByTestId('link-sign-in').click();
    await expect(page.getByTestId('register-passkey')).toHaveCount(0);
    await page.getByTestId('open-tree').click();
    await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.jan);
  });
});
