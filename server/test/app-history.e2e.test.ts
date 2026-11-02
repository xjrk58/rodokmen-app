import { PersonDetail, ProposalView, type OperationInput } from '@rodokmen/shared';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type RodokmenApp } from '../src/app.js';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { OutboxMailer } from '../src/mail/mailer.js';
import { DEFAULT_APP_DIR } from '../src/routes/pages.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, DAY, ensureOwner, freePort, MINUTE, signIn, TestClock, testConfig } from './helpers.js';
import { citation } from './proposal-testbed.js';

/**
 * The history and undo screens (`#work/history/person/<id>`) against the real server and the
 * invented fixture Tree, in Chromium at phone (390 × 844) and desktop (1280 × 800) size: the
 * tree-history scenarios "Person history", "Undo a wrong merge" and "Undo after later edits",
 * an undo from the screen, an undo refused while later Proposals depend on it
 * (`undo_blocked_by_dependents`), and no undo control for a Contributor (add-proposals-and-review
 * tasks 3.1 and 3.2, #31). Each test makes its own Persons, so the tests run in any order.
 */
const L = generateFixture().landmarks;
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
} as const;
type Size = keyof typeof VIEWPORTS;

/** An accepted Proposal: its id and when it was accepted. */
interface Accepted {
  id: string;
  at: Date;
}

