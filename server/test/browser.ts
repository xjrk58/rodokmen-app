import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { RodokmenApp } from '../src/app.js';
import type { Account } from '../src/db/types.js';
import type { MemoryImageStorage } from '../src/storage/images.js';
import type { TestDatabase } from './db.js';
import { signIn, type TestClock } from './helpers.js';
import { startLiveServer } from './live-server.js';

/** The two sizes every screen is checked at: a phone (390 × 844) and a desktop (1280 × 800). */
export const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
} as const;
export type Size = keyof typeof VIEWPORTS;

/**
 * The real server on a free port, with the fixture Tree and the app, and Chromium to drive it,
 * for the browser tests (Vitest + Playwright). With AGENT_SCREENSHOT_DIR set, screenshots go there.
 */
export interface BrowserWorld {
  t: TestDatabase;
  app: RodokmenApp;
  origin: string;
  clock: TestClock;
  images: MemoryImageStorage;
  /** A page signed in as this Member, at this size, opened at the app address `hash`. */
  open(member: Account, size: Size, hash: string, locale?: string): Promise<Page>;
  screenshot(page: Page, name: string): Promise<void>;
  close(): Promise<void>;
}

export async function startBrowserWorld(): Promise<BrowserWorld> {
  const server = await startLiveServer();
  const { t, app, origin, clock, images } = server;
  const browser: Browser = await chromium.launch();
  const contexts: BrowserContext[] = [];
  return {
    t,
    app,
    origin,
    clock,
    images,
    async open(member, size, hash, locale = 'en-GB') {
      const context = await browser.newContext({ ...VIEWPORTS[size], locale, serviceWorkers: 'block' });
      contexts.push(context);
      await context.route(
        (url) => !url.href.startsWith(origin),
        (route) => route.fulfill({ status: 404, body: '' }),
      );
      const cookie = (await signIn(t.db, clock, member)).split('=')[1]!;
      await context.addCookies([{ name: 'rdk_session', value: cookie, url: origin }]);
      const page = await context.newPage();
      await page.goto(`${origin}/${hash}`);
      return page;
    },
    async screenshot(page, name) {
      const dir = process.env.AGENT_SCREENSHOT_DIR;
      if (!dir) return;
      await mkdir(dir, { recursive: true });
      await page.screenshot({ path: join(dir, `${name}.png`), scale: 'css', fullPage: true });
    },
    async close() {
      for (const c of contexts) await c.close().catch(() => undefined);
      await browser.close();
      await server.close();
    },
  };
}
