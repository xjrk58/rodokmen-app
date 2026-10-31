import { ProposalView } from '@rodokmen/shared';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type RodokmenApp } from '../src/app.js';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { OutboxMailer } from '../src/mail/mailer.js';
import { DEFAULT_APP_DIR } from '../src/routes/pages.js';
import { MemoryImageStorage } from '../src/storage/images.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { bearer, createAgentWithToken, createMember, ensureOwner, freePort, signIn, TestClock, testConfig } from './helpers.js';

/**
 * Agent work is labelled (agent-access spec): an Agent submits a Proposal with its token, and
 * the Editor sees the Agent's name and badge next to the author in the review queue and, once
 * accepted, in the record's history. In Chromium at phone (390 × 844) and desktop (1280 × 800)
 * size, against the real server. With AGENT_SCREENSHOT_DIR set, screenshots are written there.
 */
const L = generateFixture().landmarks;
const SCREENSHOTS = process.env.AGENT_SCREENSHOT_DIR;
const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
} as const;

describe('Agent badge in the app (Chromium, phone and desktop)', () => {
  let t: TestDatabase;
  let app: RodokmenApp;
  let browser: Browser;
  let origin: string;
  let editor: Account;
  let token: string;
  let proposalId: string;
  let personId: string;
  const clock = new TestClock(new Date());
  const contexts: BrowserContext[] = [];

  async function open(size: keyof typeof VIEWPORTS, hash: string): Promise<Page> {
    const context = await browser.newContext({ ...VIEWPORTS[size], locale: 'en-GB', serviceWorkers: 'block' });
    contexts.push(context);
    await context.route(
      (url) => !url.href.startsWith(origin),
      (route) => route.fulfill({ status: 404, body: '' }),
    );
    const cookie = (await signIn(t.db, clock, editor)).split('=')[1]!;
    await context.addCookies([{ name: 'rdk_session', value: cookie, url: origin }]);
    const page = await context.newPage();
    await page.goto(`${origin}/${hash}`);
    return page;
  }

  async function screenshot(page: Page, name: string) {
    if (!SCREENSHOTS) return;
    await mkdir(SCREENSHOTS, { recursive: true });
    await page.screenshot({ path: join(SCREENSHOTS, `${name}.png`), scale: 'css' });
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    const port = await freePort();
    origin = `http://localhost:${port}`;
    app = await buildApp({
      config: testConfig(t.url, { PUBLIC_ORIGIN: origin, APP_DIR: DEFAULT_APP_DIR }),
      db: t.db,
      mailer: new OutboxMailer(),
      clock,
      images: new MemoryImageStorage(clock, `${origin}/test-storage/`),
    });
    await app.listen({ host: 'localhost', port });
    await ensureOwner(t.db);
    editor = await createMember(t.db, 'editor', { displayName: 'Eva Editor', language: 'en' });
    ({ token } = await createAgentWithToken(t.db, clock, 'Register reader'));

    // The Agent's finding: a baptism with its Citation, submitted with the Agent token.
    const res = await app.inject({
      method: 'POST',
      url: '/api/proposals',
      headers: bearer(token),
      payload: {
        formatVersion: 1,
        idempotencyKey: `agent-${randomUUID()}`,
        note: 'Baptism of Ludmila, read in the 1842 register',
        operations: [
          { op: 'createPerson', tempId: 'tmp:p', sex: 'female', name: { given: 'Ludmila', surname: 'Invented', type: 'birth', asFound: 'Ludmilla' } },
          { op: 'createEvent', tempId: 'tmp:e', type: 'baptism', date: '1842-06-03', placeId: L.kamennaLhota },
          { op: 'addRole', eventId: 'tmp:e', personId: 'tmp:p', role: 'child' },
          { op: 'createSource', tempId: 'tmp:s', type: 'parish_register', title: 'Invented register N 1830–1850', repository: 'Invented archive' },
          {
            op: 'createCitation',
            tempId: 'tmp:c',
            sourceId: 'tmp:s',
            page: '41',
            transcription: 'Ludmilla, filia legitima, nata 2. Junii',
            readOn: '2026-10-20',
            confidence: 'normal',
          },
          { op: 'attachCitation', citationId: 'tmp:c', eventId: 'tmp:e' },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    proposalId = ProposalView.parse(res.json()).id;
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    for (const c of contexts) await c.close().catch(() => undefined);
    await browser?.close();
    await app?.close();
    await t?.drop();
  });

  for (const size of ['phone', 'desktop'] as const) {
    it(`reviewing an Agent Proposal (${size}): the Agent's name and badge appear next to the author`, async () => {
      const page = await open(size, '#work/review');
      const card = page.locator(`[data-id="${proposalId}"]`);
      await card.waitFor();
      const author = card.locator('.author');
      expect(await author.textContent()).toBe('Register readerAgent');
      expect(await author.getByTestId('agent-badge').textContent()).toBe('Agent');
      expect(await author.getByTestId('agent-badge').isVisible()).toBe(true);
      // The badge sits on the author's line, right after the name.
      const name = await author.boundingBox();
      const badge = await author.getByTestId('agent-badge').boundingBox();
      expect(badge!.x).toBeGreaterThanOrEqual(name!.x);
      expect(Math.abs(badge!.y + badge!.height / 2 - (name!.y + name!.height / 2))).toBeLessThan(8);
      await screenshot(page, `agent-proposal-review-${size}`);
    });
  }

  it('the accepted Proposal is labelled in record history too', async () => {
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/proposals/${proposalId}/accept`,
      headers: { cookie: await signIn(t.db, clock, editor), origin },
      payload: {},
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    personId = (
      await t.db
        .selectFrom('log_change as c')
        .innerJoin('log_entry as l', 'l.id', 'c.log_entry_id')
        .select('c.record_id')
        .where('l.proposal_id', '=', proposalId)
        .where('c.record_table', '=', 'person')
        .executeTakeFirstOrThrow()
    ).record_id;
    for (const size of ['phone', 'desktop'] as const) {
      const page = await open(size, `#work/history/person/${personId}`);
      const entry = page.getByTestId('history-entry').first();
      await entry.waitFor();
      const by = entry.getByTestId('history-by');
      expect(await by.textContent()).toBe('By Register readerAgent · accepted by Eva Editor');
      expect(await by.getByTestId('agent-badge').isVisible()).toBe(true);
      await screenshot(page, `agent-proposal-history-${size}`);
    }
  });
});
