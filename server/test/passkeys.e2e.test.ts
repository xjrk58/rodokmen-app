import { Me, SessionList } from '@rodokmen/shared';
import { createServer } from 'node:net';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type RodokmenApp } from '../src/app.js';
import type { Account } from '../src/db/types.js';
import { OutboxMailer } from '../src/mail/mailer.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { ensureOwner, portOf, signIn, TestClock, testConfig, tokenFromEmail } from './helpers.js';

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

/** A phone: a browser context with its own virtual WebAuthn authenticator (platform, with user verification). */
async function phone(browser: Browser): Promise<{ context: BrowserContext; page: Page; cdp: CDPSession; authenticatorId: string }> {
  const context = await browser.newContext({ locale: 'cs-CZ' });
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

describe('passkeys in a real browser (virtual WebAuthn authenticator)', () => {
  let t: TestDatabase;
  let app: RodokmenApp;
  let browser: Browser;
  let origin: string;
  let owner: Account;
  const mailer = new OutboxMailer();
  const clock = new TestClock(new Date());

  beforeAll(async () => {
    t = await createTestDatabase();
    const port = await freePort();
    origin = `http://localhost:${port}`;
    app = await buildApp({ config: testConfig(t.url, { PUBLIC_ORIGIN: origin }), db: t.db, mailer, clock });
    await app.listen({ host: 'localhost', port });
    owner = await ensureOwner(t.db);
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await app?.close();
    await t?.drop();
  });

  it('accepting an invitation on a phone: set name and language, register a passkey, become a Contributor; then sign in with it', async () => {
    const ownerCookie = await signIn(t.db, clock, owner);
    const invited = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: { cookie: ownerCookie },
      payload: { email: 'marta@example.test', language: 'cs' },
    });
    expect(invited.statusCode).toBe(201);
    const token = tokenFromEmail(mailer.lastTo('marta@example.test')!.text);

    const { context, page, cdp, authenticatorId } = await phone(browser);
    await page.goto(`${origin}/auth/invite#token=${token}`);
    await page.locator('#invite-form').waitFor();
    // The page speaks the invitation's language, and the token is gone from the address bar.
    await expect.poll(() => page.locator('#accept').textContent()).toBe('Přijmout pozvánku');
    expect(page.url()).toBe(`${origin}/auth/invite`);
    await page.fill('#name', 'Marta');
    await page.selectOption('#language', 'en');
    await page.click('#accept');
    await page.locator('#passkey-step').waitFor();
    await page.click('#register-passkey');
    await page.locator('#done').waitFor();
    expect(await page.locator('#status').textContent()).toBe('Your passkey is saved. You are signed in.');

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
    await page.goto(`${origin}/auth/sign-in`);
    await page.click('#passkey-sign-in');
    await page.locator('#done').waitFor();
    const me = Me.parse(await page.evaluate(async (): Promise<unknown> => (await fetch('/api/me')).json()));
    expect(me).toMatchObject({ email: 'marta@example.test', displayName: 'Marta', role: 'contributor', passkeyCount: 1 });
    expect(
      (await t.db.selectFrom('passkey').select(['last_used_at', 'counter']).where('account_id', '=', account.id).executeTakeFirstOrThrow()).last_used_at,
    ).not.toBeNull();
    const sessions = SessionList.parse(await page.evaluate(async (): Promise<unknown> => (await fetch('/api/me/sessions')).json()));
    expect(sessions.items.find((s) => s.current)!.method).toBe('passkey');
    await context.close();
  }, 60_000);

  it('new phone: no passkey there, so an emailed link signs in and a passkey is registered on the new phone', async () => {
    const { context, page, cdp, authenticatorId } = await phone(browser);
    await page.goto(`${origin}/auth/sign-in`);
    await page.fill('#email', 'marta@example.test');
    await page.click('#send-link');
    await expect.poll(() => page.locator('#status').textContent()).toMatch(/link is on its way|odkaz je na cestě/);
    const email = mailer.lastTo('marta@example.test')!;
    expect(email.subject).toBe('Sign in to Rodokmen');

    await page.goto(`${origin}/auth/link#token=${tokenFromEmail(email.text)}`);
    await page.click('#link-sign-in');
    await page.locator('#passkey-step').waitFor();
    await page.click('#register-passkey');
    await page.locator('#done').waitFor();
    expect((await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials).toHaveLength(1);
    const me = Me.parse(await page.evaluate(async (): Promise<unknown> => (await fetch('/api/me')).json()));
    expect(me.passkeyCount).toBe(2);

    // The new phone's passkey works on its own.
    await context.clearCookies();
    await page.goto(`${origin}/auth/sign-in`);
    await page.click('#passkey-sign-in');
    await page.locator('#done').waitFor();
    expect(Me.parse(await page.evaluate(async (): Promise<unknown> => (await fetch('/api/me')).json())).email).toBe('marta@example.test');
    await context.close();
  }, 60_000);

  it('a passkey of a disabled Member no longer signs in', async () => {
    const { context, page, cdp, authenticatorId } = await phone(browser);
    // Register a passkey for a fresh Member through an emailed link.
    const member = await t.db
      .insertInto('account')
      .values({ email: 'leaving@example.test', display_name: 'Leaving', language: 'en' })
      .returningAll()
      .executeTakeFirstOrThrow();
    await app.inject({ method: 'POST', url: '/api/auth/email-link', payload: { email: member.email } });
    await page.goto(`${origin}/auth/link#token=${tokenFromEmail(mailer.lastTo(member.email)!.text)}`);
    await page.click('#link-sign-in');
    await page.click('#register-passkey');
    await page.locator('#done').waitFor();
    expect((await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials).toHaveLength(1);

    const ownerCookie = await signIn(t.db, clock, owner);
    expect((await app.inject({ method: 'POST', url: `/api/members/${member.id}/disable`, headers: { cookie: ownerCookie } })).statusCode).toBe(200);
    expect(await page.evaluate(async () => (await fetch('/api/me')).status)).toBe(401);
    await page.goto(`${origin}/auth/sign-in`);
    await page.click('#passkey-sign-in');
    await expect.poll(() => page.locator('#status').getAttribute('class')).toBe('error');
    expect(await page.evaluate(async () => (await fetch('/api/me')).status)).toBe(401);
    await context.close();
  }, 60_000);
  it('a language stored by something else (here "de") does not break the sign-in page', async () => {
    const context = await browser.newContext({ locale: 'en-US' });
    await context.addInitScript(() => localStorage.setItem('rodokmen.language', 'de'));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${origin}/auth/sign-in`);
    await expect.poll(() => page.locator('#lang-switch').textContent()).toBe('Čeština');
    expect(errors).toEqual([]);
    await context.close();
  });
});
