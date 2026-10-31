import { Me, SessionList } from '@rodokmen/shared';
import { createServer } from 'node:net';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type RodokmenApp } from '../src/app.js';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { OutboxMailer } from '../src/mail/mailer.js';
import { DEFAULT_APP_DIR } from '../src/routes/pages.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { ensureOwner, portOf, signIn, TestClock, testConfig, tokenFromEmail } from './helpers.js';

/**
 * Signing in, in the app's own screens (add-family-view task 1.2; member-accounts task 5.2),
 * against the real server in Chromium at phone size with a virtual WebAuthn authenticator.
 */
const L = generateFixture().landmarks;
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = portOf(srv.address());
      srv.close(() => resolve(port));
    });
  });
}

describe('signing in with passkeys in the app (virtual WebAuthn authenticator)', () => {
  let t: TestDatabase;
  let app: RodokmenApp;
  let browser: Browser;
  let origin: string;
  let owner: Account;
  const mailer = new OutboxMailer();
  const clock = new TestClock(new Date());

  /** A phone: a browser context with its own virtual authenticator (platform, with user verification), on an English-language phone. */
  async function phone(): Promise<{ context: BrowserContext; page: Page; cdp: CDPSession; authenticatorId: string }> {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'en-US',
      serviceWorkers: 'block',
    });
    await context.route(
      (url) => !url.href.startsWith(origin),
      (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }),
    );
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    return { context, page, cdp, authenticatorId };
  }

  const me = async (page: Page) => Me.parse(await page.evaluate(async (): Promise<unknown> => (await fetch('/api/me')).json()));

  beforeAll(async () => {
    t = await createTestDatabase();
    const port = await freePort();
    origin = `http://localhost:${port}`;
    app = await buildApp({ config: testConfig(t.url, { PUBLIC_ORIGIN: origin, APP_DIR: DEFAULT_APP_DIR }), db: t.db, mailer, clock });
    await app.listen({ host: 'localhost', port });
    owner = await ensureOwner(t.db);
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await app?.close();
    await t?.drop();
  });

  it('first visit from an invitation: name and language, a passkey, then the tree; later the passkey alone signs in', async () => {
    const ownerCookie = await signIn(t.db, clock, owner);
    const invited = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: { cookie: ownerCookie, origin },
      payload: { email: 'marta@example.test', language: 'cs' },
    });
    expect(invited.statusCode).toBe(201);
    const link = /https?:\/\/\S+/.exec(mailer.lastTo('marta@example.test')!.text)![0];
    expect(link).toBe(`${origin}/#invite/${tokenFromEmail(mailer.lastTo('marta@example.test')!.text)}`);

    const { context, page, cdp, authenticatorId } = await phone();
    await page.goto(link);
    // The app speaks the invitation's language (Czech) on this English phone, and the token is gone from the address.
    await expect.poll(() => page.getByTestId('accept-invitation').textContent()).toBe('Přijmout pozvánku');
    expect(page.url()).toBe(`${origin}/#invite`);
    await page.getByTestId('invite-name').fill('Marta');
    await page.getByTestId('invite-language').selectOption('en');
    await page.getByTestId('accept-invitation').click();
    await page.getByTestId('register-passkey').click();
    // The tree opens: she is not linked to a Person and there is no Family root yet, so it starts with search.
    await page.getByTestId('tree-start').waitFor();
    expect(await page.getByTestId('tabbar-tree').getAttribute('aria-current')).toBe('page');
    // Her account says English, and no language was chosen on this device: the app is in English now.
    await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('en');

    const credentials = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
    expect(credentials.credentials).toHaveLength(1);
    expect(credentials.credentials[0]!.isResidentCredential).toBe(true);
    expect(credentials.credentials[0]!.rpId).toBe('localhost');
    const account = await t.db.selectFrom('account').selectAll().where('email', '=', 'marta@example.test').executeTakeFirstOrThrow();
    expect(account).toMatchObject({ display_name: 'Marta', language: 'en', role: 'contributor' });
    const keys = await t.db.selectFrom('passkey').selectAll().where('account_id', '=', account.id).execute();
    expect(keys).toHaveLength(1);
    expect(keys[0]!.credential_id).toBe(Buffer.from(credentials.credentials[0]!.credentialId, 'base64').toString('base64url'));

    // Signed out (cookies gone), the passkey alone signs her in again.
    await context.clearCookies();
    expect(await page.evaluate(async () => (await fetch('/api/me')).status)).toBe(401);
    await page.goto(`${origin}/#sign-in`);
    await page.reload();
    await page.getByTestId('passkey-sign-in').click();
    await page.getByTestId('tree-start').waitFor();
    expect(await me(page)).toMatchObject({ email: 'marta@example.test', displayName: 'Marta', role: 'contributor', passkeyCount: 1 });
    expect(
      (await t.db.selectFrom('passkey').select(['last_used_at', 'counter']).where('account_id', '=', account.id).executeTakeFirstOrThrow()).last_used_at,
    ).not.toBeNull();
    const sessions = SessionList.parse(await page.evaluate(async (): Promise<unknown> => (await fetch('/api/me/sessions')).json()));
    expect(sessions.items.find((s) => s.current)!.method).toBe('passkey');
    await context.close();
  }, 60_000);

  it('new phone: no passkey there, so an emailed link signs in and a passkey is registered on the new phone', async () => {
    const { context, page, cdp, authenticatorId } = await phone();
    await page.goto(`${origin}/#sign-in`);
    await page.getByTestId('sign-in-email').fill('marta@example.test');
    await page.getByTestId('send-link').click();
    await expect.poll(() => page.getByTestId('sign-in-status').textContent()).toMatch(/link is on its way|odkaz je na cestě/);
    const email = mailer.lastTo('marta@example.test')!;
    expect(email.subject).toBe('Sign in to Rodokmen');

    await page.goto(`${origin}/#link/${tokenFromEmail(email.text)}`);
    await page.getByTestId('link-sign-in').click();
    await page.getByTestId('register-passkey').click();
    await page.getByTestId('tree-start').waitFor();
    expect((await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials).toHaveLength(1);
    expect((await me(page)).passkeyCount).toBe(2);

    // The new phone's passkey works on its own.
    await context.clearCookies();
    await page.goto(`${origin}/#sign-in`);
    await page.reload();
    await page.getByTestId('passkey-sign-in').click();
    await page.getByTestId('tree-start').waitFor();
    expect((await me(page)).email).toBe('marta@example.test');
    await context.close();
  }, 60_000);

  it('shared link: a Member who opens the address of a cousin in the tree sees that cousin after signing in', async () => {
    const { context, page } = await phone();
    // Marta saved a passkey on this phone first.
    await app.inject({ method: 'POST', url: '/api/auth/email-link', payload: { email: 'marta@example.test' } });
    await page.goto(`${origin}/#link/${tokenFromEmail(mailer.lastTo('marta@example.test')!.text)}`);
    await page.getByTestId('link-sign-in').click();
    await page.getByTestId('register-passkey').click();
    await page.getByTestId('tree-start').waitFor();
    await context.clearCookies();

    await page.goto(`${origin}/#person-${L.adoptedChild}`);
    await page.reload();
    await page.getByTestId('sign-in-required').waitFor();
    // Nothing about any Person is shown before signing in.
    expect(await page.getByTestId('tree').count()).toBe(0);
    await page.getByTestId('passkey-sign-in').click();
    await page.getByTestId('tree').waitFor();
    expect(await page.getByTestId('tree').getAttribute('data-focus')).toBe(L.adoptedChild);
    expect(page.url()).toBe(`${origin}/#person-${L.adoptedChild}`);
    await context.close();
  }, 60_000);

  it('a passkey of a disabled Member no longer signs in', async () => {
    const { context, page, cdp, authenticatorId } = await phone();
    const member = await t.db
      .insertInto('account')
      .values({ email: 'leaving@example.test', display_name: 'Leaving', language: 'en' })
      .returningAll()
      .executeTakeFirstOrThrow();
    await app.inject({ method: 'POST', url: '/api/auth/email-link', payload: { email: 'leaving@example.test' } });
    await page.goto(`${origin}/#link/${tokenFromEmail(mailer.lastTo('leaving@example.test')!.text)}`);
    await page.getByTestId('link-sign-in').click();
    await page.getByTestId('register-passkey').click();
    await page.getByTestId('tree-start').waitFor();
    expect((await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials).toHaveLength(1);

    const ownerCookie = await signIn(t.db, clock, owner);
    expect((await app.inject({ method: 'POST', url: `/api/members/${member.id}/disable`, headers: { cookie: ownerCookie, origin } })).statusCode).toBe(200);
    expect(await page.evaluate(async () => (await fetch('/api/me')).status)).toBe(401);
    await page.goto(`${origin}/#sign-in`);
    await page.reload();
    await page.getByTestId('passkey-sign-in').click();
    await expect.poll(() => page.getByTestId('sign-in-status').getAttribute('class')).toContain('error');
    expect(await page.evaluate(async () => (await fetch('/api/me')).status)).toBe(401);
    await context.close();
  }, 60_000);

  it('a language stored by something else (here "de") does not break signing in: the app opens in Czech', async () => {
    const context = await browser.newContext({ locale: 'en-US' });
    await context.addInitScript(() => localStorage.setItem('rodokmen.language', 'de'));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${origin}/#sign-in`);
    await expect.poll(() => page.getByTestId('passkey-sign-in').textContent()).toBe('Přihlásit se přístupovým klíčem');
    expect(errors).toEqual([]);
    await context.close();
  });
});
