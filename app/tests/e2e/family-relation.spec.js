// The relation to the family in the app (add-family-view tasks 2.4, 2a.5 and 2a.6; family-view,
// family-tree and family-map specs), against the mocked API and the invented Tree, at both
// viewports: Family roots in Owner settings and on the person page, the Family-root fallback of
// an unlinked Member's tree, Possible relatives and weak links in the tree, and Unrelated people
// hidden by default in search, the tree and the family pins. Without a Family root the app shows
// everyone (the other family specs).
import { member, mockFamilyApi, ROOTS, withRelations } from './family-api.js';
import { ID, P, summary } from './family-data.js';
import { expect, familyScreenshot, openApp, test } from './fixtures.js';

/** @param {import('@playwright/test').Page} page @param {string} id */
const box = (page, id) => page.locator(`[data-testid="tree-person"][data-person="${id}"]`);

test('weak link: a Possible relative in view is marked as one, with the weak link drawn differently; Living people are marked', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor', { person: 21, roots: ROOTS }) });
  await page.goto(`./#person-${P.bohumil}`);
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.bohumil);
  // Bedřich is linked to his parents only weakly: a Possible relative.
  await expect(box(page, P.bedrich)).toHaveClass(/possible/);
  await expect(box(page, P.bedrich).getByTestId('possible-mark')).toHaveText('?');
  await expect(box(page, P.jaroslav).getByTestId('possible-mark')).toHaveCount(0);
  await expect(box(page, P.bedrich)).toHaveAttribute('aria-label', /possible relative/);
  await expect(box(page, P.jaroslav)).not.toHaveClass(/possible/);
  await expect(box(page, P.jaroslav)).toHaveClass(/living/);
  // His child line is the weak link: dotted, in the colour of Possible relatives; his siblings' are not.
  const weak = page.locator('.tree-lines .line.weak');
  await expect(weak).toHaveCount(1);
  await expect(weak).toHaveAttribute('data-weak', 'true');
  expect(await weak.evaluate((el) => getComputedStyle(el).strokeDasharray)).not.toBe('none');
  await familyScreenshot(page, 'mock-tree-possible');
});

test('Unrelated people appear in the tree only when switched on', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor', { roots: ROOTS }) });
  // A village couple with no link to the family: the focus is always shown, his wife only with the switch.
  await page.goto(`./#person-${P.jakub}`);
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.jakub);
  await expect(box(page, P.jakub)).toBeVisible();
  await expect(box(page, P.josefa)).toHaveCount(0);
  await page.getByTestId('tree-include-unrelated').check();
  await expect(box(page, P.josefa)).toBeVisible();
});

test('not linked: with nothing remembered, the tree opens on a Family root', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor', { roots: ROOTS }) });
  await openApp(page);
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.vaclav);
  await expect(page).toHaveURL(new RegExp(`#person-${P.vaclav}$`));
  await expect(page.getByTestId('tree-start')).toHaveCount(0);
});

test('village index entries: a surname search lists only Relatives and Possible relatives until Unrelated people are switched on', async ({ page }) => {
  const calls = await mockFamilyApi(page, { me: member('contributor', { person: 10, roots: ROOTS }) });
  await page.goto('./#people');
  await page.getByTestId('people-search').fill('novak');
  // The server leaves them out, so a page holds as many of the family as it can.
  await expect.poll(() => calls.some((c) => c.startsWith('GET persons?q=novak&relation=relative%2Cpossible&'))).toBe(true);
  const results = page.getByTestId('person-result');
  await expect(results.filter({ hasText: 'Dvořáková' })).toHaveCount(0);
  await expect(results.filter({ hasText: 'Karel Novák' })).toBeVisible();
  await expect(results.filter({ hasText: 'Jakub Novák' })).toHaveCount(0);
  // Possible relatives are marked wherever they appear.
  await expect(results.filter({ hasText: 'Šimon Novák' }).getByTestId('mark')).toHaveText('possible relative');
  await page.getByTestId('include-unrelated').check();
  await expect(results.filter({ hasText: 'Jakub Novák' })).toBeVisible();
  await expect(results.filter({ hasText: 'Jakub Novák' }).getByTestId('mark')).toHaveCount(0);
});

test('busy village: family pins count the family until the Member includes Unrelated people', async ({ page }) => {
  const calls = await mockFamilyApi(page, { me: member('contributor', { person: 10, roots: ROOTS }) });
  await page.goto('./#map=11/49.6/15.9');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  // Vrbice: two marriages of the family (4 people) and the death of a villager.
  await expect(page.getByTitle(/^Vrbice:/)).toHaveAttribute('title', 'Vrbice: 4 people of the family');
  expect(calls.some((c) => c.includes('relation=relative%2Cpossible'))).toBe(true);
  await page.getByTestId('map-include-unrelated').check();
  await expect(page.getByTitle(/^Vrbice:/)).toHaveAttribute('title', 'Vrbice: 5 people of the family');
});

