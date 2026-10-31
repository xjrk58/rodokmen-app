// add-family-view, the tree (family-tree spec) against the mocked API and the invented Tree,
// at both viewports: the home screen, the hourglass, changing the focus, the address, the
// Member's own Person and the marks.
import { member, mockFamilyApi } from './family-api.js';
import { P } from './family-data.js';
import { expect, openApp, test } from './fixtures.js';

const SHOTS = process.env.FAMILY_SCREENSHOTS;

/** @param {import('@playwright/test').Page} page @param {string} id */
const box = (page, id) => page.locator(`[data-testid="tree-person"][data-person="${id}"]`);
/** @param {import('@playwright/test').Page} page */
const focusOf = (page) => page.getByTestId('tree').getAttribute('data-focus');

test('opening the app: a signed-in Member sees the tree on their focus Person, and the map is one tab away', async ({ page }) => {
  await mockFamilyApi(page, { me: member('editor', { person: 10 }) });
  await openApp(page);
  await expect(page.getByTestId('tree')).toBeVisible();
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.jan);
  await expect(page).toHaveURL(new RegExp(`#person-${P.jan}$`));
  // Tabs: Tree, Map, People, Review (Editors) and Settings.
  for (const tab of ['tree', 'map', 'people', 'review', 'settings']) await expect(page.getByTestId(`tabbar-${tab}`)).toBeVisible();
  await expect(page.getByTestId('tabbar-tree')).toHaveAttribute('aria-current', 'page');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/mock-tree-${test.info().project.name}.png` });
  await page.getByTestId('tabbar-map').click();
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.getByTestId('tree')).toBeHidden();
  await expect(page.locator('#search-input')).toBeVisible();
  await expect(page.getByTestId('tabbar-map')).toHaveAttribute('aria-current', 'page');
});

test('a Contributor has no Review tab', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor', { person: 10 }) });
  await openApp(page);
  await expect(page.getByTestId('tree')).toBeVisible();
  await expect(page.getByTestId('tabbar-review')).toHaveCount(0);
  await expect(page.getByTestId('tabbar-settings')).toBeVisible();
});

test('a visitor who is not signed in still lands on the map, with no tabs and no family', async ({ page }) => {
  const calls = await mockFamilyApi(page, { me: null });
  await openApp(page);
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#search-input')).toBeVisible();
  await expect(page.getByTestId('tabbar')).toHaveCount(0);
  await expect(page.getByTestId('tree')).toHaveCount(0);
  await expect(page.getByTestId('year-filter')).toBeHidden();
  // Nothing about any Person was asked for.
  expect(calls.filter((c) => !c.startsWith('GET me'))).toEqual([]);
});

test('second marriage: both partners beside the focus Person, each with their own children below', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor') });
  await page.goto(`./#person-${P.jan}`);
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.jan);
  const jan = await box(page, P.jan).boundingBox();
  const first = await box(page, P.katerina).boundingBox();
  const second = await box(page, P.ludmila).boundingBox();
  const karel = await box(page, P.karel).boundingBox();
  const antonin = await box(page, P.antonin).boundingBox();
  if (!jan || !first || !second || !karel || !antonin) throw new Error('a box is missing');
  // Both partners in the focus row, one on each side; each Family's children below it, on its side.
  expect(Math.abs(first.y - jan.y)).toBeLessThan(2);
  expect(Math.abs(second.y - jan.y)).toBeLessThan(2);
  expect(first.x).toBeLessThan(jan.x);
  expect(second.x).toBeGreaterThan(jan.x);
  expect(karel.y).toBeGreaterThan(jan.y);
  expect(karel.x).toBeLessThan(antonin.x);
  expect(antonin.y).toBeGreaterThan(jan.y);
});

