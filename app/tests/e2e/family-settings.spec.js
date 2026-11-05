// add-family-view task 2.4 (family-view spec, "Owner settings in the app"), default-to-czech
// task 1.3 and add-whatsapp-invitations task 2.1 (family-view spec, "Sending an invitation through
// WhatsApp"): every Member's own settings, and the Owner's Member management, against the mocked API.
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

  test('a signed-in Member whose account language is English gets English on a new device, and no Czech before it', async ({ page }) => {
    /** @type {string[]} */
    const loaded = [];
    page.on('request', (request) => {
      const lang = /\/i18n\/(\w+)\.json$/.exec(request.url())?.[1];
      if (lang) loaded.push(lang);
    });
    await mockFamilyApi(page, { me: member('contributor', { person: 10, language: 'en' }) });
    await page.goto('./');
    await expect(page.getByTestId('tree')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('tabbar-people')).toContainText('People');
    // Nothing was stored on the device: the account decides.
    expect(await page.evaluate(() => localStorage.getItem('rodokmen.language'))).toBeNull();
    // The app asks who is signed in before it shows any text, so the Czech texts are never even loaded (#124).
    expect(loaded).toEqual(['en']);
  });

  test('a choice made on the device wins over the account language', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('rodokmen.language', 'cs'));
    await mockFamilyApi(page, { me: member('contributor', { person: 10, language: 'en' }) });
    await page.goto('./');
    await expect(page.getByTestId('tree')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'cs');
  });
});

const INVITE_TOKEN = 'invented-whatsapp-token-0123456789abcdef';
const LINK = `https://rodokmen.example/#invite/${INVITE_TOKEN}`;
const SHARE_TEXT = [
  'Hello, Eliska Invented invites you to Rodokmen, our family’s shared family tree.',
  `Accept the invitation with this link. It is valid for 7 days and works only once, so please do not forward it:\n${LINK}`,
  'The same invitation came by email to cousin@example.test.',
].join('\n\n');

/**
 * The Owner's Settings, with an answer to a new invitation that holds its link and message once.
 * @param {import('@playwright/test').Page} page
 */
async function ownerInviting(page) {
  /** @type {InvitationView[]} */
  const invitations = [];
  /** @type {unknown[]} */
  const sent = [];
  const calls = await mockFamilyApi(page, {
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
        return { status: 201, json: { ...view, link: LINK, shareText: SHARE_TEXT } };
      },
    },
  });
  return { invitations, sent, calls };
}

/**
 * Invites a cousin in English, as the Owner does in Settings.
 * @param {import('@playwright/test').Page} page
 */
async function inviteCousin(page) {
  await page.goto('./#settings');
  await page.getByTestId('invite-email').fill('cousin@example.test');
  await page.getByTestId('invite-language').selectOption('en');
  await page.getByTestId('send-invitation').click();
  await expect(page.getByTestId('invite-status')).toHaveText('The invitation is on its way by email. It is valid for 7 days.');
}

/**
 * Whether a text is kept anywhere on the device: in localStorage, sessionStorage or any IndexedDB store.
 * @param {import('@playwright/test').Page} page
 * @param {string} needle
 */
const keptOnDevice = (page, needle) =>
  page.evaluate(async (text) => {
    /** @template T @param {IDBRequest<T>} r @returns {Promise<T>} */
    const done = (r) =>
      new Promise(
        (resolve, reject) => ((r.onsuccess = () => resolve(r.result)), (r.onerror = () => reject(new Error(r.error?.message ?? 'IndexedDB request failed')))),
      );
    const kept = [JSON.stringify(Object.entries(localStorage)), JSON.stringify(Object.entries(sessionStorage))];
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      const db = await done(indexedDB.open(name));
      for (const store of db.objectStoreNames) kept.push(JSON.stringify(await done(db.transaction(store).objectStore(store).getAll())));
      db.close();
    }
    return kept.some((k) => k.includes(text));
  }, needle);

/**
 * Nothing on the screen is wider than the screen.
 * @param {import('@playwright/test').Page} page
 */
const fitsTheScreen = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('inviting a cousin: the Owner enters an email and language, and sees the invitation pending until it is accepted', async ({ page }) => {
  const { sent } = await ownerInviting(page);
  await inviteCousin(page);
  expect(sent).toEqual([{ email: 'cousin@example.test', language: 'en' }]);
  const row = page.locator('[data-testid="invitation"][data-email="cousin@example.test"]');
  await expect(row.getByTestId('invitation-status')).toHaveText('pending');
});

