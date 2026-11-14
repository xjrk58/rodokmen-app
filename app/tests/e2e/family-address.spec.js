// add-address-correction tasks 4.1 and 4.2 (family-view spec, "Correcting a Member's address in
// Settings" and "The address confirmation page"): the Owner gives a Member a new address in
// Settings, and the relative confirms it from the link, against the mocked API at both viewports.
// The rules behind it (who may, what is refused, what changes) are tested against the real
// server in server/test/email-change.test.ts.
import { member, mockFamilyApi } from './family-api.js';
import { ID } from './family-data.js';
import { expect, test } from './fixtures.js';

/** @typedef {import('../../src/types.js').MemberView} MemberView */

const TOKEN = 'invented-token-0123456789abcdef';

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
  pendingEmail: null,
});

/**
 * Nothing on the screen is wider than the screen.
 * @param {import('@playwright/test').Page} page
 */
const fitsTheScreen = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe("correcting a Member's address in Settings", () => {
  /** @param {import('@playwright/test').Page} page */
  const ownerWithKarel = async (page) => {
    const karel = memberView(901, 'Karel', 'contributor');
    /** @type {unknown[]} */
    const asked = [];
    /** @type {string[]} */
    const withdrawn = [];
    await mockFamilyApi(page, {
      me: member('owner'),
      extra: {
        'GET members': () => ({ json: { items: [memberView(900, 'Eliska', 'owner'), karel] } }),
        'GET invitations': () => ({ json: { items: [] } }),
        'GET agents': () => ({ json: { items: [] } }),
        [`POST members/${ID(901)}/email-change`]: (_m, _u, body) => {
          asked.push(body);
          const { email } = /** @type {{ email: string }} */ (body);
          if (email === 'eliska@example.test') return { status: 409, json: { code: 'already_member', message: 'server text' } };
          karel.pendingEmail = email;
          return { json: karel };
        },
        [`DELETE members/${ID(901)}/email-change`]: () => {
          withdrawn.push(karel.pendingEmail ?? '');
          karel.pendingEmail = null;
          return { status: 204 };
        },
      },
    });
    await page.goto('./#settings');
    return { asked, withdrawn, row: page.locator('[data-testid="member"][data-email="karel@example.test"]') };
  };

  test('the Owner corrects an address: the link is on its way, the new address waits for confirmation, and nothing is wider than the screen', async ({
    page,
  }) => {
    const { asked, row } = await ownerWithKarel(page);
    await row.getByTestId('member-email-edit').click();
    await expect(row.getByTestId('member-email-form')).toContainText('The address changes only once the link is confirmed there');
    await row.getByTestId('member-email-input').fill('karel.right@example.test');
    expect(await fitsTheScreen(page)).toBe(true);
    await row.getByTestId('member-email-send').click();
    await expect(row.getByTestId('member-email-status')).toHaveText(
      'A confirmation link is on its way to karel.right@example.test. The address changes once it is confirmed.',
    );
    await expect(row.getByTestId('member-pending-email')).toContainText('New address waiting for confirmation: karel.right@example.test');
    // The current address stays until the new one is confirmed.
    await expect(row.locator('.member-head')).toContainText('karel@example.test');
    await expect(row.getByTestId('member-email-form')).toHaveCount(0);
    expect(asked).toEqual([{ email: 'karel.right@example.test' }]);
    expect(await fitsTheScreen(page)).toBe(true);
  });

  test("a refused address is explained in the reader's language, and the Owner withdraws a waiting address", async ({ page }) => {
    const { withdrawn, row } = await ownerWithKarel(page);
    await row.getByTestId('member-email-edit').click();
    await row.getByTestId('member-email-input').fill('eliska@example.test');
    await row.getByTestId('member-email-send').click();
    await expect(row.getByTestId('member-email-status')).toHaveText('This address already belongs to a Member.');
    await expect(row.getByTestId('member-pending-email')).toHaveCount(0);
    await row.getByTestId('member-email-input').fill('karel.typo@example.test');
    await row.getByTestId('member-email-send').click();
    await expect(row.getByTestId('member-pending-email')).toBeVisible();
    await row.getByTestId('member-email-withdraw').click();
    await expect(row.getByTestId('member-email-status')).toHaveText('The new address was withdrawn, and its link no longer works.');
    await expect(row.getByTestId('member-pending-email')).toHaveCount(0);
    expect(withdrawn).toEqual(['karel.typo@example.test']);
  });
});

test.describe('the page that confirms a new address', () => {
  /** Opens the link, as from the email: the page shows the button, and the token leaves the address bar. @param {import('@playwright/test').Page} page */
  const openLink = async (page) => {
    await page.goto(`./#address/${TOKEN}`);
    await expect(page).toHaveURL(/#address$/);
    await expect(page.getByRole('heading', { name: 'Confirm your new address' })).toBeVisible();
    await expect(page.getByTestId('address-confirm')).toBeVisible();
  };

  test('opening the link changes nothing until the button, and confirming names the new address without signing in', async ({ page }) => {
    const calls = await mockFamilyApi(page, {
      me: null,
      extra: { 'POST auth/email-change/confirm': () => ({ json: { ok: true, email: 'marta.right@example.test' } }) },
    });
    // Opened, closed, and opened again: nothing is sent.
    await openLink(page);
    await page.goto('./#map');
    await openLink(page);
    expect(calls.filter((c) => c.startsWith('POST auth/'))).toEqual([]);

    await page.getByTestId('address-confirm').click();
    await expect(page.getByTestId('address-confirmed')).toContainText('Done. Rodokmen now sends your sign-in links to marta.right@example.test.');
    expect(calls.filter((c) => c.startsWith('POST auth/'))).toEqual(['POST auth/email-change/confirm']);
    expect(await fitsTheScreen(page)).toBe(true);
    // Confirming signs nobody in: there is no tab bar, and Open Rodokmen opens the public map.
    await expect(page.getByTestId('tabbar')).toHaveCount(0);
    await page.getByTestId('address-open').click();
    await expect(page.locator('body')).toHaveAttribute('data-screen', 'map');
  });

  test("an old link says it no longer works, in the reader's language, and that the Owner can send a new one", async ({ page }) => {
    await mockFamilyApi(page, {
      me: null,
      extra: { 'POST auth/email-change/confirm': () => ({ status: 410, json: { code: 'address_link_invalid', message: 'server text' } }) },
    });
    await openLink(page);
    await page.getByTestId('address-confirm').click();
    await expect(page.getByTestId('sign-in-status')).toHaveText(
      'This link no longer works: it was already used, it expired after 7 days, or the Owner sent a newer one. Ask the Owner for a new link.',
    );
    await expect(page.getByTestId('sign-in-status')).toHaveClass(/error/);
    await expect(page.getByTestId('address-confirmed')).toHaveCount(0);
  });
});