describe('History and undo screens in the app (Chromium, phone and desktop, fixture Tree)', () => {
  let t: TestDatabase;
  let app: RodokmenApp;
  let browser: Browser;
  let origin: string;
  let editor: Account;
  let karel: Account;
  let jana: Account;
  let reader: Account;
  const clock = new TestClock(new Date());
  const contexts: BrowserContext[] = [];

  /** A signed-in Member's browser at a size, with the app in English. */
  async function open(member: Account, size: Size, hash: string): Promise<Page> {
    const context = await browser.newContext({ ...VIEWPORTS[size], locale: 'en-GB', timezoneId: 'Europe/Prague', serviceWorkers: 'block' });
    contexts.push(context);
    await context.addInitScript(() => localStorage.setItem('rodokmen.language', 'en'));
    // Map tiles and anything else off this server get a stub; nothing reaches the network.
    await context.route(
      (url) => !url.href.startsWith(origin),
      (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }),
    );
    const token = (await signIn(t.db, clock, member)).split('=')[1]!;
    await context.addCookies([{ name: 'rdk_session', value: token, url: origin }]);
    const page = await context.newPage();
    await page.goto(`${origin}/${hash}`);
    return page;
  }

  const inject = async (member: Account, method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie: await signIn(t.db, clock, member), origin }, ...(payload ? { payload } : {}) });

  const person = async (id: string) => PersonDetail.parse((await inject(reader, 'GET', `/api/persons/${id}`)).json());

  /**
   * A Proposal by the author, accepted by the Editor a day after the last one (an Editor's own
   * is a direct change), so each change has its own date.
   */
  async function accepted(author: Account, operations: OperationInput[]): Promise<Accepted> {
    clock.advance(DAY);
    const direct = author.id === editor.id;
    const res = await inject(author, 'POST', '/api/proposals', { formatVersion: 1, idempotencyKey: `e2e-${randomUUID()}`, note: null, direct, operations });
    expect(res.statusCode, res.body).toBe(201);
    const id = ProposalView.parse(res.json()).id;
    if (!direct) {
      clock.advance(17 * MINUTE);
      const accept = await inject(editor, 'POST', `/api/proposals/${id}/accept`, {});
      expect(accept.statusCode, accept.body).toBe(200);
    }
    return { id, at: clock.now() };
  }

  /** The records of a table an accepted Proposal created, in the order it created them. */
  const createdBy = async (proposalId: string, table: 'person' | 'name' | 'event') =>
    (
      await t.db
        .selectFrom('log_change as c')
        .innerJoin('log_entry as l', 'l.id', 'c.log_entry_id')
        .select('c.record_id')
        .where('l.proposal_id', '=', proposalId)
        .where('c.record_table', '=', table)
        .where('c.before', 'is', null)
        .orderBy('c.seq')
        .execute()
    ).map((r) => r.record_id);

  /** Karel's Proposal adding a baptised child to the Tree; returns the Person and the Proposal. */
  async function baptised(given: string, asFound: string): Promise<{ id: string; created: Accepted }> {
    const created = await accepted(karel, [
      { op: 'createPerson', tempId: 'tmp:p', sex: 'unknown', name: { given, surname: 'Invented', type: 'birth', asFound } },
      { op: 'createEvent', tempId: 'tmp:e', type: 'baptism', date: '1828-07-04', placeId: L.kamennaLhota },
      { op: 'addRole', eventId: 'tmp:e', personId: 'tmp:p', role: 'child' },
      ...citation('B'),
      { op: 'attachCitation', citationId: 'tmp:citB', eventId: 'tmp:e' },
    ]);
    const [id] = await createdBy(created.id, 'person');
    return { id: id!, created };
  }

  /** Jana's Proposal adding the Latin form of a Person's Name. */
  async function latinName(personId: string, given: string): Promise<Accepted> {
    const p = await person(personId);
    return accepted(jana, [
      ...citation('N'),
      { op: 'addName', personId, baseVersion: p.version, given, surname: 'Inventus', type: 'latin', asFound: `${given} Inventus` },
    ]);
  }

  const entries = (page: Page) => page.getByTestId('history-entry');
  const kindOf = (entry: Locator) => entry.locator('.card-head .chip');
  const dateOf = (entry: Locator) => entry.locator('.card-head .muted');

  /**
   * Waits for the history to show n entries and checks there are no more. The screen draws all
   * entries at once, and each undo adds one, so this also waits for the history drawn after an undo.
   */
  async function historyShows(page: Page, n: number) {
    await entries(page)
      .nth(n - 1)
      .waitFor();
    expect(await entries(page).count()).toBe(n);
  }

  /** Dates as the app shows them (formatDate in app/src/review.js), formatted in the page with the browser's own locale data. */
  const shownDates = (page: Page, dates: Date[]) =>
    page.evaluate(
      (isos) =>
        isos.map((iso) =>
          new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)),
        ),
      dates.map((d) => d.toISOString()),
    );

  /** Undoes a history entry nothing has changed since: one tap on Undo, one on the confirmation. */
  async function undoPlain(page: Page, entry: Locator) {
    const before = await entries(page).count();
    await entry.getByTestId('undo').click();
    await entry.getByTestId('confirm-undo').waitFor();
    expect(await entry.locator('.undo-box').textContent()).toContain('The changes are taken back at once and the undo is logged.');
    expect(await entry.getByTestId('later-edit').count()).toBe(0);
    await entry.getByTestId('confirm-undo').click();
    await historyShows(page, before + 1);
    expect(await kindOf(entries(page).first()).textContent()).toBe('undo');
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    const port = await freePort();
    origin = `http://localhost:${port}`;
    app = await buildApp({ config: testConfig(t.url, { PUBLIC_ORIGIN: origin, APP_DIR: DEFAULT_APP_DIR }), db: t.db, mailer: new OutboxMailer(), clock });
    await app.listen({ host: 'localhost', port });
    await ensureOwner(t.db);
    editor = await createMember(t.db, 'editor', { displayName: 'Eva Editor', language: 'en' });
    karel = await createMember(t.db, 'contributor', { displayName: 'Karel Contributor', language: 'en' });
    jana = await createMember(t.db, 'contributor', { displayName: 'Jana Contributor', language: 'en' });
    reader = await createMember(t.db, 'contributor', { displayName: 'Rita Reader', language: 'en' });
    browser = await chromium.launch();
  }, 60_000);

  // Each test closes its browsers, so a test never runs beside the open pages of earlier ones.
  afterEach(async () => {
    for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
  });

  afterAll(async () => {
    await browser?.close();
    await app?.close();
    await t?.drop();
  });

  for (const size of ['phone', 'desktop'] as const) {
    it(`Person history (${size}): a Member opens it from the person page and sees each accepted change, newest first, with author and date`, async () => {
      const hedvika = await baptised('Hedvika', `Hedvika Invented ${size}`);
      const latin = await latinName(hedvika.id, 'Hedwigis');
      const sex = await accepted(editor, [
        ...citation('S'),
        { op: 'setField', record: 'person', id: hedvika.id, baseVersion: (await person(hedvika.id)).version, set: { sex: 'female' } },
      ]);

      const page = await open(reader, size, `#people/${hedvika.id}`);
      await page.getByTestId('history').click();
      await page.waitForURL(`${origin}/#work/history/person/${hedvika.id}`);
      await historyShows(page, 3);
      expect(await entries(page).getByTestId('history-by').allTextContents()).toEqual([
        'By Eva Editor · accepted by Eva Editor',
        'By Jana Contributor · accepted by Eva Editor',
        'By Karel Contributor · accepted by Eva Editor',
      ]);
      expect(await kindOf(entries(page)).allTextContents()).toEqual(['direct change', 'Proposal', 'Proposal']);
      // Each with the date it was accepted.
      expect(await dateOf(entries(page)).allTextContents()).toEqual(await shownDates(page, [sex.at, latin.at, hedvika.created.at]));
      expect(await entries(page).nth(0).locator('.changes').textContent()).toContain('changes Hedvika Invented (Person): sex → “female”');
      expect(await entries(page).nth(1).locator('.changes').textContent()).toContain('adds the Name “Hedwigis Inventus” (Latin form) to Hedvika Invented');
      expect(await entries(page).nth(2).locator('.changes').textContent()).toContain('adds the Person Hedvika Invented');
      expect(await entries(page).nth(2).textContent()).toContain('Evidence: Invented register B, 17');
      // Nothing runs off the side of the screen.
      expect(await page.locator('#work-body').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    });

    it(`undo from the screen (${size}): the Editor undoes an accepted Proposal; the change is gone and the history shows the undo`, async () => {
      const kristian = await baptised('Kristián', `Kristián Invented ${size}`);
      await latinName(kristian.id, 'Christianus');
      expect((await person(kristian.id)).names).toHaveLength(2);

      const page = await open(editor, size, `#work/history/person/${kristian.id}`);
      await historyShows(page, 2);
      expect(await entries(page).getByTestId('undo').count()).toBe(2);
      await undoPlain(page, entries(page).first());

      const [undo, latin, created] = [0, 1, 2].map((i) => entries(page).nth(i));
      expect(await undo!.getByTestId('history-by').textContent()).toBe('By Eva Editor · accepted by Eva Editor');
      expect(await latin!.locator('.status-rejected').textContent()).toBe('undone');
      expect(await latin!.getByTestId('undo').count()).toBe(0);
      expect(await created!.locator('.status-rejected').count()).toBe(0);
      expect(await created!.getByTestId('undo').count()).toBe(1);
      // The undo itself is logged and could be undone in turn.
      expect(await undo!.getByTestId('undo').count()).toBe(1);

      // The Latin Name is gone from the Tree and from the person page.
      expect((await person(kristian.id)).names.map((n) => n.asFound)).toEqual([`Kristián Invented ${size}`]);
      await page.goto(`${origin}/#people/${kristian.id}`);
      await page.getByTestId('person-title').waitFor();
      expect(await page.getByTestId('person-name').allTextContents()).toEqual([expect.stringContaining(`Kristián Invented ${size}`)]);
    });

    it(`undo after later edits (${size}): the Editor sees the later edits and chooses for each field before the undo completes`, async () => {
      const v = await baptised('Věnceslava', `Wenceslava ${size}`);
      const [nameId] = await createdBy(v.created.id, 'name');
      const nameVersion = async () => (await person(v.id)).names.find((n) => n.id === nameId)!.version;
      // A first change sets the sex and the surname …
      const fix = await accepted(editor, [
        ...citation('V'),
        { op: 'setField', record: 'person', id: v.id, baseVersion: (await person(v.id)).version, set: { sex: 'female' } },
        { op: 'setField', record: 'name', id: nameId!, baseVersion: await nameVersion(), set: { surname: 'Invented-Nová' } },
      ]);
      // … and a later one edits the Name again.
      await accepted(editor, [
        ...citation('W'),
        { op: 'setField', record: 'name', id: nameId!, baseVersion: await nameVersion(), set: { surname: 'Nová', given: 'Venceslava' } },
      ]);

      const page = await open(editor, size, `#work/history/person/${v.id}`);
      await historyShows(page, 3);
      const entry = entries(page).nth(1);
      expect([await dateOf(entry).textContent()]).toEqual(await shownDates(page, [fix.at]));
      await entry.getByTestId('undo').click();
      const later = entry.getByTestId('later-edit');
      await later.waitFor();
      expect(await entry.locator('.undo-box').textContent()).toContain('Some records were changed again since. Choose for each value:');
      expect(await later.count()).toBe(1);
      expect(await later.locator('p').first().textContent()).toBe(`Edited later: “Wenceslava ${size}”`);
      expect(await later.getByTestId('later-field').allTextContents()).toEqual(['given names', 'surname']);
      const choice = async (testid: string) => (await later.getByTestId(testid).locator('xpath=..').textContent())?.trim();
      expect(await choice('undo-undo-given')).toBe('undo to: Věnceslava');
      expect(await choice('undo-keep-given')).toBe('keep: Venceslava');
      expect(await choice('undo-undo-surname')).toBe('undo to: Invented');
      expect(await choice('undo-keep-surname')).toBe('keep: Nová');

      // Without a choice for each field the undo does not happen.
      await entry.getByTestId('confirm-undo').click();
      await entry.locator('.undo-box .form-status.error').waitFor();
      expect(await entry.locator('.undo-box .form-status.error').textContent()).toContain('Choose per field before undoing.');
      expect((await person(v.id)).sex).toBe('female');

      await later.getByTestId('undo-keep-given').check();
      await later.getByTestId('undo-undo-surname').check();
      await entry.getByTestId('confirm-undo').click();
      await historyShows(page, 4);
      expect(await kindOf(entries(page).first()).textContent()).toBe('undo');
      expect(await entries(page).nth(2).locator('.status-rejected').textContent()).toBe('undone');
      const after = await person(v.id);
      expect(after.sex).toBe('unknown');
      expect(after.names).toEqual([expect.objectContaining({ given: 'Venceslava', surname: 'Invented' })]);
    });

    it(`undo refused by dependents (${size}): while a later Proposal builds on its records the screen refuses; undoing that one first, the undo works`, async () => {
      const prokop = await baptised('Prokop', `Procopius ${size}`);
      await latinName(prokop.id, 'Procopius');

      const page = await open(editor, size, `#work/history/person/${prokop.id}`);
      await historyShows(page, 2);
      const first = entries(page).nth(1);
      await first.getByTestId('undo').click();
      await first.getByTestId('undo-blocked').waitFor();
      expect(await first.getByTestId('undo-blocked').textContent()).toBe(
        'This cannot be undone on its own: later accepted Proposals (1) build on its records. Undo those first, newest first.',
      );
      expect(await first.getByTestId('confirm-undo').count()).toBe(0);
      expect((await person(prokop.id)).names).toHaveLength(2);

      // The later Proposal first, then the first one.
      await undoPlain(page, entries(page).first());
      await undoPlain(page, entries(page).nth(2));
      expect(await kindOf(entries(page)).allTextContents()).toEqual(['undo', 'undo', 'Proposal', 'Proposal']);
      expect((await inject(reader, 'GET', `/api/persons/${prokop.id}`)).statusCode).toBe(404);
    });

    // fixme(#73): the screen gives only the number of the later Proposals, not which they are.
    it.skip(`undo refused by dependents (${size}): the screen names the later Proposals to undo first (fixme #73)`, async () => {
      const prokop = await baptised('Prokop', `Prokopius ${size}`);
      const latin = await latinName(prokop.id, 'Prokopius');

      const page = await open(editor, size, `#work/history/person/${prokop.id}`);
      await historyShows(page, 2);
      const first = entries(page).nth(1);
      await first.getByTestId('undo').click();
      await first.getByTestId('undo-blocked').waitFor();
      const blockers = first.getByTestId('undo-blocker');
      expect(await blockers.evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))).toEqual([latin.id]);
      const text = await blockers.first().textContent();
      expect(text).toContain('Jana Contributor');
      expect(text).toContain('adds the Name “Prokopius Inventus” (Latin form) to Prokop Invented');
    });

    it(`after an undo (${size}): the history still names the records the undo removed (#74)`, async () => {
      const kristyna = await baptised('Kristýna', `Kristýna Invented ${size}`);
      await latinName(kristyna.id, 'Christina');
      const page = await open(editor, size, `#work/history/person/${kristyna.id}`);
      await historyShows(page, 2);
      await undoPlain(page, entries(page).first());
      await undoPlain(page, entries(page).nth(2));
      // Newest first: the undo of the Person's baptism, the undo of the Latin Name, the Latin Name, the baptism.
      const said = await entries(page).locator('.changes').allTextContents();
      expect(said[0]).toContain(`Kristýna Invented ${size}`);
      expect(said[0]).toContain('removes the Person Kristýna Invented');
      expect(said[1]).toContain('“Christina Inventus”');
      // The Person is gone too, and the earlier entries still name her.
      expect(said[2]).toContain('adds the Name “Christina Inventus” (Latin form) to Kristýna Invented');
      expect(said.join('\n')).not.toMatch(/record [0-9a-f]{6}/);
    });

    it(`undo a wrong merge (${size}): both Persons exist again with their own Events, and the history shows the undo`, async () => {
      const both = await accepted(karel, [
        { op: 'createPerson', tempId: 'tmp:a', sex: 'male', name: { given: 'Matěj', surname: 'Invented', type: 'birth', asFound: `Mathias Inventus ${size}` } },
        { op: 'createEvent', tempId: 'tmp:bap', type: 'baptism', date: '1812-02-11', placeId: L.kamennaLhota },
        { op: 'addRole', eventId: 'tmp:bap', personId: 'tmp:a', role: 'child' },
        {
          op: 'createPerson',
          tempId: 'tmp:b',
          sex: 'male',
          name: { given: 'Matěj', surname: 'Invented', type: 'birth', asFound: `Matthäus Invented ${size}` },
        },
        { op: 'createEvent', tempId: 'tmp:mar', type: 'marriage', date: '1836-01-20', placeId: L.kamennaLhota },
        { op: 'addRole', eventId: 'tmp:mar', personId: 'tmp:b', role: 'partner' },
        ...citation('M'),
        { op: 'attachCitation', citationId: 'tmp:citM', eventId: 'tmp:bap' },
      ]);
      const [kept, gone] = await createdBy(both.id, 'person');
      const [baptism, marriage] = await createdBy(both.id, 'event');
      clock.advance(DAY);
      const merge = await inject(editor, 'POST', `/api/persons/${kept}/merge`, {
        mergeId: gone,
        keepBaseVersion: (await person(kept!)).version,
        mergeBaseVersion: (await person(gone!)).version,
        note: 'Same man',
      });
      expect(merge.statusCode, merge.body).toBe(200);
      expect((await inject(reader, 'GET', `/api/persons/${gone}`)).statusCode).toBe(308);

      const page = await open(editor, size, `#work/history/person/${gone}`);
      await historyShows(page, 2);
      expect(await kindOf(entries(page)).allTextContents()).toEqual(['direct change', 'Proposal']);
      expect(await entries(page).first().locator('.changes').textContent()).toContain('merges Matěj Invented (merged Person) into Matěj Invented');
      await undoPlain(page, entries(page).first());
      expect(await entries(page).nth(1).locator('.status-rejected').textContent()).toBe('undone');

      // Each man is back with his own Event, on his own person page.
      for (const [id, event] of [
        [kept, baptism],
        [gone, marriage],
      ] as const) {
        await page.goto(`${origin}/#people/${id}`);
        await page.locator(`[data-testid="person-screen"][data-id="${id}"]`).waitFor();
        expect(await page.getByTestId('person-event').evaluateAll((els) => els.map((e) => e.getAttribute('data-event')))).toEqual([event]);
      }
    });

    it(`a Contributor (${size}) sees the history but gets no undo control`, async () => {
      const ludmila = await baptised('Ludmila', `Ludmilla ${size}`);
      await latinName(ludmila.id, 'Ludmilla');

      const page = await open(karel, size, `#work/history/person/${ludmila.id}`);
      await historyShows(page, 2);
      expect(await entries(page).getByTestId('history-by').allTextContents()).toEqual([
        'By Jana Contributor · accepted by Eva Editor',
        'By Karel Contributor · accepted by Eva Editor',
      ]);
      expect(await page.getByTestId('undo').count()).toBe(0);
      expect(await page.locator('.undo-box').evaluateAll((els) => els.map((e) => e.childElementCount))).toEqual([0, 0]);
      expect(await page.getByTestId('tab-history').getAttribute('aria-current')).toBe('page');
      expect(await page.getByTestId('tab-review').count()).toBe(0);
    });
  }
});