test('deeper ancestry: 5 generations up show the great-great-great-grandparents, where known; depth is kept on the device', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor') });
  await page.goto(`./#person-${P.jan}`);
  await expect(page.getByTestId('depth-up-value')).toHaveText('3');
  const simon = '0192f0c4-7a1e-7c3b-9d2a-000000000027';
  await expect(box(page, P.prokop)).toBeVisible();
  await expect(box(page, simon)).toHaveCount(0);
  await page.getByTestId('depth-up-more').click();
  await page.getByTestId('depth-up-more').click();
  await expect(page.getByTestId('depth-up-value')).toHaveText('5');
  await expect(box(page, simon)).toHaveCount(1);
  const top = await box(page, simon).boundingBox();
  const prokop = await box(page, P.prokop).boundingBox();
  expect(top && prokop && top.y < prokop.y).toBe(true);
  // From 1 to 6 only.
  await page.getByTestId('depth-up-more').click();
  await expect(page.getByTestId('depth-up-more')).toBeDisabled();
  await page.getByTestId('depth-down-less').click();
  await expect(page.getByTestId('depth-down-value')).toHaveText('1');
  await expect(page.getByTestId('depth-down-less')).toBeDisabled();
  await page.reload();
  await expect(page.getByTestId('depth-up-value')).toHaveText('6');
  await expect(page.getByTestId('depth-down-value')).toHaveText('1');
});

test('moving up a line: tapping a great-grandmother makes her the focus, with her parents above and descendants below', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor') });
  await page.goto(`./#person-${P.jan}`);
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.jan);
  await box(page, P.marieSvobodova).click();
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.marieSvobodova);
  await expect(page).toHaveURL(new RegExp(`#person-${P.marieSvobodova}$`));
  // Once the boxes have moved to their new places: her mother above her, her son below.
  const y = async (/** @type {string} */ id) => (await box(page, id).boundingBox())?.y ?? Number.NaN;
  await expect.poll(async () => (await y('0192f0c4-7a1e-7c3b-9d2a-000000000005')) < (await y(P.marieSvobodova))).toBe(true);
  await expect.poll(async () => (await y(P.jan)) > (await y(P.marieSvobodova))).toBe(true);
  // Back returns to the previous focus.
  await page.goBack();
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.jan);
});

test('a second tap on the focus Person, or a long press on anyone, opens their person page', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor') });
  await page.goto(`./#person-${P.jan}`);
  await box(page, P.jan).click();
  await expect(page.getByTestId('person-screen')).toHaveAttribute('data-id', P.jan);
  await page.goBack();
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.jan);
  // A long press does not move the focus.
  await box(page, P.ludmila).click({ delay: 800 });
  await expect(page.getByTestId('person-screen')).toHaveAttribute('data-id', P.ludmila);
  expect(await page.evaluate(() => localStorage.getItem('rodokmen.focus'))).toBe(P.jan);
  // The keyboard moves the focus as a tap does.
  await page.goBack();
  await box(page, P.katerina).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.katerina);
});

test('the tree pans with a drag and zooms with the wheel and the buttons', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor') });
  await page.goto(`./#person-${P.jan}`);
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.jan);
  const view = () => page.locator('.tree-view').getAttribute('style');
  const start = await view();
  const area = /** @type {{ x: number, y: number, width: number, height: number }} */ (await page.getByTestId('tree').boundingBox());
  // Drag on empty space, near the top-left corner.
  await page.mouse.move(area.x + 20, area.y + area.height - 30);
  await page.mouse.down();
  await page.mouse.move(area.x + 120, area.y + area.height - 80, { steps: 6 });
  await page.mouse.up();
  await expect.poll(view).not.toBe(start);
  // The drag did not change the focus.
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.jan);
  const panned = await view();
  await page.getByTestId('zoom-in').click();
  await expect.poll(view).toMatch(/scale\(1\.25\)|scale\(1\.2\d+\)/);
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await page.mouse.wheel(0, 400);
  await expect.poll(view).not.toBe(panned);
  await page.getByTestId('zoom-fit').click();
  await expect.poll(view).toBe(start);
});

