// add-exports-and-erasure (erasure spec, "Owner erases a Living person"; exports spec, "GEDCOM
// download for the Owner"): the Owner erases a Living person from their page after reading what
// goes and typing their name, and downloads the GEDCOM file from Settings; against the mocked API
// and the invented Tree, at both viewports.
import { member, mockFamilyApi } from './family-api.js';
import { P } from './family-data.js';
import { expect, test } from './fixtures.js';

/** What the server would say erasing Bedřich (invented, Living: no dates at all) removes. */
const PREVIEW = {
  person: {
    id: P.bedrich,
    version: 1,
    sex: 'male',
    given: 'Bedřich',
    surname: 'Novák',
    displayName: 'Bedřich Novák',
    living: true,
    birth: null,
    death: null,
    relation: 'unrelated',
    familyRoot: false,
  },
  mayErase: true,
  confirmWith: 'Bedřich Novák',
  names: 1,
  roles: 1,
  familyLinks: 1,
  labels: 0,
  events: [
    {
      id: '0192f0c4-7a1e-7c3b-9d2a-0000000e0001',
      version: 1,
      type: 'residence',
      typeDetail: null,
      date: '1990',
      earliest: '1990-01-01',
      latest: '1990-12-31',
      place: null,
      house: null,
      description: null,
    },
  ],
  citations: 1,
  images: 0,
  families: 0,
  leads: { deleted: 1, unlinked: 0 },
  history: 2,
  pending: 0,
};

test('the Owner reads what goes, types the name, and erases a Living person', async ({ page }) => {
  /** @type {unknown[]} */
  const erased = [];
  await mockFamilyApi(page, {
    me: member('owner'),
    extra: {
      [`GET persons/${P.bedrich}/erasure`]: () => ({ json: PREVIEW }),
      /** @type {import('./family-api.js').Handler} */
      [`POST persons/${P.bedrich}/erase`]: (_m, _url, body) => {
        erased.push(body);
        return { json: { personId: P.bedrich, erasedAt: '2026-11-05T10:00:00.000Z', events: 1, citations: 1, images: 0, history: 2 } };
      },
    },
  });
  await page.goto(`./#people/${P.bedrich}`);
  const panel = page.getByTestId('erase-person');
  await expect(panel).toBeVisible();
  await panel.getByTestId('erase-open').click();
  await expect(panel.getByTestId('erase-preview')).toContainText('Erasing Bedřich Novák removes:');
  await expect(panel.getByTestId('erase-event')).toHaveCount(1);
  const yes = panel.getByTestId('erase-yes');
  await expect(yes).toBeDisabled();
  await panel.getByTestId('erase-confirm').fill('Someone else');
  await expect(yes).toBeDisabled();
  await panel.getByTestId('erase-confirm').fill('bedřich  novák');
  await expect(yes).toBeEnabled();
  await yes.click();
  await expect(page).toHaveURL(/#people$/);
  expect(erased).toEqual([{ confirmation: 'bedřich  novák' }]);
});

test('no erasure for a Person who is not Living, nor for anyone but the Owner', async ({ page }) => {
  await mockFamilyApi(page, { me: member('owner') });
  await page.goto(`./#people/${P.jan}`);
  await expect(page.getByTestId('person-title')).toBeVisible();
  await expect(page.getByTestId('erase-person')).toHaveCount(0);

  await mockFamilyApi(page, { me: member('editor') });
  await page.goto(`./#people/${P.bedrich}`);
  await page.reload();
  await expect(page.getByTestId('person-title')).toHaveText('Bedřich Novák');
  await expect(page.getByTestId('erase-person')).toHaveCount(0);
});

test('only the Owner has the GEDCOM download in Settings', async ({ page }) => {
  await mockFamilyApi(page, {
    me: member('owner'),
    extra: { 'GET members': () => ({ json: { items: [] } }), 'GET invitations': () => ({ json: { items: [] } }) },
  });
  await page.goto('./#settings');
  const link = page.getByTestId('settings-export').getByTestId('gedcom-download');
  await expect(link).toHaveAttribute('href', '/api/export/family.ged');
  await expect(link).toHaveAttribute('download', 'family.ged');

  await mockFamilyApi(page, { me: member('editor') });
  await page.reload();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await expect(page.getByTestId('settings-export')).toHaveCount(0);
});
