// Task 3.1: point-in-district lookup and the archive answer, for the cases
// the archive-lookup spec names.
import { municipality } from './data.js';
import { expect, tapPoint, test } from './fixtures.js';

const CASES = [
  { place: 'Pardubice', archive: 'SOA Zámrsk' },
  { place: 'Havlíčkův Brod', archive: 'SOA Zámrsk' },
  { place: 'Pelhřimov', archive: 'SOA Třeboň' },
  { place: 'Vsetín', archive: 'Zemský archiv Opava' },
  { place: 'Praha', archive: 'Archiv hlavního města Prahy' },
];

for (const { place, archive } of CASES) {
  test(`${place} → ${archive}`, async ({ page }) => {
    const m = municipality(place);
    await tapPoint(page, m.lat, m.lon);
    await expect(page.locator('[data-testid="municipality"]')).toHaveText(place);
    await expect(page.locator('[data-testid="archive"]')).toHaveText(archive);
    await expect(page.locator('[data-testid="open-scans"]')).toBeVisible();
  });
}

test('Prague is not SOA Praha', async ({ page }) => {
  const m = municipality('Praha');
  await tapPoint(page, m.lat, m.lon);
  await expect(page.locator('[data-testid="archive"]')).not.toHaveText('SOA Praha');
});

test('a point in Austria gets no archive', async ({ page }) => {
  // Freistadt, Upper Austria, about 15 km south of the border.
  await tapPoint(page, 48.511, 14.5045);
  await expect(page.locator('[data-testid="outside"]')).toBeVisible();
  await expect(page.locator('[data-testid="open-scans"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="archive"]')).toHaveCount(0);
  await expect(page.locator('#place-sheet a')).toHaveCount(0);
});
