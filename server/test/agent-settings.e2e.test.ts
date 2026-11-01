import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp, type RodokmenApp } from '../src/app.js';
import type { Account } from '../src/db/types.js';
import { OutboxMailer } from '../src/mail/mailer.js';
import { DEFAULT_APP_DIR } from '../src/routes/pages.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { bearer, createAgentWithToken, createMember, ensureOwner, freePort, signIn, TestClock, testConfig } from './helpers.js';

declare global {
  interface Window {
    /** Exposed by this test to each page: reports a violation of the app's Content-Security-Policy. */
    reportCspViolation?: (v: string) => Promise<void>;
  }
}

/**
 * The Agents in Owner settings (#45; agent-access spec, "Agent accounts belong to the Owner";
 * family-view spec, "Owner settings in the app"), against the real server in Chromium at phone
 * (390 × 844) and desktop (1280 × 800) size, under the app's Content-Security-Policy and with
 * no browser dialog. The phone runs in Czech, the Owner's account language; the desktop in
 * English, chosen on the device. With AGENT_SETTINGS_SCREENSHOTS set to a folder, it saves a
 * phone screenshot of the section there.
 */
const SHOTS = process.env.AGENT_SETTINGS_SCREENSHOTS;
const SIZES = {
  phone: { options: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, language: 'cs' },
  desktop: { options: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false }, language: 'en' },
} as const;
type Size = keyof typeof SIZES;

const Strings = z.record(z.string(), z.string());
const STRINGS = {
  cs: Strings.parse(JSON.parse(readFileSync(join(DEFAULT_APP_DIR, 'i18n/cs.json'), 'utf8'))),
  en: Strings.parse(JSON.parse(readFileSync(join(DEFAULT_APP_DIR, 'i18n/en.json'), 'utf8'))),
};
/** The interface string `key` in the language of `size`, with its placeholders filled. */
function text(size: Size, key: string, params: Record<string, string> = {}): string {
  const template = STRINGS[SIZES[size].language][key];
  if (template === undefined) throw new Error(`no string ${key}`);
  return template.replace(/\{(\w+)\}/g, (m, name: string) => params[name] ?? m);
}

const TOKEN = /^rdk_ag_[0-9a-f]{64}$/;

interface Opened {
  page: Page;
  /** Messages of browser dialogs (alert, confirm, prompt) the page opened: there must be none. */
  dialogs: string[];
  /** Violations of the app's Content-Security-Policy the page reported. */
  violations: string[];
  /** Paths under /api/ the page requested. */
  requests: string[];
}

