// Playwright runs the app from a local static server under /rodokmen-app/, the
// path GitHub Pages uses, in a phone and a desktop viewport.
//
// Each run starts its own server on a free port and stops it when the run ends,
// so runs from two checkouts at once never test each other's files (#143).
// PORT picks the port instead. To test a server that is already running, for
// debugging, set both PORT and REUSE_SERVER=1:
//   pnpm serve --port 4173 --base /rodokmen-app/
//   PORT=4173 REUSE_SERVER=1 pnpm test:e2e
import { createServer } from 'node:net';
import { defineConfig, devices } from '@playwright/test';

/** @returns {Promise<number>} a TCP port that nothing listens on right now */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
      server.close(() => resolve(port));
    });
  });
}

// The runner loads this file before it starts its workers, which load it again.
// They inherit the runner's environment, so they all use the port picked here.
process.env.PORT ??= String(await freePort());
const PORT = Number(process.env.PORT);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}/rodokmen-app/`,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, browserName: 'chromium' },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: `node scripts/serve.mjs --port ${PORT} --base /rodokmen-app/`,
    url: `http://127.0.0.1:${PORT}/rodokmen-app/`,
    // Never by default: a server already on the port may serve another checkout's files.
    reuseExistingServer: process.env.REUSE_SERVER === '1',
  },
});
