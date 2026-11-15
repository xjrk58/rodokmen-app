import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { recomputeRelations } from '../src/tree/relation.js';
import { VIEWPORTS, type Size } from './browser.js';
import { createMember, ensureOwner, signIn } from './helpers.js';
import { startLiveServer, type LiveServer } from './live-server.js';

/**
 * Charts end to end (tree-charts spec; add-tree-charts task 10.1): the real server, the fixture
 * Tree with a fixed clock, and the app in Chromium at phone (390 px) and desktop (1280 px) size,
 * under the app's Content-Security-Policy. A Descendant chart from a person page, its line form to
 * the Member's own Person, a House chart from an Event, printing to PDF, both downloads, branches,
 * a shared link, and Living people on a Sheet. With FAMILY_SCREENSHOTS set to a folder, it saves
 * screenshots of the Charts there.
 */
const L = generateFixture().landmarks;
const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'vendor', 'fonts');
const SHOTS = process.env.FAMILY_SCREENSHOTS;

declare global {
  interface Window {
    reportCspViolation?: (v: string) => Promise<void>;
  }
}

/** The fonts' rules of a downloaded SVG, replaced by a mark: the golden files leave out the fonts' bytes. */
const withoutFonts = (svg: string) => svg.replace(/<style>[^<]*<\/style>/, '<style>/*FONTS*/</style>');

/** The pages of a PDF from Chromium. */
const pdfPages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

