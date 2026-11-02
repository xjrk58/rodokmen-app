import { Operation, ProposalView } from '@rodokmen/shared';
import { mkdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { buffer } from 'node:stream/consumers';
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from 'playwright';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type RodokmenApp } from '../src/app.js';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { OutboxMailer } from '../src/mail/mailer.js';
import { DEFAULT_APP_DIR } from '../src/routes/pages.js';
import { readingDay } from '../src/readings/settings.js';
import { MemoryImageStorage } from '../src/storage/images.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { fakeAnthropic, fakeReader, recording } from './fake-anthropic.js';
import { createMember, ensureOwner, freePort, portOf, signIn, TestClock, testConfig } from './helpers.js';

const L = generateFixture().landmarks;
/** Where the phone screenshot of the check screen goes, when set. */
const SCREENSHOT = process.env.SCAN_CHECK_SCREENSHOT;
const BUCKET_PATH = '/rodokmen-images-test/';
/** The map behind the work panel loads tiles from these (app/data/layers.json); they are refused here. */
const MAP_HOSTS = ['https://tile.openstreetmap.org/', 'https://geoportal.gov.cz/'];

const DEVICES: Record<'phone' | 'desktop', BrowserContextOptions> = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 } },
};

interface Violation {
  directive: string;
  blocked: string;
}

declare global {
  interface Window {
    /** Exposed by this test to each page (named apart from csp.e2e.test.ts's). */
    reportReadingViolation?: (v: Violation) => Promise<void>;
  }
}