describe('Agents in Owner settings (Chromium, phone and desktop, real server)', () => {
  let t: TestDatabase;
  let app: RodokmenApp;
  let browser: Browser;
  let origin: string;
  let owner: Account;
  let editor: Account;
  let contributor: Account;
  const clock = new TestClock(new Date());
  const contexts: BrowserContext[] = [];

  async function openSettings(member: Account, size: Size): Promise<Opened> {
    const context = await browser.newContext({ ...SIZES[size].options, locale: 'en-GB', serviceWorkers: 'block' });
    contexts.push(context);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const opened: Omit<Opened, 'page'> = { dialogs: [], violations: [], requests: [] };
    await context.exposeBinding('reportCspViolation', (_source, v: string) => void opened.violations.push(v));
    await context.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => void window.reportCspViolation?.(`${e.effectiveDirective} ${e.blockedURI} ${e.sample}`));
    });
    // The desktop chooses English on the device; the phone follows the account language.
    if (SIZES[size].language === 'en') await context.addInitScript(() => localStorage.setItem('rodokmen.language', 'en'));
    await context.route(
      (url) => !url.href.startsWith(origin),
      (route) => route.fulfill({ status: 404, body: '' }),
    );
    const cookie = (await signIn(t.db, clock, member)).split('=')[1]!;
    await context.addCookies([{ name: 'rdk_session', value: cookie, url: origin }]);
    const page = await context.newPage();
    page.on('dialog', (d) => {
      opened.dialogs.push(d.message());
      void d.dismiss();
    });
    page.on('request', (r) => {
      const path = new URL(r.url()).pathname;
      if (path.startsWith('/api/')) opened.requests.push(`${r.method()} ${path}`);
    });
    await page.goto(`${origin}/#settings`);
    await page.getByTestId('settings-screen').waitFor();
    expect(await page.locator('html').getAttribute('lang')).toBe(SIZES[size].language);
    return { page, ...opened };
  }

  /** What an Agent token gets from the API (GET /api/me). */
  const statusWith = async (token: string) => (await app.inject({ method: 'GET', url: '/api/me', headers: bearer(token) })).statusCode;

  /** Everything the page keeps on the device: localStorage, sessionStorage and every IndexedDB store. */
  const keptOnDevice = (page: Page) =>
    page.evaluate(async () => {
      const kept: unknown[] = [{ ...localStorage }, { ...sessionStorage }];
      const request = <T>(r: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(new Error(String(r.error)));
        });
      for (const { name } of await indexedDB.databases()) {
        if (!name) continue;
        const db = await request(indexedDB.open(name));
        for (const store of Array.from(db.objectStoreNames)) kept.push(await request(db.transaction(store).objectStore(store).getAll()));
        db.close();
      }
      return JSON.stringify(kept);
    });

  const agentRow = (page: Page, id: string): Locator => page.getByTestId('settings-agents').locator(`[data-testid="agent"][data-id="${id}"]`);

  beforeAll(async () => {
    t = await createTestDatabase();
    const port = await freePort();
    origin = `http://localhost:${port}`;
    app = await buildApp({ config: testConfig(t.url, { PUBLIC_ORIGIN: origin, APP_DIR: DEFAULT_APP_DIR }), db: t.db, mailer: new OutboxMailer(), clock });
    await app.listen({ host: 'localhost', port });
    owner = await ensureOwner(t.db);
    editor = await createMember(t.db, 'editor', { displayName: 'Eva Editor', language: 'cs' });
    contributor = await createMember(t.db, 'contributor', { displayName: 'Bohdana Invented', language: 'cs' });
    browser = await chromium.launch();
    if (SHOTS) await mkdir(SHOTS, { recursive: true });
  }, 60_000);

  afterAll(async () => {
    for (const c of contexts) await c.close().catch(() => undefined);
    await browser?.close();
    await app?.close();
    await t?.drop();
  });

  for (const size of ['phone', 'desktop'] as const) {
    describe(size, () => {
      it(`creating an Agent (${size}): its token shows once with a copy button and works; after a reload only its prefix is left, and nothing kept it on the device`, async () => {
        const o = await openSettings(owner, size);
        const section = o.page.getByTestId('settings-agents');
        await section.getByTestId('agent-name').fill(`Register reader ${size}`);
        await section.getByTestId('agent-token-label').fill('laptop');
        await section.getByTestId('agent-create-submit').click();

        const once = section.getByTestId('token-once');
        await once.waitFor();
        expect(await once.getByRole('heading').textContent()).toBe(text(size, 'settings.agents.firstToken', { name: `Register reader ${size}` }));
        expect(await once.textContent()).toContain(text(size, 'settings.agents.onlyOnce'));
        const token = (await once.getByTestId('token-value').textContent())!;
        expect(token).toMatch(TOKEN);
        // The copy button puts the whole token on the clipboard.
        await once.getByTestId('token-copy').click();
        await expect.poll(() => once.getByTestId('token-copy-status').textContent()).toBe(text(size, 'settings.agents.copied'));
        expect(await o.page.evaluate(() => navigator.clipboard.readText())).toBe(token);
        expect(await statusWith(token)).toBe(200);

        // The new Agent is listed with its token by prefix and label.
        const [agent] = (await t.db.selectFrom('account').select('id').where('display_name', '=', `Register reader ${size}`).execute()).map((a) => a.id);
        const row = agentRow(o.page, agent!);
        const tokenRow = row.locator(`[data-testid="agent-token"][data-prefix="${token.slice(0, 15)}"]`);
        await tokenRow.waitFor();
        expect(await tokenRow.getByTestId('token-label').textContent()).toBe('laptop');
        expect(await tokenRow.textContent()).not.toContain(token);
        expect(await keptOnDevice(o.page)).not.toContain(token.slice(7));

        // After a reload the token is nowhere; the list shows the prefix, the use of the token and this hour's count.
        await o.page.reload();
        await agentRow(o.page, agent!).waitFor();
        expect(await o.page.getByTestId('token-once').count()).toBe(0);
        expect(await o.page.content()).not.toContain(token.slice(7));
        expect(await keptOnDevice(o.page)).not.toContain(token.slice(7));
        const reloaded = agentRow(o.page, agent!);
        expect(await reloaded.getByTestId('agent-token').count()).toBe(1);
        expect(await reloaded.getByTestId('agent-token').getAttribute('data-prefix')).toBe(token.slice(0, 15));
        expect(await reloaded.getByTestId('agent-token').getByTestId('token-times').textContent()).toContain(
          text(size, 'settings.lastUsed', { time: '' }).trim(),
        );
        expect(await reloaded.getByTestId('agent-times').textContent()).toContain(text(size, 'settings.lastSeen', { time: '' }).trim());
        const thousand = new Intl.NumberFormat(SIZES[size].language).format(1000);
        expect(await reloaded.getByTestId('usage-reads').textContent()).toContain(text(size, 'settings.agents.reads', { count: '1', limit: thousand }));
        expect(await reloaded.getByTestId('usage-proposals').textContent()).toContain(text(size, 'settings.agents.proposals', { count: '0', limit: '60' }));
        expect(o.dialogs).toEqual([]);
        expect(o.violations).toEqual([]);
      }, 60_000);

      it(`revoking a token (${size}): the page asks first, without a dialog; then the token shows as revoked and the next request with it is refused with 401`, async () => {
        const { agent, token, tokenId } = await createAgentWithToken(t.db, clock, `Revoked reader ${size}`);
        expect(await statusWith(token)).toBe(200);
        const o = await openSettings(owner, size);
        const row = agentRow(o.page, agent.id);
        const tokenRow = row.locator(`[data-testid="agent-token"][data-id="${tokenId}"]`);
        await tokenRow.waitFor();

        // Keeping it changes nothing.
        await tokenRow.getByTestId('token-revoke').click();
        const confirm = tokenRow.getByTestId('revoke-confirm');
        expect(await confirm.textContent()).toContain(text(size, 'settings.agents.revokeConfirm', { prefix: token.slice(0, 15) }));
        await confirm.getByTestId('revoke-no').click();
        expect(await tokenRow.getByTestId('revoke-confirm').count()).toBe(0);
        expect(await statusWith(token)).toBe(200);

        await tokenRow.getByTestId('token-revoke').click();
        await tokenRow.getByTestId('revoke-confirm').getByTestId('revoke-yes').click();
        await tokenRow.getByTestId('token-revoked').waitFor();
        expect(await tokenRow.getByTestId('token-revoked').textContent()).toBe(text(size, 'settings.agents.revoked'));
        expect(await tokenRow.getByTestId('token-revoke').count()).toBe(0);
        expect(await row.getByTestId('agent-status').textContent()).toBe(text(size, 'settings.agents.revokedNow'));
        expect(await statusWith(token)).toBe(401);

        await o.page.reload();
        await agentRow(o.page, agent.id).locator(`[data-testid="agent-token"][data-id="${tokenId}"]`).getByTestId('token-revoked').waitFor();
        expect(o.dialogs).toEqual([]);
        expect(o.violations).toEqual([]);
      }, 60_000);

      it(`issuing another token (${size}): shown once in the Agent's row, works at once, and is listed newest first`, async () => {
        const { agent, tokenId: first } = await createAgentWithToken(t.db, clock, `Second machine ${size}`);
        const o = await openSettings(owner, size);
        const row = agentRow(o.page, agent.id);
        await row.getByTestId('agent-issue').click();
        await row.getByTestId('issue-label').fill('desktop at home');
        await row.getByTestId('issue-submit').click();
        const once = row.getByTestId('token-once');
        await once.waitFor();
        expect(await once.getByRole('heading').textContent()).toBe(text(size, 'settings.agents.newToken', { name: `Second machine ${size}` }));
        const token = (await once.getByTestId('token-value').textContent())!;
        expect(token).toMatch(TOKEN);
        expect(await statusWith(token)).toBe(200);
        await expect.poll(() => row.getByTestId('agent-token').count()).toBe(2);
        expect(await row.getByTestId('agent-token').first().getAttribute('data-prefix')).toBe(token.slice(0, 15));
        expect(await row.getByTestId('agent-token').first().getByTestId('token-label').textContent()).toBe('desktop at home');
        expect(await row.getByTestId('agent-token').nth(1).getAttribute('data-id')).toBe(first);

        if (SHOTS) {
          // The whole section as the Owner sees it, with a new token shown once: the screen is
          // made tall enough to hold it, at the width of the device.
          const section = o.page.getByTestId('settings-agents');
          const { width } = SIZES[size].options.viewport;
          await o.page.setViewportSize({ width, height: Math.ceil((await section.boundingBox())!.height) + 400 });
          await once.scrollIntoViewIfNeeded();
          await section.screenshot({ path: join(SHOTS, `agent-settings-${size}.png`) });
          await o.page.setViewportSize(SIZES[size].options.viewport);
        }
        await once.getByTestId('token-done').click();
        expect(await row.getByTestId('token-once').count()).toBe(0);
        expect(await o.page.content()).not.toContain(token.slice(7));
        expect(o.dialogs).toEqual([]);
        expect(o.violations).toEqual([]);
      }, 60_000);

      it(`disabling an Agent (${size}): it shows as disabled and none of its tokens works until it is enabled again`, async () => {
        const { agent, token } = await createAgentWithToken(t.db, clock, `Paused reader ${size}`);
        const o = await openSettings(owner, size);
        const row = agentRow(o.page, agent.id);
        await row.waitFor();
        expect(await row.getByTestId('agent-disabled').count()).toBe(0);
        expect(await row.getByTestId('agent-disable').textContent()).toBe(text(size, 'settings.disable'));
        await row.getByTestId('agent-disable').click();
        await row.getByTestId('agent-disabled').waitFor();
        expect(await row.getByTestId('agent-disabled').textContent()).toBe(text(size, 'settings.disabled'));
        expect(await row.textContent()).toContain(text(size, 'settings.agents.disabledText'));
        expect(await statusWith(token)).toBe(401);

        await o.page.reload();
        const again = agentRow(o.page, agent.id);
        await again.getByTestId('agent-disabled').waitFor();
        expect(await again.getByTestId('agent-disable').textContent()).toBe(text(size, 'settings.enable'));
        await again.getByTestId('agent-disable').click();
        await expect.poll(() => again.getByTestId('agent-disabled').count()).toBe(0);
        expect(await statusWith(token)).toBe(200);
        expect(o.dialogs).toEqual([]);
        expect(o.violations).toEqual([]);
      }, 60_000);

      for (const role of ['editor', 'contributor'] as const) {
        it(`a ${role} (${size}) sees no Agents in settings, and the app does not ask for them`, async () => {
          const o = await openSettings(role === 'editor' ? editor : contributor, size);
          await o.page.getByTestId('settings-sessions').getByTestId('session').first().waitFor();
          expect(await o.page.getByTestId('settings-agents').count()).toBe(0);
          expect(await o.page.getByText(text(size, 'settings.agents.title'), { exact: true }).count()).toBe(0);
          expect(o.requests.filter((r) => r.includes('/api/agents'))).toEqual([]);
          // The API refuses them anyway.
          const cookie = await signIn(t.db, clock, role === 'editor' ? editor : contributor);
          expect((await app.inject({ method: 'GET', url: '/api/agents', headers: { cookie } })).statusCode).toBe(403);
          expect(o.violations).toEqual([]);
        }, 60_000);
      }
    });
  }
});