describe('Charts in the app (Chromium, phone and desktop, fixture Tree)', () => {
  let server: LiveServer;
  let browser: Browser;
  let member: Account;
  let other: Account;
  const contexts: BrowserContext[] = [];
  const violations: string[] = [];
  /** The SVG downloads of one Chart, at each size. */
  const downloads: string[] = [];

  async function open(who: Account, size: Size, hash: string, o: { language?: 'cs' | 'en' } = {}): Promise<Page> {
    const context = await browser.newContext({ ...VIEWPORTS[size], locale: 'cs-CZ', serviceWorkers: 'block', acceptDownloads: true });
    contexts.push(context);
    await context.exposeBinding('reportCspViolation', (_source, v: string) => void violations.push(v));
    await context.addInitScript((lang) => {
      document.addEventListener('securitypolicyviolation', (e) => void window.reportCspViolation?.(`${e.effectiveDirective} ${e.blockedURI} ${e.sample}`));
      // Printing opens the browser's dialog; here the test makes the PDF itself.
      window.print = () => undefined;
      try {
        if (lang) localStorage.setItem('rodokmen.language', lang);
      } catch {
        // about:blank has no storage
      }
    }, o.language ?? 'cs');
    await context.route(
      (url) => !url.href.startsWith(server.origin),
      (route) => route.fulfill({ status: 404, body: '' }),
    );
    const cookie = (await signIn(server.t.db, server.clock, who)).split('=')[1]!;
    await context.addCookies([{ name: 'rdk_session', value: cookie, url: server.origin }]);
    const page = await context.newPage();
    if (process.env.CHART_DEBUG) page.on('pageerror', (e) => console.error('pageerror', e.message));
    if (process.env.CHART_DEBUG) page.on('console', (m) => console.error('console', m.type(), m.text()));
    await page.goto(`${server.origin}/${hash}`);
    return page;
  }

  async function shot(page: Page, name: string) {
    if (!SHOTS) return;
    await mkdir(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${name}.png`), animations: 'disabled' });
  }

  async function downloadOf(page: Page, testid: string): Promise<Buffer> {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId(testid).click()]);
    return readFileSync(await download.path());
  }

  const chartOf = (start: string, query = '') => `#chart/descendants/person/${start}${query ? `?${query}` : ''}`;

  beforeAll(async () => {
    server = await startLiveServer();
    server.clock.current = new Date('2026-11-14T09:00:00Z');
    await server.t.db.insertInto('family_root').values({ person_id: L.founder }).execute();
    await server.t.db.transaction().execute((tx) => recomputeRelations(tx));
    await ensureOwner(server.t.db);
    member = await createMember(server.t.db, 'contributor');
    other = await createMember(server.t.db, 'editor');
    // The Member's own Person: the proband, a descendant of the founders.
    await server.t.db.updateTable('account').set({ person_id: L.proband }).where('id', '=', member.id).execute();
    browser = await chromium.launch();
  });
  afterAll(async () => {
    for (const c of contexts) await c.close().catch(() => undefined);
    await browser?.close();
    await server?.close();
  });

  for (const size of ['phone', 'desktop'] as const) {
    describe(`at ${size} size`, () => {
      it('"On a phone": a Descendant chart from a person page, with readable names, and a tap opens the person page', async () => {
        const page = await open(member, size, `#people/${L.janNovak}`);
        await page.getByTestId('open-chart').click();
        await expect.poll(() => page.url()).toContain(`#chart/descendants/person/${L.janNovak}`);
        const chart = page.getByTestId('chart');
        await chart.locator(`[data-person="${L.janNovak}"]`).first().waitFor();
        // Names at 9 pixels or more: the view's scale times the name size of 32 tenths of a millimetre.
        const style = (await page.locator('.chart-view').getAttribute('style')) ?? '';
        const scale = Number(/scale\(([\d.]+)\)/.exec(style)?.[1] ?? '0');
        expect(scale * 32).toBeGreaterThanOrEqual(9);
        // The top of the Chart is on screen.
        const first = await chart.locator(`[data-card="person"][data-person="${L.janNovak}"]`).boundingBox();
        expect(first).not.toBeNull();
        expect(first!.x).toBeGreaterThanOrEqual(-1);
        expect(first!.x + first!.width).toBeLessThanOrEqual(VIEWPORTS[size].viewport.width + 1);
        await shot(page, `chart-descendants-${size}`);
        await chart.locator(`[data-card="person"][data-person="${L.janNovak}"]`).click();
        await expect.poll(() => page.url()).toContain(`#people/${L.janNovak}`);
      });

      it("the Direct line: the Member's own Person offered first, and the line form down to them", async () => {
        const page = await open(member, size, chartOf(L.founder));
        await page.getByTestId('chart-options').locator('summary').click();
        const offered = page.getByTestId('line-picker').locator('option');
        expect(await offered.nth(1).getAttribute('value')).toBe(L.proband);
        await page.getByTestId('line-picker').selectOption(L.proband);
        await expect.poll(() => page.url()).toContain(`line=${L.proband}`);
        await page.getByTestId('form-line').check();
        await expect.poll(() => page.url()).toContain('form=line');
        await expect.poll(() => page.getByTestId('chart').locator(`[data-key="line:${L.proband}"]`).count()).toBe(1);
        await expect.poll(() => page.getByTestId('chart').locator('[data-line="true"]').count()).toBe(6);
        await shot(page, `chart-line-${size}`);
      });

      it('"Opening a branch": the mark under a Person whose descendants are left out opens a Chart from them, with the same options', async () => {
        const page = await open(member, size, chartOf(L.largeFounder, 'generations=6'));
        await page.getByTestId('chart-cut').waitFor();
        // The whole Chart in view, then the mark under one of the last generation.
        await page.getByTestId('zoom-fit').click();
        const branch = page.getByTestId('chart').locator('[data-branch="true"]').first();
        const id = await branch.getAttribute('data-person');
        const box = (await branch.boundingBox())!;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await expect.poll(() => page.url()).toContain(`#chart/descendants/person/${id}?generations=6`);
      });

      it('a House chart from an Event at the House, and "Shared link": another Member opens the same Chart', async () => {
        const page = await open(member, size, `#people/${L.janNovak}`);
        await page.getByTestId('house-chart').first().click();
        await expect.poll(() => page.url()).toContain(`#chart/house/${L.houseA}`);
        await page.getByTestId('chart-options').locator('summary').click();
        await page.getByTestId('chart-unrelated').check();
        await expect.poll(() => page.url()).toContain('unrelated=1');
        const model = (
          await server.app.inject({
            method: 'GET',
            url: `/api/charts/house/${L.houseA}?unrelated=true`,
            headers: { cookie: await signIn(server.t.db, server.clock, member) },
          })
        ).json<{ rows: unknown[] }>();
        const rows = model.rows.length;
        expect(rows).toBeGreaterThan(5);
        await expect.poll(() => page.getByTestId('chart').locator('[data-key^="period:"]').count()).toBe(rows);
        await shot(page, `chart-house-${size}`);
        const theirs = await open(other, size, `#chart/house/${L.houseA}?unrelated=1`);
        await expect.poll(() => theirs.getByTestId('chart-title').textContent()).toBe((await page.getByTestId('chart-title').textContent())!);
        await expect.poll(() => theirs.getByTestId('chart').locator('[data-key^="period:"]').count()).toBe(rows);
      });

      it('"One A3 page" and "Split into pages": print to PDF', async () => {
        // A family of 4 generations: Antonín's, who adopted Marie. (The spec's family of 60 Persons
        // still takes 3 A3 pages: see app/tests/unit/chart-layout.test.mjs and #178.)
        const small = (
          await server.app.inject({
            method: 'GET',
            url: `/api/charts/descendants?family=${L.adoptedAdoptiveFamily}`,
            headers: { cookie: await signIn(server.t.db, server.clock, member) },
          })
        ).json<{ persons: unknown[]; shown: number }>();
        expect(small.shown).toBe(4);
        expect(small.persons.length).toBe(26);
        const page = await open(member, size, `#chart/descendants/family/${L.adoptedAdoptiveFamily}`);
        await page.getByTestId('chart').locator('[data-card]').first().waitFor();
        await page.locator('[data-testid="chart-screen"][data-sheet-ready="true"]').waitFor();
        await page.getByTestId('chart-print').click();
        await expect.poll(() => page.getByTestId('print-page').count()).toBe(1);
        await page.emulateMedia({ media: 'print' });
        expect(pdfPages(await page.pdf({ preferCSSPageSize: true, printBackground: true }))).toBe(1);

        const large = await open(member, size, chartOf(L.largeFounder, 'generations=6&paper=a4-portrait'));
        await large.getByTestId('chart').locator('[data-card]').first().waitFor();
        await large.locator('[data-testid="chart-screen"][data-sheet-ready="true"]').waitFor();
        await large.getByTestId('chart-print').click();
        const pages = await large.getByTestId('print-page').count();
        expect(pages).toBeGreaterThan(1);
        // Each branch moved to a later page leaves its number where it leaves.
        const stubs = await large.locator('#chart-print-root [data-card="stub"]').allTextContents();
        expect(stubs.length).toBe(pages - 1);
        for (const s of stubs) expect(s).toMatch(/pokračuje na listu \d+/);
        await expect.poll(() => large.locator('#chart-print-root [data-sheet="1"]').textContent()).toContain('list 1 z');
        await large.emulateMedia({ media: 'print' });
        const pdf = await large.pdf({ preferCSSPageSize: true, printBackground: true });
        if (process.env.CHART_PDF) writeFileSync(process.env.CHART_PDF, pdf);
        expect(pdfPages(pdf)).toBe(pages);
      });

      it('"Two devices" and "SVG in another program": the SVG download, the same on every device, carrying its fonts', async () => {
        const page = await open(member, size, chartOf(L.janNovak, 'generations=6'));
        await page.getByTestId('chart').locator('[data-card]').first().waitFor();
        const svg = (await downloadOf(page, 'chart-svg')).toString('utf8');
        // "Two devices": the file at phone size and at desktop size, byte for byte the same. (The golden
        // SVG files of invented Charts are in app/tests/unit/golden/charts/; the fixture's generated
        // names stay out of the repo's files.)
        downloads.push(svg);
        if (downloads.length === 2) expect(downloads[1]).toBe(downloads[0]);
        // The fonts inside, as data: WOFF2, byte for byte the vendored files.
        for (const file of ['eb-garamond/eb-garamond-latin-400-normal.woff2', 'grenze-gotisch/grenze-gotisch-latin-ext-400-normal.woff2']) {
          expect(svg).toContain(readFileSync(join(FONT_DIR, file)).toString('base64'));
        }
        // Opened where the fonts are not installed and cannot be fetched, it shows EB Garamond from inside the file.
        const viewer = await browser.newContext();
        contexts.push(viewer);
        await viewer.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
        const view = await viewer.newPage();
        await view.setContent(svg.replace(/^<\?xml[^>]*>\n/, ''), { waitUntil: 'load' });
        expect(await view.evaluate(async () => (await document.fonts.load('32px "EB Garamond"')).length)).toBeGreaterThan(0);
        expect(await view.evaluate(() => document.fonts.check('32px "EB Garamond"'))).toBe(true);
      });

      it('"Switched on" and "Printing" (add-kinship 8.2): kinship on the cards on screen, and the same SVG file with it on and off', async () => {
        const page = await open(member, size, chartOf(L.founder, `form=line&line=${L.proband}`));
        const own = page.getByTestId('chart').locator(`[data-key="line:${L.proband}"]`);
        await own.waitFor();
        const off = (await downloadOf(page, 'chart-svg')).toString('utf8');
        await page.getByTestId('chart-options').locator('summary').click();
        await page.getByTestId('chart-kinship').check();
        await expect.poll(() => own.textContent()).toContain('vy');
        const founder = page.getByTestId('chart').locator(`[data-key="line:${L.founder}"]`);
        await expect.poll(() => founder.textContent()).toMatch(/pra\S*děd/);
        await shot(page, `chart-kinship-${size}`);
        expect(page.url()).not.toContain('kinship');
        const on = (await downloadOf(page, 'chart-svg')).toString('utf8');
        expect(on === off).toBe(true);
        expect(on).not.toMatch(/>vy<|pra\S*děd/);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      });

      it('a PNG within the canvas limits', async () => {
        const page = await open(member, size, chartOf(L.janNovak));
        await page.getByTestId('chart').locator('[data-card]').first().waitFor();
        const png = await downloadOf(page, 'chart-png');
        expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
        const width = png.readUInt32BE(16);
        const height = png.readUInt32BE(20);
        expect(Math.max(width, height)).toBeLessThanOrEqual(8192);
        expect(width * height).toBeLessThanOrEqual(16_000_000);
      });

      it('"Living grandchild", "Names left off" and "On screen": Living people on a Sheet and on screen', { timeout: 90_000 }, async () => {
        const page = await open(member, size, chartOf(L.founder, 'generations=8'));
        await page.getByTestId('chart').locator('[data-card]').first().waitFor();
        const svg = withoutFonts((await downloadOf(page, 'chart-svg')).toString('utf8'));
        const screen = (
          await server.app.inject({
            method: 'GET',
            url: `/api/charts/descendants?person=${L.founder}&generations=8`,
            headers: { cookie: await signIn(server.t.db, server.clock, member) },
          })
        ).json<{
          persons: Array<{ id: string; given: string; surname: string; living: boolean; born: { date: string | null; place: string | null } | null }>;
        }>();
        const living = screen.persons.filter((p) => p.living && p.born?.date);
        expect(living.length).toBeGreaterThan(0);
        for (const p of living) {
          // On a Sheet: the name and the year only, no day and no Place.
          const card = new RegExp(`<g data-card="person" data-key="${p.id}"[^>]*>(.*?)</g>`).exec(svg)?.[1] ?? '';
          expect(card).toContain(`>${p.given} ${p.surname}<`);
          expect(card).toContain(`>${p.born!.date!.slice(0, 4)}<`);
          if (p.born!.place) expect(card).not.toContain(p.born!.place);
          expect(card).not.toMatch(/\d+\. \p{L}+ \d{4}/u);
        }
        // On screen: the full birth date, marked as Living.
        const card = page.getByTestId('chart').locator(`[data-card="person"][data-person="${living[0]!.id}"]`);
        await expect.poll(() => card.textContent()).toContain('žijící');
        // Without names: each Living person a card that says only that they are living.
        await page.getByTestId('chart-options').locator('summary').click();
        await page.getByTestId('living-nameless').check();
        await expect.poll(() => page.url()).toContain('living=nameless');
        await page.getByTestId('chart').locator('[data-card]').first().waitFor();
        const nameless = withoutFonts((await downloadOf(page, 'chart-svg')).toString('utf8'));
        for (const p of living) {
          const card = new RegExp(`<g data-card="person" data-key="${p.id}"[^>]*>(.*?)</g>`).exec(nameless)?.[1] ?? '';
          expect(card).not.toContain(p.given);
          expect(card).toContain('žijící osoba');
        }
        expect(nameless).toContain('žijící osoba');
      });
    });
  }

  it('the Charts break no rule of the Content-Security-Policy', () => {
    expect(violations).toEqual([]);
  });
});