test('shared link: the address names the focus, and another Member opening it sees the same focus', async ({ page, context }) => {
  await mockFamilyApi(context, { me: member('contributor', { person: 23 }) });
  await page.goto(`./#person-${P.karel}`);
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.karel);
  const address = page.url();
  // Another Member, on another device, with their own Person linked.
  const other = await context.browser()?.newContext();
  if (!other) throw new Error('no browser');
  await mockFamilyApi(other, { me: member('contributor', { person: 10 }) });
  const theirs = await other.newPage();
  await theirs.goto(address);
  await expect(theirs.getByTestId('tree')).toHaveAttribute('data-focus', P.karel);
  await other.close();
});

test('the last focus is remembered on the device, and "Me" returns to the Member’s own Person', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor', { person: 23 }) });
  await openApp(page);
  // New Member: linked, nothing remembered, so the tree opens on their own Person.
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.dorota);
  await box(page, P.bohumil).click();
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.bohumil);
  // Opening the app again (no address) returns to the last focus.
  await page.goto('./');
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.bohumil);
  await expect(page).toHaveURL(new RegExp(`#person-${P.bohumil}$`));
  await page.getByTestId('me-button').click();
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.dorota);
  expect(await focusOf(page)).toBe(P.dorota);
});

test('not linked: with nothing remembered and no Family root yet, the tree opens on search', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor') });
  await openApp(page);
  await expect(page.getByTestId('tree-start')).toBeVisible();
  await expect(page.getByTestId('me-button')).toHaveCount(0);
  await page.getByTestId('people-search').fill('novak');
  await page.getByTestId('person-result').filter({ hasText: 'Karel Novák' }).getByTestId('show-in-tree').click();
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.karel);
});

test('Living people are marked, and adoptive parents are named under the tree', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor') });
  await page.goto(`./#person-${P.bohumil}`);
  await expect(box(page, P.jaroslav)).toHaveClass(/living/);
  await expect(box(page, P.jaroslav)).toContainText('living');
  await expect(box(page, P.antonin)).not.toHaveClass(/living/);
  // Without a Family root, Unrelated people cannot be told apart, so there is no switch for them and no weak link.
  await expect(page.getByTestId('tree-include-unrelated')).toHaveCount(0);
  await expect(page.locator('.tree-lines .line.weak')).toHaveCount(0);
  await expect(page.getByTestId('possible-mark')).toHaveCount(0);
  await page.goto(`./#person-${P.marieAdopted}`);
  await expect(page.getByTestId('other-parents')).toContainText('Adoptive parents');
  await expect(page.getByTestId('other-parents')).toContainText('Antonín Novák');
  await expect(box(page, P.karel)).toBeVisible();
});

test('on a phone, two fingers pinch the tree to zoom in and out', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'phone', 'touch needs the phone viewport');
  await mockFamilyApi(page, { me: member('contributor') });
  await page.goto(`./#person-${P.jan}`);
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.jan);
  const scale = async () => Number(/scale\(([\d.]+)\)/.exec((await page.locator('.tree-view').getAttribute('style')) ?? '')?.[1]);
  const before = await scale();
  const area = /** @type {{ x: number, y: number, width: number, height: number }} */ (await page.getByTestId('tree').boundingBox());
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height - 40;
  const cdp = await context.newCDPSession(page);
  /** @param {'touchStart' | 'touchMove' | 'touchEnd'} type @param {number} spread */
  const touch = (type, spread) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints:
        type === 'touchEnd'
          ? []
          : [
              { x: cx - spread, y: cy, id: 1 },
              { x: cx + spread, y: cy, id: 2 },
            ],
    });
  await touch('touchStart', 30);
  for (const spread of [45, 60, 75, 90]) await touch('touchMove', spread);
  await touch('touchEnd', 0);
  await expect.poll(scale).toBeGreaterThan(before * 2);
  // The pinch moved no focus.
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.jan);
});
