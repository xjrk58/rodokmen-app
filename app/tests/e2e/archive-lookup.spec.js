// Task 3.1: point-in-district lookup and the archive answer, for the cases
// the archive-lookup spec names.
import { municipality } from './data.js';
import { expect, openApp, tapPoint, test } from './fixtures.js';

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

// Municipalities that changed district in 2021 keep the archive of their
// older district (municipalityOverrides in archives.json); today's district's
// archive becomes an "also check".
test.describe('district changed in 2021', () => {
  test.use({ locale: 'en-US' });

  test('Harrachov → SOA Zámrsk, also check SOA Litoměřice', async ({ page }) => {
    const m = municipality('Harrachov', 'Jablonec nad Nisou');
    await tapPoint(page, m.lat, m.lon);
    await expect(page.locator('[data-testid="municipality"]')).toHaveText('Harrachov');
    await expect(page.locator('[data-testid="district"]')).toHaveText('District Jablonec nad Nisou');
    await expect(page.locator('[data-testid="archive"]')).toHaveText('SOA Zámrsk');
    const hint = page.locator('[data-testid="also-check"]');
    await expect(hint).toHaveCount(1);
    await expect(hint).toContainText('also check SOA Litoměřice');
    await expect(hint).toContainText('Semily');
  });

  test('Študlov (chosen in search) → Zemský archiv Opava, also check MZA Brno', async ({ page }) => {
    const m = municipality('Študlov', 'Zlín');
    await openApp(page);
    await page.locator('#search-input').fill('Studlov');
    // Two Municipalities are called Študlov; the district label tells them apart.
    await page.locator('#search-results li', { hasText: 'Študlov' }).filter({ hasText: 'district Zlín' }).click();
    await expect(page.locator('[data-testid="district"]')).toHaveText('District Zlín');
    await expect(page.locator('[data-testid="municipality"]')).toHaveText(m.name);
    await expect(page.locator('[data-testid="archive"]')).toHaveText('Zemský archiv Opava');
    const hint = page.locator('[data-testid="also-check"]');
    await expect(hint).toHaveCount(1);
    await expect(hint).toContainText('also check MZA Brno');
    await expect(hint).toHaveAttribute('data-reason', 'district');
  });
});
