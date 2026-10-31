// add-family-view tasks 2.1–2.3 (family-view spec): people search, the person page and "Show in
// tree", against the mocked API and the invented Tree, at both viewports.
import { member, mockFamilyApi } from './family-api.js';
import { P } from './family-data.js';
import { expect, test } from './fixtures.js';

test('searching without diacritics: "dvorakova" finds Dvořáková with her life years', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor', { person: 10 }) });
  await page.goto('./#people');
  await page.getByTestId('people-search').fill('dvorakova');
  const result = page.getByTestId('person-result');
  await expect(result).toHaveCount(1);
  await expect(result).toContainText('Anna Dvořáková');
  await expect(result).toContainText('1750–1805');
  await expect(page.getByTestId('tabbar-people')).toHaveAttribute('aria-current', 'page');
});

test('a result found by another Name says which, and every result offers "Show in tree"', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor', { person: 10 }) });
  await page.goto('./#people');
  await page.getByTestId('people-search').fill('joannes');
  const jan = page.getByTestId('person-result').filter({ hasText: 'Jan Novák' });
  await expect(jan.getByTestId('matched')).toHaveText('as Joannes Nowak');
  await jan.getByTestId('show-in-tree').click();
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.jan);
  // The search is still there when the Member comes back.
  await page.getByTestId('tabbar-people').click();
  await expect(page.getByTestId('people-search')).toHaveValue('joannes');
});

test('without a query the list shows everyone, a page at a time', async ({ page }) => {
  const calls = await mockFamilyApi(page, { me: member('contributor') });
  await page.goto('./#people');
  await expect(page.getByTestId('person-result')).not.toHaveCount(0);
  expect(calls.some((c) => c.startsWith('GET persons?limit=50&offset=0'))).toBe(true);
  await page.getByTestId('people-search').fill('zzz');
  await expect(page.getByTestId('no-people')).toBeVisible();
});

test('godparent role: the page of a woman who was godmother at a baptism lists it with the Role "Godparent"', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor') });
  await page.goto(`./#people/${P.rozalie}`);
  await expect(page.getByTestId('person-title')).toHaveText('Rozálie Svobodová');
  const baptism = page.locator('[data-testid="person-event"][data-event="0192f0c4-7a1e-7c3b-9d2a-000000000401"]');
  await expect(baptism).toContainText('baptism');
  await expect(baptism.getByTestId('role')).toHaveText('Godparent');
  await expect(baptism).toContainText('1801-03-12');
  await expect(baptism).toContainText('Kamenná Lhota No. 12');
});

test('the person page: all Names, Events with Citations and their confidence and images, Families, and its actions', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor') });
  await page.goto(`./#people/${P.jan}`);
  await expect(page.getByTestId('person-title')).toHaveText('Jan Novák');
  await expect(page.getByTestId('person-name')).toHaveCount(3);
  await expect(page.getByTestId('person-name').filter({ hasText: 'Joannes Nowak' })).toContainText('Latin form');
  const baptism = page.locator('[data-testid="person-event"][data-event="0192f0c4-7a1e-7c3b-9d2a-000000000401"]');
  await expect(baptism.getByTestId('role')).toHaveText('Child');
  await expect(baptism.getByTestId('confidence')).toHaveText('confidence: high');
  await baptism.getByTestId('citation').getByRole('button').click();
  await expect(baptism.getByTestId('citation-detail')).toContainText('Joannes, filius legitimus');
  await expect(baptism.getByTestId('citation-detail').locator('img')).toHaveAttribute('alt', 'Register page (invented)');
  // Families: as a child of Tomáš and Marie, and as a partner twice, with the children.
  await expect(page.getByTestId('family-as-child')).toContainText('Tomáš Novák');
  await expect(page.getByTestId('family-as-partner')).toHaveCount(2);
  await expect(page.getByTestId('family-as-partner').filter({ hasText: 'Ludmila Veselá' })).toContainText('Antonín Novák');
  // History and "Propose a change" lead to the work panel, with this Person.
  await expect(page.getByTestId('history')).toHaveAttribute('href', `#work/history/person/${P.jan}`);
  await page.getByTestId('propose-change').click();
  await expect(page.locator('#work')).toBeVisible();
  await expect(page.getByTestId('person')).toContainText('Jan Novák');
  await expect(page.getByTestId('targets')).toContainText('baptism');
});

test('an adopted child: her Families as a child say birth and adoption apart', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor') });
  await page.goto(`./#people/${P.marieAdopted}`);
  await expect(page.getByTestId('family-as-child')).toHaveCount(2);
  await expect(page.getByTestId('family-as-child').filter({ hasText: 'Karel Novák' })).toContainText('Child of');
  await expect(page.getByTestId('family-as-child').filter({ hasText: 'Antonín Novák' })).toContainText('Adopted child of');
});

test('"Show in tree" on a person page opens the tree on that Person', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor', { person: 10 }) });
  await page.goto(`./#people/${P.antonin}`);
  await page.getByTestId('show-in-tree').click();
  await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.antonin);
  await expect(page).toHaveURL(new RegExp(`#person-${P.antonin}$`));
});

test('a Living Person is marked as living on the person page and in the results', async ({ page }) => {
  await mockFamilyApi(page, { me: member('contributor') });
  await page.goto(`./#people/${P.jaroslav}`);
  await expect(page.getByTestId('mark')).toHaveText('living');
  await page.goto('./#people');
  await page.getByTestId('people-search').fill('jaroslav');
  await expect(page.getByTestId('person-result')).toHaveCount(1);
  await expect(page.getByTestId('person-result').getByTestId('mark')).toHaveText('living');
});
