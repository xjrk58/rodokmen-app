// Playwright runs the app from a local static server under /rodokmen-app/, the
// path GitHub Pages uses, in a phone and a desktop viewport.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 4173);

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
    reuseExistingServer: !process.env.CI,
  },
});
