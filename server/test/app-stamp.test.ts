import { execFile } from 'node:child_process';
import { appendFile, cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_APP_DIR, pageRoutes } from '../src/routes/pages.js';

/**
 * The app's version stamp as the server sends it (#91): a checkout's app/ carries a placeholder,
 * which the server replaces with the version of the files as they are; a built site (the image's
 * /srv/app) was stamped when it was built and goes out as it is.
 */
const VERSION = /const VERSION = '([^']*)';/;
const APP_VERSION = /export const APP_VERSION = '([^']*)';/;
const STAMP = /^\d+\.\d+\.\d+\+[0-9a-f]{10}$/;

async function serve(appDir: string) {
  const app = Fastify();
  await app.register(pageRoutes, { appDir, imageOrigin: 'https://files.example', log: () => {} });
  return app;
}

/** The stamps in sw.js and src/version.js as the server sends them. */
async function served(app: Awaited<ReturnType<typeof serve>>): Promise<[string | undefined, string | undefined]> {
  const sw = await app.inject({ method: 'GET', url: '/sw.js' });
  const version = await app.inject({ method: 'GET', url: '/src/version.js' });
  expect(sw.statusCode).toBe(200);
  expect(version.statusCode).toBe(200);
  for (const res of [sw, version]) expect(res.headers['content-type']).toMatch(/^(text|application)\/javascript/);
  return [VERSION.exec(sw.body)?.[1], APP_VERSION.exec(version.body)?.[1]];
}

describe("the app's version stamp, as the server sends it", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'app-stamp-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("a checkout's app/ goes out stamped, both files alike, as the built site would be", async () => {
    expect(VERSION.exec(await readFile(join(DEFAULT_APP_DIR, 'sw.js'), 'utf8'))?.[1]).toBe('unstamped');
    const app = await serve(DEFAULT_APP_DIR);
    const [sw, version] = await served(app);
    expect(sw).toMatch(STAMP);
    expect(version).toBe(sw);
    expect((await app.inject({ method: 'GET', url: '/sw.js' })).headers['cache-control']).toBe('no-cache');
    await app.close();

    // The built site, as the Docker image and the Pages preview make it, carries the same stamp.
    const site = join(dir, 'site');
    await promisify(execFile)(process.execPath, [join(DEFAULT_APP_DIR, 'scripts', 'site-files.mjs'), '--copy', site]);
    expect(VERSION.exec(await readFile(join(site, 'sw.js'), 'utf8'))?.[1]).toBe(sw);
  });

  it('a built site goes out as it is', async () => {
    const site = join(dir, 'site');
    const stamp = VERSION.exec(await readFile(join(site, 'sw.js'), 'utf8'))?.[1];
    const app = await serve(site);
    expect(await served(app)).toEqual([stamp, stamp]);
    await app.close();
  });

  it('in a checkout, a changed app file gives a new stamp at once', async () => {
    const checkout = join(dir, 'checkout');
    await cp(DEFAULT_APP_DIR, checkout, { recursive: true, filter: (src) => !['node_modules', 'test-results', 'playwright-report'].includes(basename(src)) });
    const app = await serve(checkout);
    const [before] = await served(app);
    await appendFile(join(checkout, 'styles.css'), '\n/* changed */\n');
    const [after, version] = await served(app);
    expect(after).toMatch(STAMP);
    expect(after).not.toBe(before);
    expect(version).toBe(after);
    await app.close();
  });
});
