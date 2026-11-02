// add-family-view tasks 3.1–3.4 (family-map spec): family pins, grouped when zoomed out; the year
// range and decade play; a Person's life path; and "Family here" in the place sheet, also abroad.
// Against the mocked API and the invented Tree, at both viewports.
import { member, mockFamilyApi } from './family-api.js';
import { detail, P } from './family-data.js';
import { expect, test } from './fixtures.js';

/**
 * Opens the map tab at a view, signed in.
 * @param {import('@playwright/test').Page} page
 * @param {number} zoom
 * @param {number} lat
 * @param {number} lon
 */
async function familyMap(page, zoom, lat, lon) {
  const calls = await mockFamilyApi(page, { me: member('contributor', { person: 10 }) });
  await page.goto(`./#map=${zoom}/${lat}/${lon}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('year-filter')).toBeVisible();
  return calls;
}

test('zooming in: from the whole country, grouped pins split into one pin per Place or House', async ({ page }) => {
  await familyMap(page, 7, 49.6, 15.9);
  const cluster = page.getByTestId('family-cluster');
  await expect(cluster).toHaveCount(1);
  // Kamenná Lhota (the village and its House), Vrbice and Dolní Kamenec, grouped; the village abroad on its own.
  await expect(cluster).toHaveAttribute('title', /^4 places/);
  await cluster.click();
  await expect(page).toHaveURL(/#map=1[0-9]/);
  await page.goto('./#map=16/49.602/15.903');
  await expect(page.getByTestId('family-cluster')).toHaveCount(0);
  await expect(page.getByTitle(/^Kamenná Lhota čp\. 12:/)).toBeVisible();
  await expect(page.getByTitle(/^Kamenná Lhota:/)).toBeVisible();
});

test('one generation: with the range 1820–1850 only pins with Events in those years remain', async ({ page }) => {
  const calls = await familyMap(page, 11, 49.6, 15.9);
  await expect(page.getByTitle(/^Dolní Kamenec:/)).toBeVisible();
  await page.getByTestId('year-from').fill('1820');
  await page.getByTestId('year-to').fill('1850');
  await expect(page.getByTestId('year-range')).toHaveText('1820–1850');
  await expect(page.getByTitle(/^Dolní Kamenec:/)).toHaveCount(0);
  await expect(page.getByTitle(/^Vrbice:/)).toBeVisible();
  // The slider debounces: one request for the new range, not one per step.
  expect(calls.filter((c) => c.includes('from=1820&to=1850')).length).toBeLessThanOrEqual(2);
});

test('the play control steps through the decades, and stops when tapped again', async ({ page }) => {
  // The page's timers run on a clock the test can move on, so "no further step" needs no waiting.
  await page.clock.install();
  await familyMap(page, 11, 49.6, 15.9);
  await page.getByTestId('year-play').click();
  await expect(page.getByTestId('year-range')).toHaveText('1600–1609');
  await expect(page.getByTestId('year-range')).toHaveText('1610–1619', { timeout: 3000 });
  await page.getByTestId('year-play').click();
  await expect(page.getByTestId('year-play')).toHaveAttribute('aria-pressed', 'false');
  const stopped = await page.getByTestId('year-range').textContent();
  // Longer than a step of the play (1.2 s): had it not stopped, the range would move on.
  await page.clock.runFor(1500);
  await expect(page.getByTestId('year-range')).toHaveText(stopped ?? '');
});

test('moving between villages: the life path shows three labelled points joined in date order', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor', { person: 10 }) });
  await page.goto(`./#people/${P.antonin}`);
  await page.getByTestId('life-path').click();
  await expect(page.getByTestId('life-chip')).toContainText('Life path of Antonín Novák');
  await expect(page.locator('path.life-point')).toHaveCount(3);
  await expect(page.locator('path.life-line')).toHaveCount(1);
  await expect(page.locator('.life-label')).toHaveText(['1. Kamenná Lhota 1840', '2. Vrbice 1866', '3. Dolní Kamenec 1912']);
  await expect(page.getByTestId('tabbar-map')).toHaveAttribute('aria-current', 'page');
  // Closing it leaves the map.
  await page.getByTestId('life-chip').getByRole('button').click();
  await expect(page.locator('path.life-point')).toHaveCount(0);
});

test('tapping a family village: the place sheet lists its Persons with Events and years, next to the archive and map links', async ({ page }) => {
  await familyMap(page, 16, 49.6, 15.9);
  await page.getByTitle(/^Kamenná Lhota:/).click();
  const sheet = page.locator('#place-sheet');
  await expect(sheet.getByTestId('place-name')).toHaveText('Kamenná Lhota');
  const here = sheet.getByTestId('family-here');
  await expect(here).toContainText('Family here');
  const jan = here.getByTestId('here-person').filter({ hasText: 'Jan Novák' });
  await expect(jan).toContainText('baptism 1801');
  await expect(jan).toContainText('death 1850');
  await expect(here.getByTestId('here-person').filter({ hasText: 'Rozálie Svobodová' })).toContainText('baptism (Godparent) 1801');
  await expect(sheet.getByTestId('open-scans')).toBeVisible();
  await expect(sheet.getByTestId('historical')).toBeVisible();
  await jan.getByRole('link').click();
  await expect(page.getByTestId('person-screen')).toHaveAttribute('data-id', P.jan);
});

test('a line from abroad: a family pin in another country shows the family Events and says archive lookup covers only the Czech lands', async ({ page }) => {
  await familyMap(page, 12, 48.3, 16.2);
  await page.getByTitle(/^Lindenhof:/).click();
  const sheet = page.locator('#place-sheet');
  await expect(sheet.getByTestId('place-name')).toHaveText('Lindenhof');
  await expect(sheet.getByTestId('family-here')).toContainText('Anna Nováková');
  await expect(sheet.getByTestId('family-here')).toContainText('residence (Other) 1846');
  await expect(sheet.getByTestId('outside')).toHaveText('Archive lookup and historical maps cover only the Czech lands.');
  await expect(sheet.getByTestId('open-scans')).toHaveCount(0);
});

/**
 * Antonín's details with the Place of his first Event renamed.
 * @param {string} name
 */
function antoninWithPlaceNamed(name) {
  const antonin = detail(16);
  const place = antonin.events[0].event.place;
  if (!place) throw new Error('the first Event in the invented Tree has no Place');
  place.name = name;
  return antonin;
}

test('a Place name with markup in it shows as text on the life path', async ({ page }) => {
  const antonin = antoninWithPlaceNamed('<img src=x data-injected>');
  await mockFamilyApi(page, { me: member('contributor'), extra: { [`GET persons/${P.antonin}`]: () => ({ json: antonin }) } });
  await page.goto(`./#life/${P.antonin}`);
  await expect(page.locator('.life-label').first()).toHaveText('1. <img src=x data-injected> 1840');
  await expect(page.locator('[data-injected]')).toHaveCount(0);
});
