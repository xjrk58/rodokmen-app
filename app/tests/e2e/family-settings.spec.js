// add-family-view task 2.4 (family-view spec, "Owner settings in the app") and default-to-czech
// task 1.3: every Member's own settings, and the Owner's Member management, against the mocked API.
import { member, mockFamilyApi } from './family-api.js';
import { ID, P, summary } from './family-data.js';
import { expect, test } from './fixtures.js';

/** @typedef {import('../../src/types.js').MemberView} MemberView */
/** @typedef {import('../../src/types.js').InvitationView} InvitationView */

const SESSIONS = {
  items: [
    {
      id: ID(801),
      createdAt: '2026-10-01T10:00:00.000Z',
      lastSeenAt: '2026-10-30T10:00:00.000Z',
      expiresAt: '2027-01-28T10:00:00.000Z',
      userAgent: 'This phone',
      method: 'passkey',
      current: true,
    },
    {
      id: ID(802),
      createdAt: '2026-09-01T10:00:00.000Z',
      lastSeenAt: '2026-10-20T10:00:00.000Z',
      expiresAt: '2027-01-18T10:00:00.000Z',
      userAgent: 'Old tablet',
      method: 'email_link',
      current: false,
    },
  ],
};
const PASSKEYS = { items: [{ id: ID(811), name: 'Android', createdAt: '2026-10-01T10:00:00.000Z', lastUsedAt: '2026-10-30T10:00:00.000Z', backedUp: true }] };

/**
 * @param {number} n
 * @param {string} name
 * @param {'contributor' | 'editor' | 'owner'} role
 * @returns {MemberView}
 */
const memberView = (n, name, role) => ({
  id: ID(n),
  version: 1,
  email: `${name.toLowerCase()}@example.test`,
  displayName: `${name} Invented`,
  language: 'cs',
  role,
  disabled: false,
  createdAt: '2026-10-01T10:00:00.000Z',
  lastSeenAt: null,
  person: null,
});

test("Contributor's settings: their own language, sessions and passkeys, and nothing about other Members", async ({ page }) => {
  const calls = await mockFamilyApi(page, {
    me: member('contributor'),
    extra: { 'GET me/sessions': () => ({ json: SESSIONS }), 'GET me/passkeys': () => ({ json: PASSKEYS }) },
  });
  await page.goto('./#settings');
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await expect(page.getByTestId('settings-language')).toBeVisible();
  await expect(page.getByTestId('session')).toHaveCount(2);
  await expect(page.getByTestId('session').first()).toContainText('This device');
  await expect(page.getByTestId('passkey')).toHaveCount(1);
  await expect(page.getByTestId('settings-family')).toHaveCount(0);
  await expect(page.getByTestId('settings-agents')).toHaveCount(0);
  await expect(page.getByText('Members', { exact: true })).toHaveCount(0);
  expect(calls.some((c) => c.startsWith('GET members') || c.startsWith('GET invitations') || c.startsWith('GET agents'))).toBe(false);
});

test('a Member ends a session on another device', async ({ page }) => {
  const calls = await mockFamilyApi(page, {
    me: member('contributor'),
    extra: { 'GET me/sessions': () => ({ json: SESSIONS }), [`DELETE me/sessions/${ID(802)}`]: () => ({ status: 204 }) },
  });
  await page.goto('./#settings');
  await page.getByTestId('session').filter({ hasText: 'Old tablet' }).getByRole('button').click();
  await expect.poll(() => calls.includes(`DELETE me/sessions/${ID(802)}`)).toBe(true);
});

test("the language chosen in Settings applies on this device and to the Member's account", async ({ page }) => {
  /** @type {unknown[]} */
  const bodies = [];
  await mockFamilyApi(page, {
    me: member('contributor'),
    extra: { 'PATCH me': (_m, _u, body) => (bodies.push(body), { json: { ...member('contributor'), language: 'cs' } }) },
  });
  await page.goto('./#settings');
  await page.getByTestId('settings-language').getByText('Čeština').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'cs');
  await expect(page.getByTestId('tabbar-people')).toContainText('Lidé');
  expect(bodies).toEqual([{ language: 'cs' }]);
  expect(await page.evaluate(() => localStorage.getItem('rodokmen.language'))).toBe('cs');
});

test.describe("Member's setting", () => {
  test.use({ language: null, locale: 'cs-CZ' });
  test('a signed-in Member whose account language is English gets English on a new device', async ({ page }) => {
    await mockFamilyApi(page, { me: member('contributor', { person: 10, language: 'en' }) });
    await page.goto('./');
    await expect(page.getByTestId('tree')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('tabbar-people')).toContainText('People');
    // Nothing was stored on the device: the account decides.
    expect(await page.evaluate(() => localStorage.getItem('rodokmen.language'))).toBeNull();
  });

  test('a choice made on the device wins over the account language', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('rodokmen.language', 'cs'));
    await mockFamilyApi(page, { me: member('contributor', { person: 10, language: 'en' }) });
    await page.goto('./');
    await expect(page.getByTestId('tree')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'cs');
  });
});

