import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { buffer } from 'node:stream/consumers';
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from 'playwright';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type RodokmenApp } from '../src/app.js';
import { OutboxMailer } from '../src/mail/mailer.js';
import { DEFAULT_APP_DIR } from '../src/routes/pages.js';
import { MemoryImageStorage } from '../src/storage/images.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, freePort, portOf, signIn, TestClock, testConfig, tokenFromEmail } from './helpers.js';

/**
 * The app under its Content-Security-Policy (issue #52), against the real server in Chromium at
 * phone and desktop size: the map with its tiles and an overlay, passkey sign-in with a virtual
 * authenticator, a photo added to a Proposal, uploaded and shown in review, all without a
 * single violation reported; and injected inline script and style do nothing.
 *
 * OpenStreetMap's tiles and the CENIA overlays are mocked in the browser; anything else off the
 * app's origin is refused and fails the test. The image host is a small server of its own on
 * another origin (127.0.0.1 rather than localhost), standing in for files.<domain>: it serves
 * and stores the in-memory bucket, with the CORS answers Caddy gives. (A browser mock would
 * not do: Playwright does not intercept the redirect from /api/uploads/… to the image.)
 */
const BUCKET_PATH = '/rodokmen-images-test/';
const OSM = 'https://tile.openstreetmap.org';
const CENIA = 'https://geoportal.gov.cz';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const DEVICES: Record<'phone' | 'desktop', BrowserContextOptions> = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 } },
};

interface Violation {
  directive: string;
  blocked: string;
  sample: string;
}

declare global {
  interface Window {
    /** Exposed by the test to each page: reports a violation of the policy. */
    reportViolation?: (v: Violation) => Promise<void>;
    /** Set only if an injected script ran. */
    injected?: string;
  }
}

interface Session {
  context: BrowserContext;
  page: Page;
  /** Violations reported in the app's pages. */
  violations: Violation[];
  /** Requests to hosts other than the app's, with the Referer they carried. */
  requests: Array<{ method: string; url: string; referer: string | undefined }>;
}

async function tilePng(): Promise<Buffer> {
  return sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 200, g: 190, b: 170, alpha: 1 } } })
    .png()
    .toBuffer();
}

async function photo(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 233, g: 223, b: 199 } } })
    .jpeg()
    .toBuffer();
}