/** An invented page of a baptism register: ruled scribbles under a heading. */
async function registerPage(): Promise<Buffer> {
  const lines = Array.from(
    { length: 24 },
    (_, i) => `<path d="M80 ${260 + i * 52} q 110 -16 220 0 t 220 0 t 220 0 t 220 0" stroke="#4a3b28" stroke-width="4" fill="none"/>`,
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><rect width="100%" height="100%" fill="#e9dfc7"/><text x="80" y="180" font-size="64" fill="#3b2f1e">Anno 1830 · baptizati</text>${lines}</svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

/**
 * The scan reading screens against the real server and database, in Chromium at phone size
 * (390 × 844) and desktop size, under the app's Content-Security-Policy (add-scan-reading task
 * 2.4): "Read a scan" in the Propose flow, a page read into a Draft with three entries (the
 * reader answers with a recorded response), the check screen with the scan beside the entries,
 * one tap to link the known father, a corrected and confirmed entry, and the Proposal it
 * submits. The browser talks only to the app's origin and the image host: the Anthropic API is
 * called by the server alone.
 */
describe('scan reading in the app (Chromium, phone and desktop, under the CSP)', () => {
  let t: TestDatabase;
  let app: RodokmenApp;
  let browser: Browser;
  let origin: string;
  let imageOrigin: string;
  let imageServer: Server;
  let storage: MemoryImageStorage;
  let owner: Account;
  let editor: Account;
  const anthropic = fakeAnthropic(recording('baptism-page'));
  const clock = new TestClock(new Date());
  const contexts: BrowserContext[] = [];

  /** The image host, on another origin, as files.<domain> is: GET and PUT of the bucket, with Caddy's CORS answers. */
  async function imageHost(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url!, imageOrigin);
    res.setHeader('access-control-allow-origin', origin);
    const key = url.pathname.replace(BUCKET_PATH, '');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-methods': 'GET, HEAD, PUT', 'access-control-allow-headers': 'content-type' }).end();
    } else if (req.method === 'PUT') {
      await storage.put(key, await buffer(req), req.headers['content-type'] ?? 'application/octet-stream');
      res.writeHead(200).end();
    } else {
      const object = storage.objects.get(key);
      if (!object) res.writeHead(404).end();
      else res.writeHead(200, { 'content-type': key.endsWith('.webp') ? 'image/webp' : object.contentType }).end(object.body);
    }
  }

  async function open(device: BrowserContextOptions, member: Account) {
    const context = await browser.newContext({ ...device, locale: 'en-GB', serviceWorkers: 'block' });
    contexts.push(context);
    await context.addInitScript(() => localStorage.setItem('rodokmen.language', 'en'));
    const violations: Violation[] = [];
    const offOrigin: string[] = [];
    await context.exposeBinding('reportReadingViolation', (_source, v: Violation) => void violations.push(v));
    await context.addInitScript(() => {
      document.addEventListener(
        'securitypolicyviolation',
        (e) => void window.reportReadingViolation?.({ directive: e.effectiveDirective, blocked: e.blockedURI }),
      );
    });
    // Off the app's origin only the image host answers; map tiles and anything else are refused.
    await context.route(
      (url) => !url.href.startsWith(origin),
      async (route) => {
        const url = route.request().url();
        offOrigin.push(url);
        if (url.startsWith(`${imageOrigin}/`)) return route.continue();
        return route.abort('blockedbyclient');
      },
    );
    await context.addCookies([{ name: 'rdk_session', value: (await signIn(t.db, clock, member)).split('=')[1]!, url: origin }]);
    const page = await context.newPage();
    return { page, violations, offOrigin };
  }

  const inject = async (member: Account, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie: await signIn(t.db, clock, member), origin }, ...(payload ? { payload } : {}) });

  const setSwitch = async (enabled: boolean, dailyLimit = 20) =>
    expect((await inject(owner, 'PUT', '/api/settings/scan-reading', { enabled, dailyLimit })).statusCode).toBe(200);

  beforeAll(async () => {
    t = await createTestDatabase();
    const port = await freePort();
    origin = `http://localhost:${port}`;
    imageServer = createServer((req, res) => void imageHost(req, res).catch(() => res.writeHead(500).end()));
    await new Promise<void>((resolve) => imageServer.listen(0, '127.0.0.1', resolve));
    imageOrigin = `http://127.0.0.1:${portOf(imageServer.address())}`;
    storage = new MemoryImageStorage(clock, `${imageOrigin}${BUCKET_PATH}`);
    app = await buildApp({
      config: testConfig(t.url, { PUBLIC_ORIGIN: origin, APP_DIR: DEFAULT_APP_DIR, S3_PUBLIC_ENDPOINT: imageOrigin }),
      db: t.db,
      mailer: new OutboxMailer(),
      clock,
      images: storage,
      reader: fakeReader(anthropic),
    });
    await app.listen({ host: 'localhost', port });
    owner = await ensureOwner(t.db);
    editor = await createMember(t.db, 'editor', { displayName: 'Eva Editor', language: 'en' });
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    for (const c of contexts) await c.close().catch(() => undefined);
    await browser?.close();
    await app?.close();
    await new Promise((resolve) => imageServer?.close(resolve));
    await t?.drop();
  });

  /** Reads the invented page from the Propose flow, and waits for the check screen. */
  async function readPage(page: Page, options: { crop: boolean }) {
    await page.goto(`${origin}/#work/propose`);
    await page.getByTestId('kind-read').click();
    await page.getByTestId('read-start').waitFor();
    await page.getByTestId('scan-input').setInputFiles({ name: 'register-1830.jpg', mimeType: 'image/jpeg', buffer: await registerPage() });
    await page.getByTestId('crop-frame').locator('img').waitFor();
    if (options.crop) {
      // Mark the upper half of the page: only that part is sent.
      const box = (await page.getByTestId('crop-frame').boundingBox())!;
      await page.mouse.move(box.x + 4, box.y + 4);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 5 });
      await page.mouse.up();
      expect(await page.getByTestId('crop-box').isVisible()).toBe(true);
    }
    await page.getByTestId('read-title').fill('Invented register N 1820–1840');
    await page.getByTestId('read-page').fill('41');
    await page.getByTestId('read-place-search').fill('Kamenná');
    await page
      .getByTestId('read-place-results')
      .getByRole('button', { name: /Kamenná Lhota/ })
      .first()
      .click();
    await page.getByTestId('read-from').fill('1830');
    await page.getByTestId('read').click();
    await page.waitForURL(/#work\/draft\//, { timeout: 15_000 });
    await page.getByTestId('reading-check').waitFor({ timeout: 20_000 });
  }

  for (const [name, device] of Object.entries(DEVICES)) {
    it(`${name}: a page with three baptisms is read into a Draft, checked, one father linked with one tap, and submitted with its "read by AI" marks (scenario "Baptism page")`, async () => {
      await setSwitch(true);
      anthropic.requests.length = 0;
      const member = await createMember(t.db, 'contributor', { displayName: `Karel ${name}`, language: 'en' });
      const { page, violations, offOrigin } = await open(device, member);
      await readPage(page, { crop: name === 'desktop' });

      // The server sent one image: the display copy, or on desktop the marked upper half.
      expect(anthropic.requests).toHaveLength(1);
      const images = anthropic.requests[0]!.body.messages[0]!.content.filter((c) => c.type === 'image');
      expect(images).toHaveLength(1);
      const meta = await sharp(Buffer.from(images[0]!.source!.data, 'base64')).metadata();
      expect([meta.width, meta.height]).toEqual(name === 'desktop' ? [expect.any(Number), expect.any(Number)] : [1200, 1600]);
      if (name === 'desktop') expect(meta.height).toBeLessThan(meta.width);

      const entries = page.getByTestId('entry');
      expect(await entries.count()).toBe(3);
      for (let i = 0; i < 3; i++) {
        const roles = await entries
          .nth(i)
          .getByTestId('read-person')
          .evaluateAll((els) => els.map((e) => e.getAttribute('data-role')));
        expect(roles).toEqual(['child', 'father', 'mother', 'godparent', 'priest']);
        expect(await entries.nth(i).getByTestId('entry-transcription').textContent()).toMatch(/baptizat/);
      }
      expect(await entries.nth(0).getByTestId('entry-date').inputValue()).toBe('1830-03-14');
      expect(await entries.nth(0).getByTestId('entry-house').inputValue()).toBe('15');
      // The faded house number: empty, with a note.
      expect(await entries.nth(2).getByTestId('entry-house').inputValue()).toBe('');
      expect(await entries.nth(2).getByTestId('illegible').textContent()).toBe('House number: could not be read (the house number is faded)');
      // Everything is marked "read by AI" until checked.
      expect(await entries.nth(1).locator('[data-testid="ai-mark"]:visible').count()).toBeGreaterThan(5);
      // The scan is beside the entries.
      await expect.poll(() => page.getByTestId('scan-image').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

      // The known father: Jan Novák, suggested first with the reasons, linked with one tap.
      const father = entries.nth(0).locator('[data-testid="read-person"][data-key="p2"]');
      const jan = father.getByTestId('match').first();
      expect(await jan.getAttribute('data-id')).toBe(L.janNovak);
      expect(await jan.textContent()).toMatch(/Jan Novák.*name · House · years fit · Place · family/);
      if (SCREENSHOT && name === 'phone') {
        await mkdir(SCREENSHOT.replace(/\/[^/]+$/, ''), { recursive: true });
        await father.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: SCREENSHOT, scale: 'css' });
      }
      await jan.click();
      expect(await jan.getAttribute('aria-pressed')).toBe('true');
      // Everyone else is a new Person, by choice.
      const unchosen = page.locator('[data-testid="read-person"]:not([data-key="p2"])');
      for (let i = 0; i < (await unchosen.count()); i++) await unchosen.nth(i).getByTestId('match-new').click();

      // A misread surname is corrected, and the entry confirmed (scenario "Member confirms").
      const second = entries.nth(1);
      const surname = second.locator('[data-testid="read-person"][data-key="p7"]').getByTestId('person-surname');
      await surname.fill('Dvořák');
      expect(
        await second.locator('[data-testid="read-person"][data-key="p7"] label:has([data-testid="person-surname"]) [data-testid="ai-mark"]').isHidden(),
      ).toBe(true);
      await second.getByTestId('confirm-entry').click();
      expect(await second.locator('[data-testid="ai-mark"]:visible').count()).toBe(0);
      expect(await second.getByTestId('entry-transcription').textContent()).toContain('Wenceslai Dworzak');

      await page.getByTestId('submit').click();
      await page.waitForURL(/#work\/mine\//, { timeout: 15_000 });
      const proposalId = page.url().split('/').at(-1)!;
      const p = ProposalView.parse((await inject(member, 'GET', `/api/proposals/${proposalId}`)).json());
      expect(p.status).toBe('pending');
      const ops = p.operations.map((o) => Operation.parse(o.operation));
      expect(ops.filter((o) => o.op === 'createEvent')).toHaveLength(3);
      expect(ops).toContainEqual(expect.objectContaining({ op: 'addRole', personId: L.janNovak, role: 'father' }));
      expect(ops.find((o) => o.op === 'createCitation')).toMatchObject({ confidence: 'normal', page: '41' });
      expect(ops.find((o) => o.op === 'createEvent')).toMatchObject({ houseId: L.houseA, date: '1830-03-14' });
      const corrected = ops.find((o) => o.op === 'createPerson' && o.tempId === 'tmp:p7')!;
      expect(corrected).toMatchObject({ name: { given: 'Wenceslaus', surname: 'Dvořák', asFound: 'Wenceslai Dworzak', type: 'latin' } });
      const marked = new Map(p.reader!.marks.map((m) => [m.position, m.fields]));
      const position = (match: (o: Operation) => boolean) => ops.findIndex(match);
      expect(marked.get(position((o) => o.op === 'createPerson' && o.tempId === 'tmp:p7'))).toBeUndefined();
      expect(marked.get(position((o) => o.op === 'createEvent' && o.tempId === 'tmp:e2'))).toBeUndefined();
      expect(marked.get(position((o) => o.op === 'createEvent' && o.tempId === 'tmp:e1'))).toEqual(['date', 'type']);
      expect(p.reader!.readingIds).toHaveLength(1);

      if (name === 'phone') {
        // The Editor sees the marks in the review queue.
        const review = await open(device, editor);
        await review.page.goto(`${origin}/#work/review`);
        const card = review.page.locator(`[data-testid="proposal"][data-id="${proposalId}"]`);
        await card.waitFor();
        expect(await card.getByTestId('ai-mark').count()).toBeGreaterThan(10);
        expect(review.violations).toEqual([]);
      }
      expect(violations).toEqual([]);
      // The browser never talked to the reading service: off the app's origin, only to the image host and the map's tile hosts.
      expect(offOrigin.filter((u) => u.includes('anthropic'))).toEqual([]);
      expect(offOrigin.filter((u) => !u.startsWith(`${imageOrigin}/`) && !MAP_HOSTS.some((m) => u.startsWith(m)))).toEqual([]);
    }, 90_000);
  }

  it('phone: while switched off, "Read a scan" is not offered; at the daily limit it is refused and the forms by hand remain (scenarios "Switched off", "Daily limit")', async () => {
    const member = await createMember(t.db, 'contributor', { displayName: 'Karel Limits', language: 'en' });
    await setSwitch(false);
    const { page, violations } = await open(DEVICES.phone, member);
    await page.goto(`${origin}/#work/propose`);
    await page.getByTestId('kind-baptism').waitFor({ timeout: 10_000 });
    expect(await page.getByTestId('kind-read').count()).toBe(0);
    await page.evaluate(() => (location.hash = '#work/read'));
    await expect.poll(() => page.evaluate(() => location.hash), { timeout: 10_000 }).toBe('#work/propose');

    await setSwitch(true, 1);
    // One reading already today: the limit of one is used.
    await t.db
      .insertInto('reading')
      .values({
        author_id: member.id,
        upload_ids: [L.pageImage],
        crops: '[]',
        context: '{}',
        day: readingDay(clock),
        status: 'failed',
        error_code: 'x',
        error_message: 'x',
      })
      .execute();
    // Switched on again: the Propose flow offers it (the screen is drawn anew).
    await page.reload();
    await page.getByTestId('kind-read').click({ timeout: 10_000 });
    await page.getByTestId('read-start').waitFor({ timeout: 10_000 });
    expect(await page.getByTestId('read-left').textContent()).toBe('You can have 0 of 1 readings made today.');
    expect(await page.getByTestId('read').isDisabled()).toBe(true);
    await page.evaluate(() => (location.hash = '#work/propose'));
    await page.getByTestId('kind-baptism').waitFor({ timeout: 10_000 });
    expect(await page.getByTestId('kind-baptism').isVisible()).toBe(true);
    expect(violations).toEqual([]);
  });

  it('phone: an archive viewer address instead of an image asks for the image itself (scenario "Portal link")', async () => {
    await setSwitch(true);
    const member = await createMember(t.db, 'contributor', { displayName: 'Karel Link', language: 'en' });
    const { page } = await open(DEVICES.phone, member);
    await page.goto(`${origin}/#work/read`);
    await page.getByTestId('read-start').waitFor();
    await page.getByTestId('read-link').fill('https://portal.example-archive.test/matriky/view?frame=41');
    expect(await page.getByTestId('link-note').isVisible()).toBe(true);
    await page.getByTestId('read').click();
    expect(await page.getByTestId('read-status').textContent()).toBe(
      'This is a link to an archive viewer, not an image. Save the page as an image or take a photo of it, and add that; the link is kept as the Citation’s link.',
    );
  });
});
