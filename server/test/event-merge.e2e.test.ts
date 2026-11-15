import { EventDetail, PersonDetail, ProposalView, type OperationInput } from '@rodokmen/shared';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type RodokmenApp } from '../src/app.js';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { OutboxMailer } from '../src/mail/mailer.js';
import { DEFAULT_APP_DIR } from '../src/routes/pages.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, freePort, signIn, TestClock, testConfig } from './helpers.js';
import { citation } from './proposal-testbed.js';

/**
 * Merging a duplicate Event from the person page (add-event-merge, #154) against the real server
 * and the invented fixture Tree, in Chromium at phone (390 × 844) and desktop (1280 × 800) size:
 * family-view "Merge duplicate Events from the person page" (the offer, both Events side by side,
 * the suggested Event to keep, the merge, a refusal after a change, no offer for a Contributor)
 * and the undo from the Person's history.
 */
const L = generateFixture().landmarks;
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
} as const;
type Size = keyof typeof VIEWPORTS;

describe('Merging duplicate Events in the app (Chromium, phone and desktop, fixture Tree)', () => {
  let t: TestDatabase;
  let app: RodokmenApp;
  let browser: Browser;
  let origin: string;
  let editor: Account;
  let karel: Account;
  const clock = new TestClock(new Date());
  const contexts: BrowserContext[] = [];

  /** A signed-in Member's browser at a size, with the app in English. */
  async function open(member: Account, size: Size, hash: string): Promise<Page> {
    const context = await browser.newContext({ ...VIEWPORTS[size], locale: 'en-GB', timezoneId: 'Europe/Prague', serviceWorkers: 'block' });
    contexts.push(context);
    await context.addInitScript(() => localStorage.setItem('rodokmen.language', 'en'));
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
  const event = async (id: string) => EventDetail.parse((await inject(editor, 'GET', `/api/events/${id}`)).json());

  /** Karel's Proposal, accepted by the Editor; returns the records it created, by table, in order. */
  async function accepted(operations: OperationInput[]): Promise<Record<'person' | 'event', string[]>> {
    const res = await inject(karel, 'POST', '/api/proposals', { formatVersion: 1, idempotencyKey: `e2e-${randomUUID()}`, note: null, operations });
    expect(res.statusCode, res.body).toBe(201);
    const id = ProposalView.parse(res.json()).id;
    expect((await inject(editor, 'POST', `/api/proposals/${id}/accept`, {})).statusCode).toBe(200);
    const created = await t.db
      .selectFrom('log_change as c')
      .innerJoin('log_entry as l', 'l.id', 'c.log_entry_id')
      .select(['c.record_table', 'c.record_id'])
      .where('l.proposal_id', '=', id)
      .where('c.before', 'is', null)
      .orderBy('c.seq')
      .execute();
    const of = (table: string) => created.filter((c) => c.record_table === table).map((c) => c.record_id);
    return { person: of('person'), event: of('event') };
  }

  /** A couple and their marriage twice, the first with both Citations (as after the importer's run of #158). */
  async function marriageTwice(tag: string) {
    const first = await accepted([
      { op: 'createPerson', tempId: 'tmp:a', sex: 'male', name: { given: 'Bohumil', surname: `Vymyšlený ${tag}`, type: 'birth', asFound: 'Bohumil' } },
      { op: 'createPerson', tempId: 'tmp:b', sex: 'female', name: { given: 'Ludmila', surname: `Vymyšlená ${tag}`, type: 'birth', asFound: 'Ludmila' } },
      { op: 'createEvent', tempId: 'tmp:m', type: 'marriage', date: '1801-11-20', placeId: L.kamennaLhota },
      { op: 'addRole', eventId: 'tmp:m', personId: 'tmp:a', role: 'partner' },
      { op: 'addRole', eventId: 'tmp:m', personId: 'tmp:b', role: 'partner' },
      ...citation('1'),
      { op: 'attachCitation', citationId: 'tmp:cit1', eventId: 'tmp:m' },
    ]);
    const [a, b] = [first.person[0]!, first.person[1]!];
    const kept = first.event[0]!;
    const second = await accepted([
      { op: 'createEvent', tempId: 'tmp:m', type: 'marriage', date: '1801-11-20', placeId: L.kamennaLhota },
      { op: 'addRole', eventId: 'tmp:m', personId: a, role: 'partner' },
      { op: 'addRole', eventId: 'tmp:m', personId: b, role: 'partner' },
      ...citation('2'),
      { op: 'attachCitation', citationId: 'tmp:cit2', eventId: 'tmp:m' },
      { op: 'attachCitation', citationId: 'tmp:cit2', eventId: kept, baseVersion: (await event(kept)).version },
    ]);
    return { a, b, kept, other: second.event[0]! };
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
    browser = await chromium.launch();
  }, 60_000);

  afterEach(async () => {
    for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
  });

  afterAll(async () => {
    await browser?.close();
    await app?.close();
    await t?.drop();
  });

  for (const size of ['phone', 'desktop'] as const) {
    it(`marriage recorded twice (${size}): the Editor merges it from the person page, sees one marriage with both Citations, and undoes it from the history`, async () => {
      const couple = await marriageTwice(size);
      const page = await open(editor, size, `#people/${couple.a}`);
      await page.getByTestId('person-event').nth(1).waitFor();
      expect(await page.getByTestId('person-event').count()).toBe(2);
      expect(await page.getByTestId('event-merge-open').count()).toBe(1);
      await page.getByTestId('event-merge-open').click();

      // Both Events side by side, the one with more Citations chosen to stay.
      const panel = page.getByTestId('event-merge');
      await panel.getByTestId('event-merge-first').waitFor();
      expect(await panel.getByTestId('event-merge-first').getAttribute('data-event')).toBe(couple.kept);
      expect(await panel.getByTestId('event-merge-first-keep').isChecked()).toBe(true);
      expect(await panel.getByTestId('event-merge-first-citations').textContent()).toBe('Citations: 2');
      expect(await panel.getByTestId('event-merge-second-citations').textContent()).toBe('Citations: 1');
      expect(await panel.getByTestId('event-merge-second').textContent()).toContain(`Ludmila Vymyšlená ${size} · Partner`);
      // Nothing runs off the side of the screen.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

      await panel.getByTestId('event-merge-note').fill('One marriage, in both spouses’ notes');
      await panel.getByTestId('event-merge-yes').click();
      await page.getByTestId('event-merge').waitFor({ state: 'detached' });
      expect(await page.getByTestId('person-event').count()).toBe(1);
      expect(await page.getByTestId('person-event').getAttribute('data-event')).toBe(couple.kept);
      expect(await page.getByTestId('person-event').getByTestId('citation').count()).toBe(2);
      expect(await page.getByTestId('event-merge-open').count()).toBe(0);

      // The merge is in the Person's history, and an Editor undoes it there.
      await page.getByTestId('history').click();
      await page.waitForURL(`${origin}/#work/history/person/${couple.a}`);
      const entry = page.getByTestId('history-entry').first();
      await entry.waitFor();
      expect(await entry.locator('.changes').textContent()).toContain('merges the marriage of 1801-11-20 into the marriage of 1801-11-20');
      const before = await page.getByTestId('history-entry').count();
      await entry.getByTestId('undo').click();
      await entry.getByTestId('confirm-undo').click();
      await page.getByTestId('history-entry').nth(before).waitFor();
      expect(await page.getByTestId('history-entry').first().locator('.card-head .chip').textContent()).toBe('undo');
      expect(PersonDetail.parse((await inject(editor, 'GET', `/api/persons/${couple.a}`)).json()).events).toHaveLength(2);
    });
  }

  it('refused after a change (desktop): the panel says one Event changed and shows both as they are now; merging again names the date', async () => {
    const couple = await marriageTwice('refused');
    const page = await open(editor, 'desktop', `#people/${couple.b}`);
    await page.getByTestId('event-merge-open').click();
    await page.getByTestId('event-merge-first').waitFor();
    // Another Editor dates the other marriage a day later, with its evidence.
    const other = await event(couple.other);
    const changed = await inject(editor, 'POST', '/api/proposals', {
      formatVersion: 1,
      idempotencyKey: `e2e-${randomUUID()}`,
      note: null,
      direct: true,
      operations: [
        ...citation('D'),
        { op: 'setField', record: 'event', id: couple.other, baseVersion: other.version, set: { date: '1801-11-21' } },
        { op: 'attachCitation', citationId: 'tmp:citD', eventId: couple.other, baseVersion: other.version },
      ],
    });
    expect(changed.statusCode, changed.body).toBe(201);

    await page.getByTestId('event-merge-yes').click();
    const status = page.getByTestId('event-merge-status');
    await status.filter({ hasText: 'changed meanwhile' }).waitFor();
    await page.getByTestId('event-merge-second').filter({ hasText: '1801-11-21' }).waitFor();
    await page.getByTestId('event-merge-yes').click();
    await status.filter({ hasText: "These Events can't be merged, they differ in: date." }).waitFor();
    expect(PersonDetail.parse((await inject(editor, 'GET', `/api/persons/${couple.b}`)).json()).events).toHaveLength(2);
  });

  it('a Contributor sees both marriages and no offer to merge them (phone)', async () => {
    const couple = await marriageTwice('contributor');
    const page = await open(karel, 'phone', `#people/${couple.a}`);
    await page.getByTestId('person-event').nth(1).waitFor();
    expect(await page.getByTestId('event-merge-open').count()).toBe(0);
  });
});
