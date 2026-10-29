import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type RodokmenApp } from '../src/app.js';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { OutboxMailer } from '../src/mail/mailer.js';
import { DEFAULT_APP_DIR } from '../src/routes/pages.js';
import { MemoryImageStorage } from '../src/storage/images.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, signIn, TestClock, testConfig } from './helpers.js';

/**
 * The app's Proposal screens against the real server and database, in Chromium at phone size
 * (390 × 844): the review queue, the baptism-entry form, offline Drafts with a retried submit,
 * and the author's view of a rejected Proposal. Object storage is in memory; its presigned
 * links point at /test-storage/ on the same server.
 */
const L = generateFixture().landmarks;
const SCREENSHOT = process.env.REVIEW_SCREENSHOT;
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

async function photo(text: string): Promise<Buffer> {
  // An invented "register page": ruled lines of scribbles under a heading.
  const lines = Array.from({ length: 22 }, (_, i) => `<path d="M90 ${300 + i * 56} q 120 -18 240 0 t 240 0 t 240 0 t 240 0" stroke="#4a3b28" stroke-width="5" fill="none"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><rect width="100%" height="100%" fill="#e9dfc7"/><rect x="40" y="40" width="1120" height="1520" fill="none" stroke="#8a7350" stroke-width="8"/><text x="90" y="200" font-size="72" fill="#3b2f1e">${text}</text>${lines}</svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

describe('Proposal screens in the app (Chromium, phone viewport)', () => {
  let t: TestDatabase;
  let app: RodokmenApp;
  let browser: Browser;
  let origin: string;
  let storage: MemoryImageStorage;
  let editor: Account;
  let contributor: Account;
  const clock = new TestClock(new Date());
  const mailer = new OutboxMailer();
  const contexts: BrowserContext[] = [];

  async function phoneAs(member: Account): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-GB', serviceWorkers: 'block' });
    contexts.push(context);
    // Map tiles and anything else off this server get a stub; nothing reaches the network.
    await context.route((url) => !url.href.startsWith(origin), (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));
    const token = (await signIn(t.db, clock, member)).split('=')[1]!;
    await context.addCookies([{ name: 'rdk_session', value: token, url: origin }]);
    const page = await context.newPage();
    return { context, page };
  }

  const inject = async (member: Account, method: 'POST' | 'GET', url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie: await signIn(t.db, clock, member), origin }, ...(payload ? { payload } : {}) });

  async function pendingProposal(member: Account, given: string, withImage = false): Promise<string> {
    const ops: object[] = [
      { op: 'createPerson', tempId: 'tmp:p', sex: 'female', name: { given, surname: 'Invented', type: 'birth', asFound: `${given} Invented` } },
      { op: 'createEvent', tempId: 'tmp:e', type: 'baptism', date: '1842-06-03', placeId: L.kamennaLhota },
      { op: 'addRole', eventId: 'tmp:e', personId: 'tmp:p', role: 'child' },
      { op: 'createSource', tempId: 'tmp:s', type: 'parish_register', title: 'Invented register N 1830–1850', repository: 'Invented archive' },
      { op: 'createCitation', tempId: 'tmp:c', sourceId: 'tmp:s', page: '41', transcription: `${given}, filia legitima, nata 2. Junii`, readOn: '2026-10-20', confidence: 'high' },
      { op: 'attachCitation', citationId: 'tmp:c', eventId: 'tmp:e' },
    ];
    if (withImage) {
      const body = await photo(`${given}, 1842`);
      const sha256 = createHash('sha256').update(body).digest('hex');
      const ticket = (await inject(member, 'POST', '/api/uploads', { contentType: 'image/jpeg', byteSize: body.length, sha256 })).json();
      await storage.put(`pending/${ticket.upload.id}/original`, body, 'image/jpeg');
      expect((await inject(member, 'POST', `/api/uploads/${ticket.upload.id}/complete`)).statusCode).toBe(200);
      ops.push({ op: 'addImage', uploadId: ticket.upload.id, kind: 'page', citationId: 'tmp:c' });
    }
    const res = await inject(member, 'POST', '/api/proposals', { formatVersion: 1, idempotencyKey: `e2e-${randomUUID()}`, note: `Baptism of ${given}, found in the 1842 register`, operations: ops });
    expect(res.statusCode, res.body).toBe(201);
    clock.advance(60_000);
    return res.json().id;
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    const port = await freePort();
    origin = `http://localhost:${port}`;
    storage = new MemoryImageStorage(clock, `${origin}/test-storage/`);
    app = await buildApp({
      config: testConfig(t.url, { PUBLIC_ORIGIN: origin, APP_DIR: DEFAULT_APP_DIR }),
      db: t.db,
      mailer,
      clock,
      images: storage,
      extraRoutes: (scope) => {
        scope.addContentTypeParser(['image/jpeg', 'image/png', 'image/webp', 'image/heic'], { parseAs: 'buffer', bodyLimit: 30 * 1024 * 1024 }, (_req, body, done) => done(null, body));
        scope.put('/test-storage/*', { schema: { hide: true } }, async (req, reply) => {
          const key = new URL(req.url, origin).pathname.replace('/test-storage/', '');
          await storage.put(key, req.body as Buffer, req.headers['content-type'] ?? 'application/octet-stream');
          return reply.code(200).send();
        });
        scope.get('/test-storage/*', { schema: { hide: true } }, async (req, reply) => {
          const key = new URL(req.url, origin).pathname.replace('/test-storage/', '');
          const object = storage.objects.get(key);
          if (!object) return reply.code(404).send();
          return reply.type(key.endsWith('.webp') ? 'image/webp' : object.contentType).send(object.body);
        });
      },
    });
    await app.listen({ host: 'localhost', port });
    await ensureOwner(t.db);
    editor = await createMember(t.db, 'editor', { displayName: 'Eva Editor', language: 'en' });
    contributor = await createMember(t.db, 'contributor', { displayName: 'Karel Contributor', language: 'en' });
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    for (const c of contexts) await c.close().catch(() => undefined);
    await browser?.close();
    await app?.close();
    await t?.drop();
  });

  it('review queue on a phone: three pending Proposals, oldest first, each with its author, changes and images; one tap accepts', async () => {
    const jana = await createMember(t.db, 'contributor', { displayName: 'Jana Contributor' });
    const ids = [await pendingProposal(contributor, 'Ludmila', true), await pendingProposal(jana, 'Barbora'), await pendingProposal(contributor, 'Kateřina')];
    const { page } = await phoneAs(editor);
    await page.goto(`${origin}/#work/review`);
    const cards = page.getByTestId('proposal');
    await expect.poll(() => cards.count()).toBe(3);
    expect(await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))).toEqual(ids);
    const first = cards.first();
    expect(await first.locator('.author').textContent()).toBe('Karel Contributor');
    expect(await cards.nth(1).locator('.author').textContent()).toBe('Jana Contributor');
    expect(await first.getByTestId('changes').textContent()).toContain('adds the Person Ludmila Invented');
    expect(await first.getByTestId('changes').textContent()).toContain('adds the baptism on 1842-06-03 at Kamenná Lhota');
    expect(await first.getByTestId('citation').textContent()).toContain('Ludmila, filia legitima');
    // The page image loads through an expiring link.
    await expect.poll(() => first.getByTestId('citation-image').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    expect(await page.getByTestId('agent-badge').count()).toBe(0);
    if (SCREENSHOT) {
      await mkdir(SCREENSHOT.replace(/\/[^/]+$/, ''), { recursive: true });
      await page.screenshot({ path: SCREENSHOT, scale: 'css' });
    }
    await first.getByTestId('accept').click();
    await expect.poll(() => cards.count()).toBe(2);
    expect((await inject(editor, 'GET', `/api/proposals/${ids[0]}`)).json().status).toBe('accepted');
  });

  it('baptism entry end to end: one Proposal adds the child and the baptism, links the parents\' Family and the godparents, and attaches the Citation with its page image', async () => {
    const family = await t.db.selectFrom('family').selectAll().where('id', '=', L.janFirstFamily).executeTakeFirstOrThrow();
    const names = await t.db.selectFrom('name').select(['person_id', 'given', 'surname']).where('is_primary', '=', true).where('person_id', 'in', [family.partner1_id!, family.partner2_id!]).execute();
    const nameOf = (id: string) => names.find((n) => n.person_id === id)!;
    const godparent = await t.db.selectFrom('name').select(['person_id', 'given', 'surname']).where('person_id', '=', L.founder).where('is_primary', '=', true).executeTakeFirstOrThrow();

    const { page } = await phoneAs(contributor);
    await page.goto(`${origin}/#work/propose`);
    await page.getByTestId('kind-baptism').click();
    const form = page.getByTestId('propose-form');
    await form.waitFor();
    await page.getByTestId('date').fill('1830-02-14');
    await page.getByTestId('place-search').fill('Kamenná');
    await page.getByTestId('place-results').getByRole('button', { name: /Kamenná Lhota/ }).first().click();
    await page.getByTestId('child-given').fill('Vojtěch');
    await page.getByTestId('child-surname').fill('Novák');
    await page.getByTestId('child-sex').selectOption('male');

    /** Picks a Person from the Tree by name, choosing the one with the given id. */
    const pick = async (testid: string, person: { person_id: string; given: string; surname: string }) => {
      await page.getByTestId(`${testid}-search`).fill(`${person.given} ${person.surname}`);
      const results = page.getByTestId(`${testid}-results`).getByRole('button');
      await results.first().waitFor();
      const hits = (await inject(contributor, 'GET', `/api/persons?q=${encodeURIComponent(`${person.given} ${person.surname}`)}&limit=8`)).json().items as Array<{ person: { id: string } }>;
      await results.nth(hits.findIndex((h) => h.person.id === person.person_id)).click();
      await page.getByTestId(`${testid}-picked`).waitFor();
    };
    await pick('father', nameOf(family.partner1_id!));
    await pick('mother', nameOf(family.partner2_id!));
    await page.getByTestId('godparent-add').click();
    await pick('godparent-0', godparent);
    await page.getByTestId('godparent-add').click();
    await page.getByTestId('godparent-1-new').click();
    await page.getByTestId('godparent-1-given').fill('Rozálie');
    await page.getByTestId('godparent-1-surname').fill('Invented');

    await page.getByTestId('source-title').fill('Invented register N 1825–1840');
    await page.getByTestId('repository').fill('Invented archive');
    await page.getByTestId('page').fill('58');
    await page.getByTestId('transcription').fill('Adalbertus, filius legitimus; patrini: …');
    await page.getByTestId('confidence').selectOption('high');
    await page.getByTestId('photo-input').setInputFiles({ name: 'register-page.jpg', mimeType: 'image/jpeg', buffer: await photo('Register page 58') });
    await expect.poll(() => page.getByTestId('photos').locator('img').count()).toBe(1);

    await page.getByTestId('submit').click();
    await page.waitForURL(/#work\/mine\//, { timeout: 15_000 });
    const proposalId = page.url().split('/').at(-1)!;
    await expect.poll(() => page.locator(`[data-id="${proposalId}"]`).getByTestId('status').textContent()).toBe('pending');

    const ops = (await t.db.selectFrom('proposal_operation').select('operation').where('proposal_id', '=', proposalId).orderBy('position').execute()).map((r) => r.operation as Record<string, any>);
    const roles = ops.filter((o) => o.op === 'addRole').map((o) => [o.role, o.personId]);
    const child = ops.find((o) => o.op === 'createPerson' && o.name.given === 'Vojtěch')!;
    const newGodparent = ops.find((o) => o.op === 'createPerson' && o.name.given === 'Rozálie')!;
    expect(roles).toEqual([
      ['child', child.tempId],
      ['father', family.partner1_id],
      ['mother', family.partner2_id],
      ['godparent', L.founder],
      ['godparent', newGodparent.tempId],
    ]);
    expect(ops.find((o) => o.op === 'createEvent')).toMatchObject({ type: 'baptism', date: '1830-02-14', placeId: L.kamennaLhota });
    expect(ops.find((o) => o.op === 'linkChild')).toMatchObject({ familyId: L.janFirstFamily, childId: child.tempId, linkType: 'birth', baseVersion: family.version });
    expect(ops.find((o) => o.op === 'createCitation')).toMatchObject({ page: '58', confidence: 'high' });
    const image = ops.find((o) => o.op === 'addImage')!;
    expect(image).toMatchObject({ kind: 'page' });
    expect(storage.objects.has(`pending/${image.uploadId}/display.webp`)).toBe(true);

    // Accepted, the Tree has it all.
    expect((await inject(editor, 'POST', `/api/proposals/${proposalId}/accept`, {})).statusCode).toBe(200);
    // The fixture has other men of this name; the child is the first Person the Proposal created.
    const childId = (
      await t.db
        .selectFrom('log_change as c')
        .innerJoin('log_entry as l', 'l.id', 'c.log_entry_id')
        .select('c.record_id')
        .where('l.proposal_id', '=', proposalId)
        .where('c.record_table', '=', 'person')
        .orderBy('c.seq')
        .executeTakeFirstOrThrow()
    ).record_id;
    const detail = (await inject(contributor, 'GET', `/api/persons/${childId}`)).json();
    expect(detail.familiesAsChild.map((f: { id: string }) => f.id)).toEqual([L.janFirstFamily]);
    const baptism = (await inject(contributor, 'GET', `/api/events/${detail.events[0].event.id}`)).json();
    expect(baptism.roles.map((r: { role: string }) => r.role)).toEqual(['child', 'father', 'mother', 'godparent', 'godparent']);
    const citation = (await inject(contributor, 'GET', `/api/citations/${baptism.citations[0].id}`)).json();
    expect(citation.images).toHaveLength(1);
  });

  it('in the reading room: two Drafts written offline survive closing the app; at home the app offers to submit them, and a retried submit creates one Proposal', async () => {
    const reader = await createMember(t.db, 'contributor', { displayName: 'Rita Reader' });
    const { context, page } = await phoneAs(reader);
    await page.goto(`${origin}/#work/drafts`);
    await page.getByTestId('tab-drafts').waitFor();
    await context.setOffline(true);

    // Draft 1: a burial, with a new Person typed in by hand (search needs a connection).
    await page.evaluate(() => (location.hash = '#work/propose/death'));
    await page.getByTestId('event-type').selectOption('burial');
    await page.getByTestId('date').fill('1866-03');
    await page.getByTestId('person-new').click();
    await page.getByTestId('person-given').fill('Apolena');
    await page.getByTestId('person-surname').fill('Invented');
    await page.getByTestId('source-title').fill('Invented burial register 1860–1880');
    await page.getByTestId('transcription').fill('Apollonia, vidua, sepulta');
    await page.getByTestId('save-draft').click();
    await expect.poll(() => page.getByTestId('form-status').textContent()).toBe('The Draft is saved on this device.');

    // Draft 2: a marriage, with a photo taken in the archive.
    await page.evaluate(() => (location.hash = '#work/propose/marriage'));
    await page.getByTestId('partner1-new').click();
    await page.getByTestId('partner1-given').fill('Šimon');
    await page.getByTestId('partner1-surname').fill('Invented');
    await page.getByTestId('partner2-new').click();
    await page.getByTestId('partner2-given').fill('Dorota');
    await page.getByTestId('partner2-surname').fill('Invented');
    await page.getByTestId('date').fill('1858-11-23');
    await page.getByTestId('source-title').fill('Invented marriage register 1850–1870');
    await page.getByTestId('transcription').fill('Simon et Dorothea, copulati');
    await page.getByTestId('photo-input').setInputFiles({ name: 'marriage.jpg', mimeType: 'image/jpeg', buffer: await photo('Marriage 1858') });
    await expect.poll(() => page.getByTestId('photos').locator('img').count()).toBe(1);
    await page.getByTestId('save-draft').click();
    await page.getByTestId('submit').click();
    await expect.poll(() => page.getByTestId('form-status').textContent()).toContain('You are offline');
    await page.close();

    // At home, online again: both Drafts are there and the app offers to submit them.
    await context.setOffline(false);
    const home = await context.newPage();
    await home.goto(`${origin}/`);
    await expect.poll(() => home.getByTestId('drafts-offer').textContent()).toBe('Drafts ready to submit: 2');
    await expect.poll(() => home.locator('#work-badge').textContent()).toBe('2');
    await home.getByTestId('drafts-offer').click();
    const drafts = home.getByTestId('draft');
    await expect.poll(() => drafts.count()).toBe(2);
    expect(await drafts.getByTestId('draft-title').allTextContents()).toEqual(['Marriage: Šimon Invented & Dorota Invented', 'Death or burial: Apolena Invented']);

    // The first submit reaches the server but the answer is lost on the way back.
    let interrupted = 0;
    await home.route(`${origin}/api/proposals`, async (route) => {
      if (route.request().method() !== 'POST' || interrupted > 0) return route.fallback();
      interrupted += 1;
      await route.fetch();
      await route.abort('connectionreset');
    });
    const marriage = drafts.first();
    await marriage.getByTestId('submit-draft').click();
    await expect.poll(() => marriage.locator('.form-status').textContent()).toContain('The submit was interrupted');
    const mine = () => t.db.selectFrom('proposal').select(['id', 'idempotency_key']).where('author_id', '=', reader.id).execute();
    expect(await mine()).toHaveLength(1);
    await marriage.getByTestId('submit-draft').click();
    await expect.poll(() => drafts.count()).toBe(1);
    expect(await mine()).toHaveLength(1);
    await drafts.first().getByTestId('submit-draft').click();
    await expect.poll(() => drafts.count()).toBe(0);
    const proposals = await mine();
    expect(proposals).toHaveLength(2);
    // The marriage Proposal carries its photo from the archive.
    const ops = await t.db.selectFrom('proposal_operation').select('op').where('proposal_id', 'in', proposals.map((p) => p.id)).execute();
    expect(ops.filter((o) => o.op === 'addImage')).toHaveLength(1);
  });

  it('the author sees a rejected Proposal with the Editor\'s note', async () => {
    const id = await pendingProposal(contributor, 'Markéta');
    expect((await inject(editor, 'POST', `/api/proposals/${id}/reject`, { note: 'wrong parish, see 1820 register' })).statusCode).toBe(200);
    const { page } = await phoneAs(contributor);
    await page.goto(`${origin}/#work/mine`);
    const card = page.locator(`[data-id="${id}"]`);
    await expect.poll(() => card.getByTestId('status').textContent()).toBe('rejected');
    expect(await card.getByTestId('decision-note').textContent()).toBe("Editor's note (Eva Editor): wrong parish, see 1820 register");
  });
});
