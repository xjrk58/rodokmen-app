import { mkdir } from 'node:fs/promises';
import { ProposalView } from '@rodokmen/shared';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { createMember, ensureOwner, signIn } from './helpers.js';
import { startLiveServer, type LiveServer } from './live-server.js';
import { citation, newKey } from './proposal-testbed.js';

declare global {
  interface Window {
    /** Exposed by this test to each page: reports a violation of the app's Content-Security-Policy. */
    reportCspViolation?: (v: string) => Promise<void>;
  }
}

/**
 * Kinship end to end (add-kinship task 10.1): the real server with the invented fixture Tree,
 * the app in Chromium at 390 and 1280 px under the app's Content-Security-Policy. An unlinked
 * Member asks to be linked to Norbert Javorník, the Owner confirms, and kinship appears on the
 * person page, in search and in the tree; the paths to his wife, who is also his second cousin;
 * a weak link read as "possibly" until an accepted Proposal confirms it; and a page reopened
 * offline. With FAMILY_SCREENSHOTS set to a folder, it saves phone screenshots there.
 */
const K = generateFixture().landmarks.kinship;
const SHOTS = process.env.FAMILY_SCREENSHOTS;

describe('kinship in the app against the real server (Chromium, phone and desktop)', () => {
  let live: LiveServer;
  let browser: Browser;
  let owner: Account;
  let editor: Account;
  let member: Account;
  const contexts: BrowserContext[] = [];
  const violations = new WeakMap<Page, string[]>();

  async function open(who: Account, size: 'phone' | 'desktop', hash: string): Promise<Page> {
    const context = await browser.newContext({
      ...(size === 'phone'
        ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
        : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }),
      locale: 'en-GB',
      serviceWorkers: 'block',
    });
    contexts.push(context);
    const found: string[] = [];
    await context.exposeBinding('reportCspViolation', (_source, v: string) => void found.push(v));
    await context.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => void window.reportCspViolation?.(`${e.effectiveDirective} ${e.blockedURI} ${e.sample}`));
    });
    await context.route(
      (url) => !url.href.startsWith(live.origin),
      (route) => route.fulfill({ status: 404, body: '' }),
    );
    const token = (await signIn(live.t.db, live.clock, who)).split('=')[1]!;
    await context.addCookies([{ name: 'rdk_session', value: token, url: live.origin }]);
    const page = await context.newPage();
    violations.set(page, found);
    await page.goto(`${live.origin}/${hash}`);
    return page;
  }
  const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const shot = async (page: Page, name: string) => {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true, animations: 'disabled' });
  };
  const inject = async (who: Account, method: 'GET' | 'POST', url: string, payload?: object) =>
    live.app.inject({ method, url, headers: { cookie: await signIn(live.t.db, live.clock, who), origin: live.origin }, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    live = await startLiveServer();
    owner = await ensureOwner(live.t.db);
    editor = await createMember(live.t.db, 'editor');
    member = await createMember(live.t.db, 'contributor', { displayName: 'Norbert Invented', language: 'en' });
    browser = await chromium.launch();
    if (SHOTS) await mkdir(SHOTS, { recursive: true });
  }, 60_000);
  afterAll(async () => {
    for (const c of contexts) await c.close().catch(() => undefined);
    await browser?.close();
    await live?.close();
  });

  it('an unlinked Member asks "This is me", the Owner confirms in Settings, and kinship appears', async () => {
    const page = await open(member, 'phone', `#people/${K.norbert}`);
    await page.getByTestId('this-is-me').click();
    await expect.poll(() => page.getByTestId('kinship-waiting').textContent()).toContain('Norbert Javorník');
    const settings = await open(owner, 'phone', '#settings');
    await expect.poll(() => settings.getByTestId('settings-request-count').textContent()).toBe('1');
    const row = settings.locator('[data-testid="member"]').filter({ hasText: 'Norbert Invented' });
    await row.getByTestId('member-request-confirm').click();
    await expect.poll(() => row.getByTestId('member-person').textContent()).toContain('Norbert Javorník');
    expect(violations.get(settings)).toEqual([]);
    await page.reload();
    await expect.poll(() => page.getByTestId('kinship-self').textContent()).toBe('This is you.');
  }, 60_000);

  it('the paths to his wife, who is also his second cousin, at 390 and 1280 px', async () => {
    for (const size of ['phone', 'desktop'] as const) {
      const page = await open(member, size, `#people/${K.radka}`);
      await expect.poll(() => page.getByTestId('kinship-term').first().textContent()).toBe('wife');
      await page.getByTestId('kinship-more').click();
      const second = page.getByTestId('kinship-paths').getByTestId('kinship-path').nth(1);
      expect(await second.getByTestId('kinship-term').textContent()).toBe('second cousin');
      expect(await second.getByTestId('kinship-degree').textContent()).toBe('collateral line, degree 6 (Czech law)');
      expect(await second.getByTestId('kinship-step').count()).toBe(6);
      expect(await fits(page)).toBe(true);
      expect(violations.get(page)).toEqual([]);
      if (size === 'phone') await shot(page, 'kinship-paths');
    }
  }, 60_000);

  it('search and the tree name the same kinship as the page', async () => {
    const page = await open(member, 'phone', '#people');
    await page.getByTestId('people-search').fill('javornik');
    const ignac = page.getByTestId('person-result').filter({ hasText: 'Ignác Javorník' });
    await expect.poll(() => ignac.getByTestId('kinship-short').textContent()).toBe('great-grandfather');
    expect(await fits(page)).toBe(true);
    await shot(page, 'kinship-search');
    await page.goto(`${live.origin}/#person-${K.bartolomej}`);
    await expect.poll(() => page.getByTestId('kinship-strip').textContent()).toContain('grandfather');
    expect(await page.locator(`[data-testid="tree-person"][data-person="${K.ignac}"]`).getAttribute('aria-label')).toContain('great-grandfather');
    await shot(page, 'kinship-tree');
    expect(violations.get(page)).toEqual([]);
  }, 60_000);

  it('a weak father link reads "possibly" until an accepted Proposal confirms it', async () => {
    const page = await open(member, 'phone', `#people/${K.felix}`);
    await expect.poll(() => page.getByTestId('kinship-term').first().textContent()).toContain('possibly half-great-uncle');
    await shot(page, 'kinship-possibly');
    const event = await live.t.db.selectFrom('event').select('version').where('id', '=', K.felixFatherEvent).executeTakeFirstOrThrow();
    const submitted = await inject(editor, 'POST', '/api/proposals', {
      formatVersion: 1,
      idempotencyKey: newKey(),
      note: null,
      operations: [...citation('FELIX'), { op: 'attachCitation', citationId: 'tmp:citFELIX', eventId: K.felixFatherEvent, baseVersion: event.version }],
    });
    expect(submitted.statusCode, submitted.body).toBe(201);
    const accepted = await inject(owner, 'POST', `/api/proposals/${ProposalView.parse(submitted.json()).id}/accept`, {});
    expect(accepted.statusCode, accepted.body).toBe(200);
    await page.reload();
    await expect.poll(() => page.getByTestId('kinship-term').first().textContent()).toBe('half-great-uncle');
  }, 60_000);

  it('offline, a page viewed before shows its kinship again', async () => {
    const page = await open(member, 'phone', `#people/${K.matous}`);
    await expect.poll(() => page.getByTestId('kinship-term').first().textContent()).toBe('first cousin once removed');
    await page.goto(`${live.origin}/#people/${K.norbert}`);
    await page.getByTestId('kinship-self').waitFor();
    await page.context().setOffline(true);
    await page.goto(`${live.origin}/#people/${K.matous}`).catch(() => undefined);
    await page.evaluate((id) => (location.hash = `#people/${id}`), K.matous).catch(() => undefined);
    await expect.poll(() => page.getByTestId('kinship-term').first().textContent()).toBe('first cousin once removed');
    await expect.poll(() => page.getByTestId('as-of').count()).toBe(1);
  }, 60_000);
});
