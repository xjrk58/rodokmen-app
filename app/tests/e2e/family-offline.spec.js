// add-family-view task 4.1 (family-view spec, "Family data offline"): the Tree data a Member
// loaded stays readable offline with "as of" and the time it was loaded. Runs the service worker
// against its own server, which the test then stops (airplane mode).
import { member, mockFamilyApi } from './family-api.js';
import { P } from './family-data.js';
import { APP_DIR } from './data.js';
import { expect, test } from './fixtures.js';
import { serve, waitForServiceWorker } from './sw-helpers.js';

test.use({ serviceWorkers: 'allow', timezoneId: 'Europe/Prague' });

test('reading room without signal: a person page viewed yesterday opens offline with "as of" and yesterday’s time', async ({ page, context }) => {
  await mockFamilyApi(context, { me: member('contributor', { person: 10 }) });
  const server = await serve(APP_DIR);
  try {
    // Yesterday, online: the Member opens the app and Jan's page.
    await page.clock.setFixedTime(new Date('2026-10-29T14:05:00+01:00'));
    await page.goto(server.url);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await waitForServiceWorker(page);
    await page.goto(`${server.url}#people/${P.jan}`);
    await expect(page.getByTestId('person-title')).toHaveText('Jan Novák');
    await expect(page.getByTestId('person-event')).not.toHaveCount(0);
    await expect(page.getByTestId('as-of')).toHaveCount(0);
    // The tree too.
    await page.goto(`${server.url}#person-${P.jan}`);
    await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.jan);
  } finally {
    await server.close();
  }

  // Today, in airplane mode: the server is gone and every request fails.
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  await context.route('**/*', (route) => route.abort('internetdisconnected'));
  await context.setOffline(true);
  await page.clock.setFixedTime(new Date('2026-10-30T09:30:00+01:00'));
  await page.goto('about:blank');
  await page.goto(`${server.url}#people/${P.jan}`);
  await expect(page.getByTestId('person-title')).toHaveText('Jan Novák');
  await expect(page.getByTestId('person-event')).not.toHaveCount(0);
  await expect(page.getByTestId('as-of')).toHaveText('As of Oct 29, 2026, 2:05 PM (saved on this device)');
  // Still signed in on this device, with the tabs; the tree viewed yesterday opens too.
  await page.getByTestId('tabbar-tree').click();
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.jan);
  await expect(page.getByTestId('as-of')).toBeVisible();
  // A page never viewed says that it needs a connection.
  await page.goto(`${server.url}#people/${P.antonin}`);
  await expect(page.getByTestId('screen-error')).toHaveText('No connection. Only what this device saved earlier can be shown.');
});
