import { createServer } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { Hourglass } from '@rodokmen/shared';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type RodokmenApp } from '../src/app.js';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { OutboxMailer } from '../src/mail/mailer.js';
import { DEFAULT_APP_DIR } from '../src/routes/pages.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, portOf, signIn, TestClock, testConfig } from './helpers.js';

/**
 * The family screens against the real server and the invented fixture Tree, in Chromium at
 * phone size (390 × 844): add-family-view tasks 2.1–2.4, 2a.2, 2a.5, 2a.6 and 3.1–3.4 end to
 * end; the relation to the family also at desktop size (1280 × 800). With FAMILY_SCREENSHOTS
 * set to a folder, it saves phone screenshots of the tree home screen, a person page and the
 * tree around a Possible relative there.
 */
const model = generateFixture();
const L = model.landmarks;
const SHOTS = process.env.FAMILY_SCREENSHOTS;
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = portOf(srv.address());
      srv.close(() => resolve(port));
    });
  });
}

describe('the family screens in the app (Chromium, phone viewport, fixture Tree)', () => {
  let t: TestDatabase;
  let app: RodokmenApp;
  let browser: Browser;
  let origin: string;
  let owner: Account;
  let relative: Account;
  const clock = new TestClock(new Date());
  const mailer = new OutboxMailer();
  const contexts: BrowserContext[] = [];

  async function phoneAs(member: Account, size: 'phone' | 'desktop' = 'phone'): Promise<Page> {
    const context = await browser.newContext({
      ...(size === 'phone'
        ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
        : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }),
      locale: 'en-GB',
      serviceWorkers: 'block',
    });
    contexts.push(context);
    await context.route(
      (url) => !url.href.startsWith(origin),
      (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }),
    );
    const token = (await signIn(t.db, clock, member)).split('=')[1]!;
    await context.addCookies([{ name: 'rdk_session', value: token, url: origin }]);
    return context.newPage();
  }

  const inject = async (member: Account, method: 'GET' | 'PUT' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie: await signIn(t.db, clock, member), origin }, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    t = await createTestDatabase();
    const port = await freePort();
    origin = `http://localhost:${port}`;
    app = await buildApp({ config: testConfig(t.url, { PUBLIC_ORIGIN: origin, APP_DIR: DEFAULT_APP_DIR }), db: t.db, mailer, clock });
    await app.listen({ host: 'localhost', port });
    owner = await ensureOwner(t.db);
    // The relative's account language is English: the app follows it (default-to-czech task 1.3).
    relative = await createMember(t.db, 'contributor', { displayName: 'Bohdana Invented', language: 'en' });
    browser = await chromium.launch();
    if (SHOTS) await mkdir(SHOTS, { recursive: true });
  }, 60_000);

  afterAll(async () => {
    for (const c of contexts) await c.close().catch(() => undefined);
    await browser?.close();
    await app?.close();
    await t?.drop();
  });

  it('new Member: once the Owner links them, the tree opens on their own Person, with the hourglass around it', async () => {
    // The relative is the proband's father: Bohumil Novák, with ancestors above and children below.
    const familyById = new Map(model.families.map((f) => [f.id, f]));
    const parentsOf = (id: string) =>
      model.childLinks
        .filter((l) => l.childId === id)
        .flatMap((l) => [familyById.get(l.familyId)!.partner1Id, familyById.get(l.familyId)!.partner2Id].filter((x) => x !== null));
    const own = parentsOf(L.proband).find((id) => model.persons.find((p) => p.id === id)?.sex === 'male')!;
    expect((await inject(owner, 'PUT', `/api/members/${relative.id}/person`, { personId: own })).statusCode).toBe(200);
    const page = await phoneAs(relative);
    await page.goto(`${origin}/`);
    await page.getByTestId('tree').waitFor();
    expect(await page.getByTestId('tree').getAttribute('data-focus')).toBe(own);
    expect(page.url()).toBe(`${origin}/#person-${own}`);
    expect(await page.locator('html').getAttribute('lang')).toBe('en');
    // 3 generations up and 2 down: the great-grandparents and the children are there.
    const greatGrandparents = parentsOf(own).flatMap(parentsOf).flatMap(parentsOf);
    expect(greatGrandparents.length).toBeGreaterThan(0);
    for (const id of [...greatGrandparents, L.proband]) expect(await page.locator(`[data-testid="tree-person"][data-person="${id}"]`).count(), id).toBe(1);
    await page.waitForTimeout(700);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/family-tree.png` });
  }, 60_000);

  it('second marriage on the fixture: Jan Novák with both wives beside him, each with their own children below', async () => {
    const page = await phoneAs(relative);
    await page.goto(`${origin}/#person-${L.janNovak}`);
    await page.getByTestId('tree').waitFor();
    const families = model.families.filter((f) => f.id === L.janFirstFamily || f.id === L.janSecondFamily);
    const y = async (id: string) => (await page.locator(`[data-testid="tree-person"][data-person="${id}"]`).boundingBox())!.y;
    const janY = await y(L.janNovak);
    for (const f of families) {
      const wife = f.partner1Id === L.janNovak ? f.partner2Id! : f.partner1Id!;
      expect(Math.abs((await y(wife)) - janY)).toBeLessThan(2);
      for (const l of model.childLinks.filter((x) => x.familyId === f.id)) expect(await y(l.childId)).toBeGreaterThan(janY);
    }
  }, 60_000);

  it('searching without diacritics: "dvorakova" finds Persons named Dvořáková with their life years; "Show in tree" opens the tree there', async () => {
    const page = await phoneAs(relative);
    await page.goto(`${origin}/#people`);
    await page.getByTestId('person-result').first().waitFor();
    await page.getByTestId('people-search').fill('dvorakova');
    // Once the search has answered (the full list shows until then), every result is a Dvořáková.
    await expect
      .poll(async () => {
        const all = await page.getByTestId('person-result').allTextContents();
        return all.length > 0 && all.every((x) => /Dvořáková|Dworzakowa/.test(x));
      })
      .toBe(true);
    const texts = await page.getByTestId('person-result').allTextContents();
    expect(texts.some((x) => /\d{4}/.test(x))).toBe(true);
    const first = page.getByTestId('person-result').first();
    const id = await first.getAttribute('data-id');
    await first.getByTestId('show-in-tree').click();
    await page.getByTestId('tree').waitFor();
    expect(await page.getByTestId('tree').getAttribute('data-focus')).toBe(id);
  }, 60_000);

  it('godparent role: the godmother of a baptism has it among her Events with the Role "Godparent"; the person page shows Names, Citations and Families', async () => {
    const godmother = model.roles.find(
      (r) => r.eventId === L.janBaptism && r.role === 'godparent' && model.persons.find((p) => p.id === r.personId)?.sex === 'female',
    )!;
    const page = await phoneAs(relative);
    await page.goto(`${origin}/#people/${godmother.personId}`);
    const baptism = page.locator(`[data-testid="person-event"][data-event="${L.janBaptism}"]`);
    await baptism.waitFor();
    expect(await baptism.getByTestId('role').textContent()).toBe('Godparent');

    await page.goto(`${origin}/#people/${L.janNovak}`);
    await page.getByTestId('person-title').waitFor();
    expect(await page.getByTestId('person-title').textContent()).toBe('Jan Novák');
    expect(await page.getByTestId('person-name').count()).toBeGreaterThanOrEqual(3);
    const own = page.locator(`[data-testid="person-event"][data-event="${L.janBaptism}"]`);
    expect(await own.getByTestId('role').textContent()).toBe('Child');
    expect(await own.getByTestId('confidence').first().textContent()).toMatch(/^confidence: /);
    expect(await page.getByTestId('family-as-partner').count()).toBe(2);
    await page.waitForTimeout(300);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/person-page.png` });
    // The Citation opens with its transcription and its page image.
    await own.getByTestId('citation').first().getByRole('button').click();
    await own.getByTestId('citation-detail').locator('blockquote').waitFor();
    expect(await own.getByTestId('citation-detail').locator('img').count()).toBe(1);
  }, 60_000);

  it('inviting a cousin: the Owner sends the invitation in the app and sees it pending until it is accepted', async () => {
    const page = await phoneAs(owner);
    await page.goto(`${origin}/#settings`);
    await page.getByTestId('invite-email').fill('cousin@example.test');
    await page.getByTestId('invite-language').selectOption('en');
    await page.getByTestId('send-invitation').click();
    await page.locator('[data-testid="invitation"][data-email="cousin@example.test"]').waitFor();
    // The Owner's account is in Czech, so the app is: "čeká na přijetí" is "pending".
    expect(await page.locator('[data-testid="invitation"][data-email="cousin@example.test"]').getByTestId('invitation-status').textContent()).toBe(
      'čeká na přijetí',
    );
    expect(mailer.lastTo('cousin@example.test')?.subject).toMatch(/Rodokmen/);
    // The Owner sees the relative's link to their Person.
    const row = page.locator(`[data-testid="member"][data-email="${relative.email}"]`);
    await row.waitFor();
    expect(await row.getByTestId('member-person').textContent()).toMatch(/Novák/);
  }, 60_000);

  it("Contributor's settings: their own language, sessions and passkeys, and nothing about other Members", async () => {
    const page = await phoneAs(relative);
    await page.goto(`${origin}/#settings`);
    await page.getByTestId('settings-sessions').getByTestId('session').first().waitFor();
    expect(await page.getByTestId('settings-language').count()).toBe(1);
    expect(await page.getByTestId('settings-passkeys').count()).toBe(1);
    expect(await page.getByTestId('settings-family').count()).toBe(0);
    expect(await page.getByText(owner.email ?? 'no email').count()).toBe(0);
  }, 60_000);

  it('family on the map: pins at the fixture villages, "Family here" in the place sheet, and a life path', async () => {
    const page = await phoneAs(relative);
    await page.goto(`${origin}/#map=14/49.93/15.91`);
    await page.getByTestId('family-pin').first().waitFor();
    // Most fixture Events are at Houses, so the pins are the Houses of the village.
    await page
      .getByTitle(/^Kamenná Lhota/)
      .first()
      .click();
    const here = page.locator('#place-sheet').getByTestId('family-here');
    await here.getByTestId('here-person').first().waitFor();
    expect(await here.textContent()).toContain('Jan Novák');
    expect(await page.locator('#place-sheet').getByTestId('open-scans').count()).toBe(1);

    await page.goto(`${origin}/#life/${L.janNovak}`);
    await page.locator('path.life-point').first().waitFor();
    expect(await page.locator('path.life-point').count()).toBeGreaterThanOrEqual(1);
    expect(await page.getByTestId('life-chip').textContent()).toContain('Jan Novák');
  }, 60_000);

  // ---------------------------------------------------------------- the relation to the family (2.4, 2a.5, 2a.6)

  it('Owner settings: until the first Family root the app shows everyone and asks the Owner to mark one; the Owner marks the founder', async () => {
    const page = await phoneAs(owner);
    await page.goto(`${origin}/#settings`);
    const section = page.getByTestId('settings-family-roots');
    await section.getByTestId('family-roots-prompt').waitFor();
    await section.getByTestId('family-root-add').click();
    await section.getByTestId('root-person-search').fill('Václav Novák');
    // The Owner's account is in Czech; the picker lists everyone, also before any relation is known.
    const founder = section
      .getByTestId('root-person-results')
      .getByRole('button')
      .filter({ hasText: /Václav Novák/ });
    await founder.first().waitFor();
    const ids = await t.db.selectFrom('name').select('person_id').where('given', '=', 'Václav').where('surname', '=', 'Novák').execute();
    expect(ids.map((i) => i.person_id)).toContain(L.founder);
    // Pick the founder himself: the one born about 1745.
    await founder.filter({ hasText: '1745' }).first().click();
    await section.locator(`[data-testid="family-root"][data-id="${L.founder}"]`).waitFor();
    expect(await section.getByTestId('family-roots-prompt').count()).toBe(0);
    // And his wife, through the API the app uses.
    const founding = model.families.find((f) => f.partner1Id === L.founder || f.partner2Id === L.founder)!;
    const wife = founding.partner1Id === L.founder ? founding.partner2Id! : founding.partner1Id!;
    expect((await inject(owner, 'PUT', `/api/persons/${wife}/family-root`, { familyRoot: true })).statusCode).toBe(200);
    const relations = await t.db.selectFrom('person').select('relation').distinct().execute();
    expect(relations.map((r) => r.relation).sort()).toEqual(['possible', 'relative', 'unrelated']);
  }, 60_000);

  for (const size of ['phone', 'desktop'] as const) {
    it(`not linked (${size}): a Member without a link, with nothing remembered, opens the tree on a Family root`, async () => {
      const unlinked = await createMember(t.db, 'contributor', { displayName: `Unlinked ${size}`, language: 'en' });
      const page = await phoneAs(unlinked, size);
      await page.goto(`${origin}/`);
      await page.getByTestId('tree').waitFor();
      expect(await page.getByTestId('tree').getAttribute('data-focus')).toBe(L.founder);
      expect(page.url()).toBe(`${origin}/#person-${L.founder}`);
    }, 60_000);

    it(`weak link (${size}): a Possible relative in view is marked as one, with the weak link drawn differently`, async () => {
      // A Possible relative whose own link to their parents is the weak one.
      const possible = (await t.db.selectFrom('person').select('id').where('relation', '=', 'possible').where('merged_into_id', 'is', null).execute()).map(
        (p) => p.id,
      );
      let chosen: string | null = null;
      for (const id of possible) {
        const tree = Hourglass.parse((await inject(relative, 'GET', `/api/persons/${id}/hourglass?up=3&down=2`)).json());
        if (tree.childLinks.some((l) => l.childId === id && l.weakLink)) {
          chosen = id;
          break;
        }
      }
      expect(chosen).not.toBeNull();
      const page = await phoneAs(relative, size);
      await page.goto(`${origin}/#person-${chosen}`);
      const node = page.locator(`[data-testid="tree-person"][data-person="${chosen}"]`);
      await node.waitFor();
      expect(await node.getAttribute('class')).toMatch(/possible/);
      expect(await node.getAttribute('aria-label')).toMatch(/possible relative/);
      expect(await node.getByTestId('possible-mark').count()).toBe(1);
      expect(await page.locator('.tree-lines .line.weak').count()).toBeGreaterThan(0);
      // Living people are marked too, wherever the tree shows one.
      for (const living of await page.locator('[data-testid="tree-person"].living').all()) expect(await living.textContent()).toMatch(/living/);
      await page.waitForTimeout(700);
      if (size === 'phone' && SHOTS) await page.screenshot({ path: `${SHOTS}/tree-relation.png` });
    }, 60_000);

    it(`village index entries (${size}): search lists only Relatives and Possible relatives until Unrelated people are switched on`, async () => {
      // An Unrelated person with a surname that relatives share.
      const unrelated = await t.db
        .selectFrom('person as p')
        .innerJoin('name as n', (j) => j.onRef('n.person_id', '=', 'p.id').on('n.is_primary', '=', true))
        .select(['p.id', 'n.surname'])
        .where('p.relation', '=', 'unrelated')
        .where('p.merged_into_id', 'is', null)
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('person as q')
              .innerJoin('name as m', (j) => j.onRef('m.person_id', '=', 'q.id').on('m.is_primary', '=', true))
              .select('q.id')
              .whereRef('m.surname', '=', 'n.surname')
              .where('q.relation', '!=', 'unrelated'),
          ),
        )
        .orderBy('p.id')
        .executeTakeFirstOrThrow();
      const page = await phoneAs(relative, size);
      await page.goto(`${origin}/#people`);
      await page.getByTestId('people-search').fill(unrelated.surname);
      // Once the search has answered (the whole list shows until then), every result has that surname in one of its Names.
      const fold = (x: string) => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      await expect
        .poll(async () => (await page.getByTestId('person-result').allTextContents()).every((x) => fold(x).includes(fold(unrelated.surname))))
        .toBe(true);
      expect(await page.getByTestId('person-result').count()).toBeGreaterThan(0);
      expect(await page.locator(`[data-testid="person-result"][data-id="${unrelated.id}"]`).count()).toBe(0);
      await page.getByTestId('include-unrelated').check();
      await page.locator(`[data-testid="person-result"][data-id="${unrelated.id}"]`).waitFor();
    }, 60_000);

    it(`busy village (${size}): family pins count Relatives and Possible relatives until the Member includes Unrelated people`, async () => {
      const page = await phoneAs(relative, size);
      await page.goto(`${origin}/#map=14/49.93/15.91`);
      await page.getByTestId('family-pin').first().waitFor();
      const people = async () =>
        (await page.getByTestId('family-pin').evaluateAll((pins) => pins.map((p) => Number(p.textContent)))).reduce((a, b) => a + b, 0);
      await expect.poll(people).toBeGreaterThan(0);
      const family = await people();
      await page.getByTestId('map-include-unrelated').check();
      await expect.poll(people).toBeGreaterThan(family);
    }, 60_000);
  }
});