test('without a Family root the map has no switch, and every pin counts everyone', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor', { person: 10 }) });
  await page.goto('./#map=11/49.6/15.9');
  await expect(page.getByTitle(/^Vrbice:/)).toHaveAttribute('title', 'Vrbice: 5 people of the family');
  await expect(page.getByTestId('map-include-unrelated')).toBeHidden();
});

/**
 * The Owner's Family roots on the mocked server: marking and unmarking change what GET me says.
 * @param {import('./family-api.js').Me} me
 */
function rootsServer(me) {
  /** @type {string[]} */
  const roots = me.familyRoots;
  const list = () => ({
    items: roots.map((id) =>
      withRelations(
        { ...summary(Number(id.slice(-12))), familyRoot: true },
        roots.map((r) => Number(r.slice(-12))),
      ),
    ),
  });
  return {
    'GET family-roots': () => ({ json: list() }),
    /** @type {import('./family-api.js').Handler} */
    'PUT persons/([0-9a-f-]+)/family-root': (m, _url, body) => {
      const id = m[1] ?? '';
      const on = typeof body === 'object' && body !== null && 'familyRoot' in body && body.familyRoot === true;
      const at = roots.indexOf(id);
      if (on && at < 0) roots.push(id);
      if (!on && at >= 0) roots.splice(at, 1);
      return { json: list() };
    },
  };
}

test('Owner settings: until the first Family root the Owner is asked to mark one; marking and removing roots', async ({ page }) => {
  const me = member('owner', { person: 10 });
  await mockFamilyApi(page, {
    me,
    extra: { 'GET members': () => ({ json: { items: [] } }), 'GET invitations': () => ({ json: { items: [] } }), ...rootsServer(me) },
  });
  await page.goto('./#settings');
  const section = page.getByTestId('settings-family-roots');
  await expect(section.getByTestId('family-roots-prompt')).toBeVisible();
  await section.getByTestId('family-root-add').click();
  await section.getByTestId('root-person-search').fill('vaclav');
  await section
    .getByTestId('root-person-results')
    .getByRole('button', { name: /Václav Novák/ })
    .click();
  await expect(section.getByTestId('family-root')).toHaveCount(1);
  await expect(section.getByTestId('family-root')).toContainText('Václav Novák');
  await expect(section.getByTestId('family-root').getByTestId('mark')).toHaveText('Family root');
  await expect(section.getByTestId('family-roots-prompt')).toHaveCount(0);
  expect(me.familyRoots).toEqual([P.vaclav]);
  // From now on the relation counts: the search for people in settings still finds everyone.
  await section.getByTestId('family-root-add').click();
  await section.getByTestId('root-person-search').fill('anna dvor');
  await section
    .getByTestId('root-person-results')
    .getByRole('button', { name: /Anna Dvořáková/ })
    .click();
  await expect(section.getByTestId('family-root')).toHaveCount(2);
  await section.getByTestId('family-root').filter({ hasText: 'Václav Novák' }).getByTestId('family-root-remove').click();
  await expect(section.getByTestId('family-root')).toHaveCount(1);
  expect(me.familyRoots).toEqual([ID(2)]);
});

test('the person page: the Owner marks and unmarks a Family root; other Members see no such button', async ({ page }) => {
  const me = member('owner', { person: 10 });
  await mockFamilyApi(page, { me, extra: rootsServer(me) });
  await page.goto(`./#people/${P.tomas}`);
  const toggle = page.getByTestId('family-root-toggle');
  await expect(toggle).toHaveText('Mark as a Family root');
  await toggle.click();
  await expect(toggle).toHaveText('No longer a Family root');
  await expect(page.locator('.person-head').getByTestId('mark')).toHaveText('Family root');
  expect(me.familyRoots).toEqual([P.tomas]);
  await toggle.click();
  await expect(toggle).toHaveText('Mark as a Family root');
  expect(me.familyRoots).toEqual([]);
});

test('a Contributor sees neither the Family roots nor the button to mark one', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor', { person: 10, roots: ROOTS }) });
  await page.goto(`./#people/${P.vaclav}`);
  await expect(page.locator('.person-head').getByTestId('mark')).toHaveText('Family root');
  await expect(page.getByTestId('family-root-toggle')).toHaveCount(0);
  await page.goto('./#settings');
  await expect(page.getByTestId('settings-sessions')).toBeVisible();
  await expect(page.getByTestId('settings-family-roots')).toHaveCount(0);
});