test.describe('sending an invitation through WhatsApp', () => {
  test('phone with a share sheet: the share sheet gets the message ready, and closing it is no failure', async ({ page, external }) => {
    await page.addInitScript(() => {
      /** @type {ShareData[]} */
      const shared = [];
      Object.assign(window, { shared });
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: (/** @type {ShareData} */ data) => typeof data.text === 'string' });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (/** @type {ShareData} */ data) => {
          shared.push(data);
          // The first time, the Owner closes the share sheet without choosing an app.
          if (shared.length === 1) throw new DOMException('Share canceled', 'AbortError');
        },
      });
    });
    await ownerInviting(page);
    await inviteCousin(page);
    const block = page.getByTestId('invitation-share');
    await expect(block).toBeVisible();
    await expect(block.getByTestId('invitation-message')).toHaveValue(SHARE_TEXT);
    await expect(block).toContainText('The link is shown only now. To send it later, withdraw the invitation and invite again.');
    await expect(block.getByTestId('invitation-whatsapp')).toBeFocused();
    expect(await fitsTheScreen(page)).toBe(true);

    await block.getByTestId('invitation-whatsapp').click();
    await expect.poll(() => page.evaluate(() => /** @type {{ shared: ShareData[] }} */ (/** @type {unknown} */ (window)).shared.length)).toBe(1);
    await expect(block.getByTestId('invitation-share-status')).toHaveText('');
    await block.getByTestId('invitation-whatsapp').click();
    // Only the text, with the link inside it: no url or title for a share target to drop.
    await expect
      .poll(() => page.evaluate(() => /** @type {{ shared: ShareData[] }} */ (/** @type {unknown} */ (window)).shared))
      .toEqual([{ text: SHARE_TEXT }, { text: SHARE_TEXT }]);
    await expect(block.getByTestId('invitation-share-status')).toHaveText('');
    // No web address with the token was opened: nothing went to wa.me or any other WhatsApp server.
    expect(external.filter((url) => /whatsapp|wa\.me/i.test(url) || url.includes(INVITE_TOKEN))).toEqual([]);
  });

  test('computer without a share sheet: no share button, and Copy the message puts it on the clipboard', async ({ page, external }) => {
    await page.addInitScript(() => {
      /** @type {string[]} */
      const copied = [];
      Object.assign(window, { copied });
      // As in Firefox on a computer, or Chrome on Linux: no Web Share API.
      Reflect.deleteProperty(Navigator.prototype, 'share');
      Reflect.deleteProperty(Navigator.prototype, 'canShare');
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (/** @type {string} */ text) => void copied.push(text) } });
    });
    await ownerInviting(page);
    await inviteCousin(page);
    const block = page.getByTestId('invitation-share');
    await expect(block).toContainText('copy the message and paste it into a chat with the relative');
    await expect(block.getByTestId('invitation-whatsapp')).toHaveCount(0);
    await expect(block.getByTestId('invitation-copy')).toBeFocused();
    expect(await fitsTheScreen(page)).toBe(true);
    await block.getByTestId('invitation-copy').click();
    await expect(block.getByTestId('invitation-share-status')).toHaveText('Copied. Paste it into WhatsApp.');
    expect(await page.evaluate(() => /** @type {{ copied: string[] }} */ (/** @type {unknown} */ (window)).copied)).toEqual([SHARE_TEXT]);
    expect(external.filter((url) => /whatsapp|wa\.me/i.test(url) || url.includes(INVITE_TOKEN))).toEqual([]);
  });

  test('where copying is refused, the message is selected to copy by hand', async ({ page }) => {
    await page.addInitScript(() => {
      Reflect.deleteProperty(Navigator.prototype, 'share');
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            throw new DOMException('Write permission denied.', 'NotAllowedError');
          },
        },
      });
    });
    await ownerInviting(page);
    await inviteCousin(page);
    await page.getByTestId('invitation-copy').click();
    await expect(page.getByTestId('invitation-share-status')).toHaveText('Copying did not work here. The message is selected: copy it by hand.');
    const message = page.getByTestId('invitation-message');
    await expect(message).toBeFocused();
    expect(await message.evaluate((/** @type {HTMLTextAreaElement} */ m) => m.value.slice(m.selectionStart, m.selectionEnd))).toBe(SHARE_TEXT);
  });

  test('leaving the message: Done forgets the link, which was never kept on the device, and the invitation stays pending', async ({ page }) => {
    const { calls } = await ownerInviting(page);
    await inviteCousin(page);
    await expect(page.getByTestId('invitation-share')).toBeVisible();
    expect(await keptOnDevice(page, INVITE_TOKEN)).toBe(false);
    await page.getByTestId('invitation-share-done').click();
    await expect(page.getByTestId('invitation-share')).toHaveCount(0);
    await expect(page.getByText(INVITE_TOKEN)).toHaveCount(0);
    const row = page.locator('[data-testid="invitation"][data-email="cousin@example.test"]');
    await expect(row.getByTestId('invitation-status')).toHaveText('pending');
    await expect(row.getByRole('button', { name: 'Withdraw' })).toBeVisible();
    // Leaving Settings and coming back shows the list only: the link is gone.
    await page.getByTestId('tabbar-tree').click();
    await page.getByTestId('tabbar-settings').click();
    await expect(row.getByTestId('invitation-status')).toHaveText('pending');
    await expect(page.getByTestId('invitation-share')).toHaveCount(0);
    expect(await keptOnDevice(page, INVITE_TOKEN)).toBe(false);
    expect(calls.filter((c) => c.startsWith('POST invitations'))).toHaveLength(1);
  });
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