test('inviting a cousin: the Owner enters an email and language, and sees the invitation pending until it is accepted', async ({ page }) => {
  /** @type {InvitationView[]} */
  const invitations = [];
  /** @type {unknown[]} */
  const sent = [];
  await mockFamilyApi(page, {
    me: member('owner'),
    extra: {
      'GET members': () => ({ json: { items: [{ ...memberView(900, 'Eliska', 'owner') }] } }),
      'GET invitations': () => ({ json: { items: invitations } }),
      'GET agents': () => ({ json: { items: [] } }),
      'POST invitations': (_m, _u, body) => {
        sent.push(body);
        const b = /** @type {{ email: string, language: 'cs' | 'en' }} */ (body);
        const view = {
          id: ID(850),
          email: b.email,
          language: b.language,
          status: /** @type {const} */ ('pending'),
          createdAt: '2026-10-30T10:00:00.000Z',
          expiresAt: '2026-11-06T10:00:00.000Z',
          acceptedAt: null,
        };
        invitations.unshift(view);
        return { status: 201, json: view };
      },
    },
  });
  await page.goto('./#settings');
  await page.getByTestId('invite-email').fill('cousin@example.test');
  await page.getByTestId('invite-language').selectOption('en');
  await page.getByTestId('send-invitation').click();
  await expect(page.getByTestId('invite-status')).toHaveText('The invitation is on its way. It is valid for 7 days.');
  expect(sent).toEqual([{ email: 'cousin@example.test', language: 'en' }]);
  const row = page.locator('[data-testid="invitation"][data-email="cousin@example.test"]');
  await expect(row.getByTestId('invitation-status')).toHaveText('pending');
});

test('the Owner changes a role, disables and enables a Member, and links a Member to their Person', async ({ page }) => {
  const karel = memberView(901, 'Karel', 'contributor');
  /** @type {string[]} */
  const actions = [];
  await mockFamilyApi(page, {
    me: member('owner'),
    extra: {
      'GET members': () => ({ json: { items: [memberView(900, 'Eliska', 'owner'), karel] } }),
      'GET invitations': () => ({ json: { items: [] } }),
      'GET agents': () => ({ json: { items: [] } }),
      [`PUT members/${ID(901)}/role`]: (_m, _u, body) => {
        karel.role = /** @type {{ role: 'editor' }} */ (body).role;
        actions.push(`role ${karel.role}`);
        return { json: karel };
      },
      [`POST members/${ID(901)}/(disable|enable)`]: (m) => {
        karel.disabled = m[1] === 'disable';
        actions.push(m[1]);
        return { json: karel };
      },
      [`PUT members/${ID(901)}/person`]: (_m, _u, body) => {
        const id = /** @type {{ personId: string | null }} */ (body).personId;
        karel.person = id ? summary(Number(id.slice(-12))) : null;
        actions.push(`person ${id}`);
        return { json: karel };
      },
    },
  });
  await page.goto('./#settings');
  const row = page.locator('[data-testid="member"][data-email="karel@example.test"]');
  await row.getByTestId('member-role').selectOption('editor');
  await expect.poll(() => actions).toContain('role editor');
  await row.getByTestId('member-disable').click();
  await expect(row).toContainText('disabled');
  await row.getByTestId('member-disable').click();
  await expect(row).not.toContainText('disabled');
  await expect(row.getByTestId('member-person')).toContainText('not linked');
  await row.getByTestId('member-link').click();
  await row.getByTestId('link-person-search').fill('karel nov');
  await row
    .getByTestId('link-person-results')
    .getByRole('button', { name: /Karel Novák/ })
    .click();
  await expect(row.getByTestId('member-person')).toContainText('Karel Novák');
  expect(actions).toEqual(['role editor', 'disable', 'enable', `person ${P.karel}`]);
  // The Owner's own row cannot be demoted or disabled here.
  const own = page.locator('[data-testid="member"][data-email="eliska@example.test"]');
  await expect(own.getByTestId('member-role')).toBeDisabled();
  await expect(own.getByTestId('member-disable')).toHaveCount(0);
});

test('signing out empties what this device kept and returns to the map', async ({ page }) => {
  let signedIn = true;
  await mockFamilyApi(page, {
    me: null,
    extra: {
      'GET me': () => (signedIn ? { json: member('contributor', { person: 10 }) } : { status: 401, json: { code: 'unauthorized' } }),
      'POST auth/sign-out': () => ((signedIn = false), { status: 204 }),
    },
  });
  await page.goto(`./#people/${P.jan}`);
  await expect(page.getByTestId('person-title')).toHaveText('Jan Novák');
  const kept = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open('rodokmen-cache');
          open.onsuccess = () => {
            const req = open.result.transaction('records').objectStore('records').count();
            req.onsuccess = () => {
              resolve(req.result);
              open.result.close();
            };
          };
        }),
    );
  await expect.poll(kept).toBeGreaterThan(0);
  await page.getByTestId('tabbar-settings').click();
  await page.getByTestId('sign-out').click();
  await expect(page.getByTestId('tabbar')).toHaveCount(0);
  await expect(page.locator('#search-input')).toBeVisible();
  await expect.poll(kept).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('rodokmen.focus'))).toBeNull();
});