describe('the app under its Content-Security-Policy (Chromium, phone and desktop)', () => {
  let t: TestDatabase;
  let app: RodokmenApp;
  let browser: Browser;
  let origin: string;
  let imageOrigin: string;
  let imageServer: Server;
  /** Requests the image host answered, with the Referer they carried. */
  const imageRequests: Array<{ method: string; url: string; referer: string | undefined }> = [];
  let storage: MemoryImageStorage;
  let tile: Buffer;
  const clock = new TestClock(new Date());
  const mailer = new OutboxMailer();
  const contexts: BrowserContext[] = [];

  /** The image host: GET and PUT of the bucket's objects, with the CORS answers Caddy gives. */
  async function imageHost(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url!, imageOrigin);
    imageRequests.push({ method: req.method!, url: url.href, referer: req.headers.referer });
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

  async function open(device: BrowserContextOptions, options: { cookie?: string; serviceWorkers?: 'allow' | 'block' } = {}): Promise<Session> {
    const context = await browser.newContext({ ...device, locale: 'en-GB', serviceWorkers: options.serviceWorkers ?? 'block' });
    contexts.push(context);
    await context.addInitScript(() => localStorage.setItem('rodokmen.language', 'en'));
    const violations: Violation[] = [];
    const requests: Session['requests'] = [];
    await context.exposeBinding('reportViolation', (_source, v: Violation) => void violations.push(v));
    await context.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        void window.reportViolation?.({ directive: e.effectiveDirective, blocked: e.blockedURI, sample: e.sample });
      });
    });
    await context.route(
      (url) => !url.href.startsWith(origin),
      async (route) => {
        const request = route.request();
        const url = request.url();
        requests.push({ method: request.method(), url, referer: await request.headerValue('referer').then((v) => v ?? undefined) });
        if (url.startsWith(`${imageOrigin}/`)) return route.continue();
        if (url.startsWith(`${OSM}/`) || url.startsWith(`${CENIA}/`)) {
          return route.fulfill({ status: 200, contentType: 'image/png', body: tile, headers: { 'access-control-allow-origin': '*' } });
        }
        return route.abort('blockedbyclient');
      },
    );
    if (options.cookie) await context.addCookies([{ name: 'rdk_session', value: options.cookie.split('=')[1]!, url: origin }]);
    const page = await context.newPage();
    return { context, page, violations, requests };
  }

  /** Every request off the app's origin went to a host the policy allows (others are refused above). */
  function expectOnlyAllowedHosts(s: Session) {
    expect(s.requests.map((r) => new URL(r.url).origin).filter((o) => ![OSM, CENIA, imageOrigin].includes(o))).toEqual([]);
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    tile = await tilePng();
    const port = await freePort();
    origin = `http://localhost:${port}`;
    imageServer = createServer((req, res) => void imageHost(req, res).catch(() => res.writeHead(500).end()));
    await new Promise<void>((resolve) => imageServer.listen(0, '127.0.0.1', resolve));
    imageOrigin = `http://127.0.0.1:${portOf(imageServer.address())}`;
    storage = new MemoryImageStorage(clock, `${imageOrigin}${BUCKET_PATH}`);
    app = await buildApp({
      config: testConfig(t.url, { PUBLIC_ORIGIN: origin, APP_DIR: DEFAULT_APP_DIR, S3_PUBLIC_ENDPOINT: imageOrigin }),
      db: t.db,
      mailer,
      clock,
      images: storage,
    });
    await app.listen({ host: 'localhost', port });
    await ensureOwner(t.db);
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    for (const c of contexts) await c.close().catch(() => undefined);
    await browser?.close();
    await app?.close();
    await new Promise((resolve) => imageServer?.close(resolve));
    await t?.drop();
  });

  it('the policy allows the image host and the map hosts, and nothing inline', async () => {
    const res = await fetch(`${origin}/`);
    expect(res.headers.get('content-security-policy')).toBe(
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        `img-src 'self' data: blob: ${imageOrigin} ${OSM} ${CENIA}`,
        `connect-src 'self' ${imageOrigin} ${OSM} ${CENIA}`,
        "object-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    );
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  for (const [name, device] of Object.entries(DEVICES)) {
    describe(`${name} (${device.viewport!.width} × ${device.viewport!.height})`, () => {
      it('the map: base tiles carry only the origin as Referer, an overlay none, and the legend keeps its colours', async () => {
        const s = await open(device);
        await s.page.goto(`${origin}/#map=12/49.91/15.39`);
        await s.page.locator('body[data-ready="true"]').waitFor();
        await expect.poll(() => s.page.locator('.leaflet-tile-pane img.leaflet-tile-loaded').count()).toBeGreaterThan(0);

        await s.page.locator('#layers-button').click();
        await s.page.locator('input[data-overlay="survey2"]').check();
        await expect.poll(() => s.page.locator('.overlay-survey2 img.leaflet-tile-loaded').count()).toBeGreaterThan(0);
        // The legend's swatches are coloured through the DOM, which the policy allows.
        await s.page.locator('#regions-toggle').check();
        const swatch = s.page.getByTestId('legend').locator('.swatch').first();
        await expect.poll(() => swatch.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');

        const osm = s.requests.filter((r) => r.url.startsWith(OSM));
        const cenia = s.requests.filter((r) => r.url.startsWith(CENIA));
        expect(osm.length).toBeGreaterThan(0);
        expect(cenia.length).toBeGreaterThan(0);
        expect(new Set(osm.map((r) => r.referer))).toEqual(new Set([`${origin}/`]));
        expect(new Set(cenia.map((r) => r.referer))).toEqual(new Set([undefined]));
        expectOnlyAllowedHosts(s);
        expect(s.violations).toEqual([]);
      });

      it('passkey sign-in with a virtual authenticator', async () => {
        const email = `csp-${name}@example.test`;
        await createMember(t.db, 'contributor', { email, displayName: `Csp ${name}`, language: 'en' });
        const s = await open(device);
        const cdp = await s.context.newCDPSession(s.page);
        await cdp.send('WebAuthn.enable');
        await cdp.send('WebAuthn.addVirtualAuthenticator', {
          options: {
            protocol: 'ctap2',
            transport: 'internal',
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true,
          },
        });
        expect((await app.inject({ method: 'POST', url: '/api/auth/email-link', payload: { email } })).statusCode).toBe(202);
        await s.page.goto(`${origin}/#link/${tokenFromEmail(mailer.lastTo(email)!.text)}`);
        await s.page.getByTestId('link-sign-in').click();
        await s.page.getByTestId('register-passkey').click();
        await s.page.getByTestId('tree-start').waitFor();

        await s.context.clearCookies();
        await s.page.goto(`${origin}/#sign-in`);
        await s.page.reload();
        await s.page.getByTestId('passkey-sign-in').click();
        await s.page.getByTestId('tree-start').waitFor();
        expect(await s.page.evaluate(async () => (await fetch('/api/me')).status)).toBe(200);
        expectOnlyAllowedHosts(s);
        expect(s.violations).toEqual([]);
      }, 60_000);

      it('a photo added to a Proposal uploads to the image host and shows in review; a later upload to its link changes nothing', async () => {
        const author = await createMember(t.db, 'contributor', { displayName: `Author ${name}`, language: 'en' });
        const editor = await createMember(t.db, 'editor', { displayName: `Editor ${name}`, language: 'en' });
        const original = await photo(1200, 1600);
        const a = await open(device, { cookie: await signIn(t.db, clock, author) });
        await a.page.goto(`${origin}/#work/propose/death`);
        await a.page.getByTestId('person-new').click();
        await a.page.getByTestId('person-given').fill('Ludmila');
        await a.page.getByTestId('person-surname').fill(`Invented ${name}`);
        await a.page.getByTestId('source-title').fill('Invented burial register 1820–1840');
        await a.page.getByTestId('transcription').fill('Ludmilla, vidua, sepulta');
        await a.page.getByTestId('photo-input').setInputFiles({ name: 'grave.jpg', mimeType: 'image/jpeg', buffer: original });
        // The Draft shows its photo from a blob: URL before anything is uploaded.
        const thumb = a.page.getByTestId('photos').locator('img');
        await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => [img.src.slice(0, 5), img.naturalWidth > 0])).toEqual(['blob:', true]);
        await a.page.getByTestId('submit').click();
        await a.page.waitForURL(/#work\/mine\//, { timeout: 15_000 });
        const proposalId = a.page.url().split('/').at(-1)!;
        const put = imageRequests.find((r) => r.method === 'PUT' && r.url.includes('/pending/'));
        expect(put?.url.startsWith(`${imageOrigin}${BUCKET_PATH}pending/`)).toBe(true);
        expect(new URL(put!.url).pathname).toMatch(/\/original$/);
        expect(put?.referer).toBeUndefined();
        const uploadId = new URL(put!.url).pathname.split('/').at(-2)!;
        expect(sha(storage.objects.get(`pending/${uploadId}/verified`)!.body)).toBe(sha(original));
        expectOnlyAllowedHosts(a);
        expect(a.violations).toEqual([]);

        // The link is still valid: other bytes put there from the same page change nothing.
        const other = await photo(640, 480);
        const status = await a.page.evaluate(
          async ({ url, body }) => (await fetch(url, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: new Uint8Array(body) })).status,
          { url: put!.url, body: [...other] },
        );
        expect(status).toBe(200);
        expect(sha(storage.objects.get(`pending/${uploadId}/original`)!.body)).toBe(sha(other));

        const e = await open(device, { cookie: await signIn(t.db, clock, editor) });
        await e.page.goto(`${origin}/#work/review`);
        const card = e.page.locator(`[data-testid="proposal"][data-id="${proposalId}"]`);
        const image = card.getByTestId('citation-image');
        // Through /api/uploads/… and its redirect to the image host: the checked photo.
        await expect.poll(() => image.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([1200, 1600]);
        expect(imageRequests.some((r) => r.method === 'GET' && r.url.startsWith(`${imageOrigin}${BUCKET_PATH}pending/${uploadId}/display.webp?`))).toBe(true);
        const full = await app.inject({ method: 'GET', url: `/api/uploads/${uploadId}?full=true`, headers: { cookie: await signIn(t.db, clock, editor) } });
        expect(full.headers.location).toContain(`pending/${uploadId}/verified`);
        expectOnlyAllowedHosts(e);
        expect(e.violations).toEqual([]);
      }, 60_000);

      it('injected inline script, event handler and style are refused, and reported', async () => {
        const s = await open(device);
        await s.page.goto(`${origin}/`);
        await s.page.locator('body[data-ready="true"]').waitFor();
        const outcome = await s.page.evaluate(async () => {
          const script = document.createElement('script');
          script.textContent = 'window.injected = "script"';
          document.head.append(script);
          const holder = document.createElement('div');
          holder.innerHTML = `<img alt="" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" onload="window.injected = 'handler'">`;
          document.body.append(holder);
          const style = document.createElement('style');
          style.textContent = 'body { outline: 7px solid rgb(1, 2, 3) }';
          document.head.append(style);
          await new Promise((resolve) => setTimeout(resolve, 300));
          return { injected: window.injected ?? null, outline: getComputedStyle(document.body).outlineStyle };
        });
        expect(outcome).toEqual({ injected: null, outline: 'none' });
        await expect
          .poll(() => s.violations.map((v) => `${v.directive} ${v.blocked}`).sort())
          .toEqual(['script-src-attr inline', 'script-src-elem inline', 'style-src-elem inline']);
      });
    });
  }

  it('the service worker, under the same policy, fetches and keeps the base tiles', async () => {
    const s = await open(DEVICES.desktop, { serviceWorkers: 'allow' });
    await s.page.goto(`${origin}/#map=12/49.91/15.39`);
    await s.page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => s.page.evaluate(() => navigator.serviceWorker.controller?.state ?? 'none')).toBe('activated');
    expect((await fetch(`${origin}/sw.js`)).headers.get('content-security-policy')).toContain(`connect-src 'self' ${imageOrigin} ${OSM}`);
    s.requests.length = 0;
    await s.page.reload();
    await s.page.locator('body[data-ready="true"]').waitFor();
    await expect.poll(() => s.page.locator('.leaflet-tile-pane img.leaflet-tile-loaded').count()).toBeGreaterThan(0);
    const cached = () => s.page.evaluate(async () => (await (await caches.open('rodokmen-tiles')).keys()).length);
    await expect.poll(cached).toBeGreaterThan(0);
    // The worker passes each tile request on as the page made it, Referer included.
    expect(new Set(s.requests.filter((r) => r.url.startsWith(OSM)).map((r) => r.referer))).toEqual(new Set([`${origin}/`]));
    expectOnlyAllowedHosts(s);
    expect(s.violations).toEqual([]);
  }, 60_000);
});
