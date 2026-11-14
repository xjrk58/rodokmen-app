// Kinship in the app (add-kinship tasks 7.2 to 7.5; kinship, family-view and family-tree specs),
// against the mocked API at both viewports. Dorota (23) is the reader: the answers are the
// server's rules applied to the invented Tree (tests/e2e/kinship-api.js). Every word comes from
// the answer or an i18n key.
import { member, mockFamilyApi } from './family-api.js';
import { ID, P, summary } from './family-data.js';
import { expect, test } from './fixtures.js';
import { firstStep, KINSHIP_READER, kinshipOf } from './kinship-api.js';

const reader = (o = {}) => member('contributor', { person: KINSHIP_READER, ...o });
/** @param {import('@playwright/test').Page} page */
const fitsTheScreen = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** @param {import('@playwright/test').Page} page @param {string} id */
const box = (page, id) => page.locator(`[data-testid="tree-person"][data-person="${id}"]`);

test.describe('in Czech', () => {
  test.use({ language: 'cs' });

  test('a relative’s page: the term, the line and degree, the common ancestors as links, and how many more paths', async ({ page }) => {
    await mockFamilyApi(page, { me: reader() });
    await page.goto(`./#people/${P.marieAdopted}`);
    const section = page.getByTestId('kinship');
    await expect(section.getByRole('heading')).toHaveText('Jak jste příbuzní');
    await expect(section.getByTestId('kinship-term').first()).toHaveText('teta (přes osvojení)');
    await expect(section.getByTestId('kinship-degree').first()).toHaveText('linie vedlejší, 3. stupeň');
    await expect(section.getByTestId('kinship-ancestors').first().getByTestId('kinship-person')).toHaveText(['Antonín Novák', 'Terezie Černá']);
    await expect(section.getByTestId('kinship-more')).toHaveText('Další cesty: 1');
    expect(await fitsTheScreen(page)).toBe(true);
  });

  test('listing every path: each with its term, line, degree and every Person on the way, each a link', async ({ page }) => {
    await mockFamilyApi(page, { me: reader() });
    await page.goto(`./#people/${P.marieAdopted}`);
    await page.getByTestId('kinship-more').click();
    const paths = page.getByTestId('kinship-paths').getByTestId('kinship-path');
    await expect(paths).toHaveCount(2);
    await expect(paths.nth(1).getByTestId('kinship-term')).toHaveText('polorodá teta z 2. kolena');
    await expect(paths.nth(1).getByTestId('kinship-degree')).toHaveText('linie vedlejší, 5. stupeň');
    const steps = paths.nth(1).getByTestId('kinship-step');
    await expect(steps).toHaveText(['otec: Bohumil Novák', 'otec: Antonín Novák', 'otec: Jan Novák', 'syn: Karel Novák', 'dcera: Marie Nováková']);
    await steps.first().getByRole('link').click();
    await expect(page.getByTestId('person-title')).toHaveText('Bohumil Novák');
    expect(await fitsTheScreen(page)).toBe(true);
  });

  test('their own page says that this is them, with no line or degree', async ({ page }) => {
    await mockFamilyApi(page, { me: reader() });
    await page.goto(`./#people/${ID(KINSHIP_READER)}`);
    await expect(page.getByTestId('kinship-self')).toHaveText('To jste vy.');
    await expect(page.getByTestId('kinship-degree')).toHaveCount(0);
  });

  test('weak father link: "možná" and the "?" of a Possible relative', async ({ page }) => {
    await mockFamilyApi(page, { me: reader() });
    await page.goto(`./#people/${P.bedrich}`);
    await expect(page.getByTestId('kinship-term')).toContainText('možná bratr');
    await expect(page.getByTestId('kinship-possible').first()).toHaveText('?');
  });

  test('no chain: the Tree records no kinship between them', async ({ page }) => {
    await mockFamilyApi(page, { me: reader() });
    await page.goto(`./#people/${P.jakub}`);
    await expect(page.getByTestId('kinship-none')).toHaveText('Rodokmen mezi vámi nezaznamenává žádné příbuzenství.');
  });

  test('through two marriages: connected, with the number of marriages and the chain', async ({ page }) => {
    const answer = kinshipOf(29);
    const step = firstStep(22);
    answer.connection = {
      marriages: 2,
      steps: [
        { ...step, person: ID(22), link: 'parent' },
        {
          ...step,
          person: ID(28),
          link: 'partner',
          linkType: null,
          term: { cs: { text: 'švagrová', gender: 'f' }, en: { text: 'sister-in-law', gender: 'f' } },
        },
        { ...step, person: ID(29), link: 'partner', linkType: null, term: { cs: { text: 'manžel', gender: 'm' }, en: { text: 'husband', gender: 'm' } } },
      ],
    };
    answer.persons.push(summary(22), summary(28));
    await mockFamilyApi(page, { me: reader(), extra: { 'GET persons/[0-9a-f-]+/kinship': () => ({ json: answer }) } });
    await page.goto(`./#people/${P.jakub}`);
    await expect(page.getByTestId('kinship-connected')).toContainText('z toho sňatků: 2');
    await expect(page.getByTestId('kinship-step')).toHaveText(['matka: Magdalena Horáková', 'švagrová: Josefa Kmotrová', 'manžel: Jakub Novák']);
  });

  test('many paths: the list ends with "there may be more"', async ({ page }) => {
    const answer = { ...kinshipOf(20), more: true };
    await mockFamilyApi(page, { me: reader(), extra: { 'GET persons/[0-9a-f-]+/kinship': () => ({ json: answer }) } });
    await page.goto(`./#people/${P.marieAdopted}`);
    await expect(page.getByTestId('kinship-may-be-more')).toHaveText('Cest může být víc: hledání se zastavilo na své mezi.');
  });

  test('searching a surname: each result’s term after the life years, none for a Person with no kinship, and a long one on one line', async ({ page }) => {
    await mockFamilyApi(page, { me: reader() });
    await page.goto('./#people');
    await page.getByTestId('people-search').fill('novak');
    const results = page.getByTestId('person-result');
    await expect(results.filter({ hasText: 'Antonín Novák' }).getByTestId('kinship-short')).toHaveText('děd');
    await expect(results.filter({ hasText: 'Jakub Novák' }).getByTestId('kinship-short')).toHaveCount(0);
    await expect(results.filter({ hasText: 'Dorota Nováková' }).getByTestId('kinship-short')).toHaveText('vy');
    // The longest stays one line, cut with an ellipsis on a phone, and whole in the text read out.
    const long = results.filter({ hasText: 'Šimon Novák' }).getByTestId('kinship-short');
    await expect(long).toHaveText('možná předek v 8. pokolení');
    expect(await long.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('nowrap');
    expect(await fitsTheScreen(page)).toBe(true);
  });

  test('same everywhere: a result and the Person’s page name the same kinship', async ({ page }) => {
    await mockFamilyApi(page, { me: reader() });
    await page.goto('./#people');
    await page.getByTestId('people-search').fill('novak');
    const karel = page.getByTestId('person-result').filter({ hasText: 'Karel Novák' });
    await expect(karel.getByTestId('kinship-short')).toHaveText('polorodý prastrýc');
    await karel.getByRole('link', { name: 'Karel Novák' }).click();
    await expect(page.getByTestId('kinship-term').first()).toHaveText('polorodý prastrýc');
  });

  test('moving up a line: the strip names the Focus Person’s kinship, and leads to their page', async ({ page }) => {
    await mockFamilyApi(page, { me: reader() });
    await page.goto(`./#person-${P.bohumil}`);
    await expect(page.getByTestId('kinship-strip')).toContainText('otec');
    await box(page, P.ludmila).click();
    await expect(page.getByTestId('tree')).toHaveAttribute('data-focus', P.ludmila);
    await expect(page.getByTestId('kinship-strip')).toContainText('prababička');
    await expect(page.getByTestId('kinship-strip')).toContainText('linie přímá, 3. stupeň');
    await page.getByTestId('kinship-strip').click();
    await expect(page.getByTestId('person-title')).toHaveText('Ludmila Veselá');
  });

  test('the focus moves: on the page of the focus’s father, kinship is still the reader’s', async ({ page }) => {
    await mockFamilyApi(page, { me: reader() });
    await page.goto(`./#person-${P.antonin}`);
    await expect(page.getByTestId('kinship-strip')).toContainText('děd');
    await page.goto(`./#people/${P.jan}`);
    await expect(page.getByTestId('kinship-term').first()).toHaveText('praděd');
  });

  test('screen reader: a box’s accessible name holds the term (here the grandfather’s); the boxes show no kinship line', async ({ page }) => {
    await mockFamilyApi(page, { me: reader() });
    await page.goto(`./#person-${P.bohumil}`);
    await expect(box(page, P.antonin)).toHaveAttribute('aria-label', /Antonín Novák, .*děd/);
    await expect(box(page, P.antonin).locator('text')).toHaveCount(3);
  });
});

test.describe('a Member with no own Person', () => {
  test('not linked: no kinship in results, and the page says how the link is made, with "This is me"', async ({ page }) => {
    await mockFamilyApi(page, { me: member('contributor') });
    await page.goto('./#people');
    await page.getByTestId('people-search').fill('novak');
    await expect(page.getByTestId('person-result').first()).toBeVisible();
    await expect(page.getByTestId('kinship-short')).toHaveCount(0);
    await page.goto(`./#people/${P.jan}`);
    await expect(page.getByTestId('kinship')).toContainText('the Owner links to your account');
    await expect(page.getByTestId('this-is-me')).toHaveText('This is me');
  });

  test('the Owner not linked: the prompt leads to Settings', async ({ page }) => {
    await mockFamilyApi(page, { me: member('owner') });
    await page.goto(`./#people/${P.jan}`);
    await page.getByTestId('kinship-settings').click();
    await expect(page.getByTestId('settings-screen')).toBeVisible();
  });

  test('this is me: the request goes to the Owner, and the page and Settings show it waiting; it can be withdrawn', async ({ page }) => {
    const me = member('contributor');
    /** @type {unknown} */
    let asked = null;
    await mockFamilyApi(page, {
      me,
      extra: {
        'PUT me/person-request': (_m, _url, body) => {
          asked = body;
          me.personRequest = { person: summary(10), at: '2026-11-14T10:00:00.000Z' };
          return { json: me };
        },
        'DELETE me/person-request': () => {
          me.personRequest = null;
          return { json: me };
        },
      },
    });
    await page.goto(`./#people/${P.jan}`);
    await page.getByTestId('this-is-me').click();
    expect(asked).toEqual({ personId: P.jan });
    await expect(page.getByTestId('kinship-waiting')).toContainText('Waiting for the Owner');
    await expect(page.getByTestId('kinship-waiting')).toContainText('Jan Novák');
    await page.getByTestId('tabbar-settings').click();
    await expect(page.getByTestId('my-request')).toContainText('Jan Novák');
    await page.getByTestId('my-request-withdraw').click();
    await expect(page.getByTestId('my-request')).toHaveCount(0);
  });

  test('already linked: no page offers "This is me"', async ({ page }) => {
    await mockFamilyApi(page, { me: reader() });
    await page.goto(`./#people/${P.jan}`);
    await expect(page.getByTestId('kinship-term').first()).toBeVisible();
    await expect(page.getByTestId('this-is-me')).toHaveCount(0);
  });

  test('a page whose kinship cannot be loaded goes without the section, and shows no error', async ({ page }) => {
    await mockFamilyApi(page, { me: member('contributor', { person: 10 }) });
    await page.goto(`./#people/${P.antonin}`);
    await expect(page.getByTestId('person-title')).toHaveText('Antonín Novák');
    await expect(page.getByTestId('kinship')).toHaveCount(0);
    await expect(page.getByText('Name the starting Person')).toHaveCount(0);
  });
});
