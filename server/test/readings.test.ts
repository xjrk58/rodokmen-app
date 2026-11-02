import { ApiError, PORTAL_LINK_MESSAGE, RateLimited, ReadingStatusView, ReadingView, ScanReadingSettings, UploadTicket } from '@rodokmen/shared';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { MAX_TOKENS, READING_FORMAT, SYSTEM_PROMPT } from '../src/readings/reader.js';
import { endOfPragueDay } from '../src/readings/settings.js';
import { DISPLAY_MAX_PIXELS } from '../src/storage/process.js';
import { recording } from './fake-anthropic.js';
import { bearer, createAgentWithToken, makeApp, signIn, TestClock } from './helpers.js';
import { imagesIn, page, useReadingWorld } from './reading-world.js';

const L = generateFixture().landmarks;

/**
 * Scan reading on the server (scan-reading and evidence-media specs; add-scan-reading tasks 1.3
 * to 1.5): the Owner's switch and the daily limit, the reading job against recorded answers of
 * the Messages API, what is sent, and archive links.
 */
describe('scan reading (scan-reading and evidence-media specs)', () => {
  const world = useReadingWorld();
  let t: ReturnType<typeof world>['t'];
  let app: ReturnType<typeof world>['app'];
  let api: ReturnType<typeof world>['api'];
  let storage: ReturnType<typeof world>['storage'];
  let clock: TestClock;
  let owner: Account;
  let contributor: Account;
  let editor: Account;
  let as: ReturnType<typeof world>['as'];
  let upload: ReturnType<typeof world>['upload'];
  let setSwitch: ReturnType<typeof world>['setSwitch'];
  let read: ReturnType<typeof world>['read'];
  beforeEach(() => {
    ({ t, app, api, storage, clock, owner, contributor, editor, as, upload, setSwitch, read } = world());
  });

  describe('the Owner switches it on (task 1.4)', () => {
    it('is off until the Owner switches it on: the routes answer 404, nothing is read and nothing is sent (scenario "Switched off")', async () => {
      await setSwitch(false);
      const scan = await upload(contributor, await page());
      expect((await as(contributor, 'GET', '/api/readings/status')).statusCode).toBe(404);
      const res = await as(contributor, 'POST', '/api/readings', { uploadIds: [scan] });
      expect(res.statusCode).toBe(404);
      await app.readingJobs.idle();
      expect(await t.db.selectFrom('reading').selectAll().execute()).toEqual([]);
      expect(api.requests).toEqual([]);
    });

    it('sends nothing for a reading queued before the switch went off (evidence-media scenario "Switched off")', async () => {
      const scan = await upload(contributor, await page());
      const row = await t.db
        .insertInto('reading')
        .values({ author_id: contributor.id, upload_ids: [scan], crops: '[]', context: '{}', day: '2026-11-02' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await setSwitch(false);
      app.readingJobs.enqueue(row.id);
      await app.readingJobs.idle();
      const r = await t.db.selectFrom('reading').selectAll().where('id', '=', row.id).executeTakeFirstOrThrow();
      expect([r.status, r.error_code]).toEqual(['failed', 'switched_off']);
      expect(api.requests).toEqual([]);
    });

    it('only the Owner switches it and sets the limit; the switch says scans go to Anthropic; it needs an API key', async () => {
      for (const who of [contributor, editor])
        expect((await as(who, 'PUT', '/api/settings/scan-reading', { enabled: true, dailyLimit: 5 })).statusCode).toBe(403);
      const { token } = await createAgentWithToken(t.db, clock, 'Settings tester');
      expect(
        (await app.inject({ method: 'PUT', url: '/api/settings/scan-reading', headers: bearer(token), payload: { enabled: true, dailyLimit: 5 } })).statusCode,
      ).toBe(403);
      const settings = ScanReadingSettings.parse((await as(owner, 'GET', '/api/settings/scan-reading')).json());
      expect(settings).toMatchObject({ enabled: true, dailyLimit: 10, configured: true, model: 'claude-opus-5-5', changedBy: 'Owner Example' });
      const openapi = JSON.stringify(app.swagger());
      expect(openapi).toContain('scans are sent to Anthropic’s API to be read');

      const keyless = await makeApp(t, { clock, reader: null });
      try {
        const res = await keyless.app.inject({
          method: 'PUT',
          url: '/api/settings/scan-reading',
          headers: { cookie: await signIn(t.db, clock, owner), origin: 'http://localhost:3000' },
          payload: { enabled: true, dailyLimit: 5 },
        });
        expect([res.statusCode, ApiError.parse(res.json()).code]).toEqual([409, 'not_configured']);
        // And with a key-less server, scan reading is off for everyone whatever the setting says.
        expect(
          (await keyless.app.inject({ method: 'GET', url: '/api/readings/status', headers: { cookie: await signIn(t.db, clock, contributor) } })).statusCode,
        ).toBe(404);
      } finally {
        await keyless.app.close();
      }
    });

    it('refuses a reading beyond the daily limit until the next day, and the forms by hand still work (scenario "Daily limit"); the Owner sees the usage', async () => {
      await setSwitch(true, 2);
      const scan = await upload(contributor, await page());
      for (let i = 0; i < 2; i++) expect((await as(contributor, 'POST', '/api/readings', { uploadIds: [scan] })).statusCode).toBe(202);
      await app.readingJobs.idle();
      expect(ReadingStatusView.parse((await as(contributor, 'GET', '/api/readings/status')).json())).toEqual({ dailyLimit: 2, usedToday: 2, remaining: 0 });
      const refused = await as(contributor, 'POST', '/api/readings', { uploadIds: [scan] });
      expect(refused.statusCode).toBe(429);
      expect(RateLimited.parse(refused.json())).toMatchObject({ code: 'daily_limit', retryAt: '2026-11-02T23:00:00.000Z' });
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
      expect(api.requests).toHaveLength(2);
      // Another Member has their own limit.
      expect((await as(editor, 'POST', '/api/readings', { uploadIds: [await upload(editor, await page())] })).statusCode).toBe(202);
      // The form by hand: a Proposal without reading is still accepted.
      const byHand = await as(contributor, 'POST', '/api/proposals', {
        formatVersion: 1,
        idempotencyKey: `hand-${randomUUID()}`,
        operations: [
          { op: 'createSource', tempId: 'tmp:s', type: 'parish_register', title: 'Invented register' },
          { op: 'createCitation', tempId: 'tmp:c', sourceId: 'tmp:s', transcription: 'Anna nata', readOn: '2026-11-02', confidence: 'normal' },
          { op: 'attachCitation', citationId: 'tmp:c', eventId: L.janBaptism, baseVersion: 1 },
        ],
      });
      expect(byHand.statusCode, byHand.body).toBe(201);
      const usage = ScanReadingSettings.parse((await as(owner, 'GET', '/api/settings/scan-reading')).json()).usage;
      expect(usage).toContainEqual({
        day: '2026-11-02',
        author: { id: contributor.id, displayName: 'Karel Contributor', isAgent: false },
        readings: 2,
        failed: 0,
      });
      // The next day in Prague, reading works again.
      const tomorrow = new TestClock(new Date(endOfPragueDay('2026-11-02').getTime() + 60_000));
      clock.current = tomorrow.now();
      try {
        expect((await as(contributor, 'POST', '/api/readings', { uploadIds: [scan] })).statusCode).toBe(202);
      } finally {
        clock.current = new Date('2026-11-02T09:00:00Z');
      }
      await app.readingJobs.idle();
    });

    it('counts the day in Prague: a day ends at midnight there, in summer and in winter', () => {
      expect(endOfPragueDay('2026-11-02').toISOString()).toBe('2026-11-02T23:00:00.000Z');
      expect(endOfPragueDay('2026-07-14').toISOString()).toBe('2026-07-14T22:00:00.000Z');
      expect(endOfPragueDay('2026-03-28').toISOString()).toBe('2026-03-28T23:00:00.000Z');
    });
  });

  describe('the reading job (task 1.3)', () => {
    it('reads a page with three baptism entries into entries with their Roles, dates, houses and transcription (scenario "Baptism page")', async () => {
      const scan = await upload(contributor, await page());
      const reading = await read(contributor, {
        uploadIds: [scan],
        context: { placeId: L.kamennaLhota, sourceTitle: 'Invented register N 1820–1840', page: '41', years: { from: 1830, to: 1830 } },
      });
      expect(reading.status).toBe('done');
      const r = reading.result!;
      expect(r.entries).toHaveLength(3);
      for (const e of r.entries) {
        expect(e.type).toBe('baptism');
        expect(e.persons.map((p) => p.role)).toEqual(['child', 'father', 'mother', 'godparent', 'priest']);
        expect(e.transcription).toMatch(/baptizat/);
      }
      expect(r.entries.map((e) => [e.date, e.house])).toEqual([
        ['1830-03-14', '15'],
        ['1830-05-02', '23'],
        ['1830-06-20', null],
      ]);
      expect(r.pages[0]!.transcription).toContain('Anno 1830');
      expect(reading.model).toBe('claude-opus-5-5');
      // House A of Kamenná Lhota carried čp. 15 in 1830.
      expect(reading.houses).toEqual([L.houseA, null, null]);
      // The request: the configured model, structured output in the reading schema, adaptive thinking and the fallback.
      const sent = api.requests[0]!;
      expect(sent.url).toBe('https://api.anthropic.com/v1/messages');
      // The key is the server's own, from its environment (here the placeholder of the tests).
      expect(sent.headers['x-api-key'] ?? sent.headers.authorization).toContain('test-key');
      expect(sent.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
      expect(sent.body).toMatchObject({ model: 'claude-opus-5-5', max_tokens: MAX_TOKENS, fallbacks: 'default', thinking: { type: 'adaptive' } });
      expect(sent.body.output_config).toEqual({ effort: 'high', format: READING_FORMAT });
      expect(sent.body.system![0]!.text).toBe(SYSTEM_PROMPT);
      const context = sent.body.messages[0]!.content.at(-1)!.text!;
      expect(context).toContain('- Register: Invented register N 1820–1840');
      expect(context).toContain('- Place: Kamenná Lhota (Parish: Farnost Dolní Kamenec, later Farnost Vrbice)');
      expect(context).toMatch(/Surnames: .*Novák/);
      // Names only: no dates or house numbers of the Tree go out.
      expect(context).not.toMatch(/18\d\d-\d\d|čp\./);
    });

    it('suggests Jan Novák for "Joannes Nowak, colonus N. 15" with the reasons, and his wife for the mother', async () => {
      const reading = await read(contributor, { uploadIds: [await upload(contributor, await page())], context: { placeId: L.kamennaLhota } });
      const father = reading.matches.find((m) => m.key === 'p2')!;
      expect(father.candidates[0]).toMatchObject({ person: { id: L.janNovak }, reasons: { name: true, house: true, years: true, place: true, family: true } });
      const mother = reading.matches.find((m) => m.key === 'p3')!;
      expect(mother.candidates[0]!.person.displayName).toMatch(/^Kateřina /);
      expect(mother.candidates[0]!.reasons.family).toBe(true);
      // Nobody is suggested for a name the Tree does not have.
      expect(reading.matches.find((m) => m.key === 'p12')!.candidates).toEqual([]);
    });

    it('leaves an illegible house number empty with a note (scenario "Faded house number")', async () => {
      api.answers.splice(0, 1, recording('faded-house'));
      const reading = await read(contributor, { uploadIds: [await upload(contributor, await page())] });
      const entry = reading.result!.entries[0]!;
      expect(entry.house).toBeNull();
      expect(entry.illegible).toEqual([{ field: 'house', note: 'the house number is faded' }]);
    });

    it('fails a reading that does not match the schema, or that the model declined, and never repairs it', async () => {
      api.answers.splice(0, 1, recording('invalid-date'), recording('refusal'), { status: 529, error: { type: 'overloaded_error', message: 'Overloaded' } });
      const scan = await upload(contributor, await page());
      const invalid = await read(contributor, { uploadIds: [scan] });
      expect(invalid.status).toBe('failed');
      expect(invalid.result).toBeNull();
      expect(invalid.error!.code).toBe('invalid_result');
      expect(invalid.error!.message).toMatch(/entries\.0\.date/);
      const refused = await read(contributor, { uploadIds: [scan] });
      expect(refused.error!.code).toBe('refused');
      const busy = await read(contributor, { uploadIds: [scan] });
      expect(busy.error!.code).toBe('reader_error');
    });

    it('lets an Agent ask for a reading of a scan it uploaded, within the same limits', async () => {
      const { agent, token } = await createAgentWithToken(t.db, clock, 'Reading agent');
      const body = await page();
      const ticket = UploadTicket.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/api/uploads',
            headers: bearer(token),
            payload: { contentType: 'image/jpeg', byteSize: body.length, sha256: createHash('sha256').update(body).digest('hex') },
          })
        ).json(),
      );
      await storage.put(`pending/${ticket.upload.id}/original`, body, 'image/jpeg');
      expect((await app.inject({ method: 'POST', url: `/api/uploads/${ticket.upload.id}/complete`, headers: bearer(token) })).statusCode).toBe(200);
      const res = await app.inject({ method: 'POST', url: '/api/readings', headers: bearer(token), payload: { uploadIds: [ticket.upload.id] } });
      expect(res.statusCode, res.body).toBe(202);
      expect(ReadingView.parse(res.json()).author).toEqual({ id: agent.id, displayName: 'Reading agent', isAgent: true });
      await app.readingJobs.idle();
    });

    it('puts readings left running by a stopped process back in the queue', async () => {
      const scan = await upload(contributor, await page());
      const row = await t.db
        .insertInto('reading')
        .values({
          author_id: contributor.id,
          upload_ids: [scan],
          crops: '[]',
          context: '{}',
          day: '2026-11-02',
          status: 'running',
          started_at: new Date(clock.now().getTime() - 3_600_000),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      expect(await app.readingJobs.resume()).toBe(1);
      await app.readingJobs.idle();
      expect((await t.db.selectFrom('reading').select('status').where('id', '=', row.id).executeTakeFirstOrThrow()).status).toBe('done');
    });
  });

  describe('what is sent (task 1.4a; evidence-media spec, "Images sent for reading")', () => {
    it('sends only the marked crop of the one page asked for: not the original, not the whole page, nothing else of the Tree (scenario "Reading one page")', async () => {
      const original = await page(3000, 4000);
      const scan = await upload(contributor, original);
      await upload(contributor, await page(1200, 1600, 'Another page'));
      await read(contributor, { uploadIds: [scan], crops: [{ uploadId: scan, left: 0.25, top: 0.5, width: 0.5, height: 0.25 }] });
      expect(api.requests).toHaveLength(1);
      const images = imagesIn(api);
      expect(images).toHaveLength(1);
      const sent = Buffer.from(images[0]!.source!.data, 'base64');
      expect(images[0]!.source!.media_type).toBe('image/webp');
      const meta = await sharp(sent).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['webp', 1500, 1000]);
      expect(sent.equals(original)).toBe(false);
      const display = await storage.get(`pending/${scan}/display.webp`);
      expect(sent.equals(display!)).toBe(false);
      // Every request went to the reading service, and none carried any other image.
      expect(api.requests.every((r) => r.url.startsWith('https://api.anthropic.com/'))).toBe(true);
    });

    it('sends the display copy of a page without a crop, never the original', async () => {
      const original = await page(3000, 4000);
      const scan = await upload(contributor, original);
      await read(contributor, { uploadIds: [scan] });
      const sent = Buffer.from(imagesIn(api)[0]!.source!.data, 'base64');
      expect(sent.equals((await storage.get(`pending/${scan}/display.webp`))!)).toBe(true);
      expect(Math.max((await sharp(sent).metadata()).width, (await sharp(sent).metadata()).height)).toBe(DISPLAY_MAX_PIXELS);
    });

    it('reads only the Member’s own uploads and images of Citations, never portraits or others’ uploads', async () => {
      const others = await upload(editor, await page());
      const res = await as(contributor, 'POST', '/api/readings', { uploadIds: [others] });
      expect(res.statusCode).toBe(404);
      // The fixture's page image of Jan's baptism is attached to its Citation: any Member may have it read.
      const pageImage = await t.db.selectFrom('image').select('id').where('id', '=', L.pageImage).executeTakeFirstOrThrow();
      const attachedUpload = await t.db
        .insertInto('upload')
        .values({
          author_id: owner.id,
          status: 'ready',
          storage_key: 'images/fixture/original',
          display_key: 'images/fixture/display.webp',
          declared_type: 'image/jpeg',
          declared_size: 1,
          declared_sha256: '0'.repeat(64),
          content_type: 'image/jpeg',
          image_id: pageImage.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await storage.put(
        'images/fixture/display.webp',
        await sharp(await page())
          .webp()
          .toBuffer(),
        'image/webp',
      );
      const image = await t.db.selectFrom('image').selectAll().where('id', '=', pageImage.id).executeTakeFirstOrThrow();
      await t.db.updateTable('image').set({ display_key: 'images/fixture/display.webp' }).where('id', '=', image.id).execute();
      expect((await read(contributor, { uploadIds: [attachedUpload.id] })).status).toBe('done');
      // A portrait never goes.
      await t.db.updateTable('image').set({ kind: 'portrait' }).where('id', '=', image.id).execute();
      try {
        const portrait = await as(contributor, 'POST', '/api/readings', { uploadIds: [attachedUpload.id] });
        expect([portrait.statusCode, ApiError.parse(portrait.json()).code]).toEqual([400, 'not_a_scan']);
      } finally {
        await t.db.updateTable('image').set({ kind: image.kind, display_key: image.display_key }).where('id', '=', image.id).execute();
      }
    });
  });

  describe('archive links (task 1.5; scenario "Portal link")', () => {
    it('refuses a pasted viewer address instead of an image, says to add the image itself, and keeps the address as the link', async () => {
      const link = 'https://portal.example-archive.test/matriky/view?frame=41';
      const refused = await as(contributor, 'POST', '/api/readings', { uploadIds: [link] });
      expect(refused.statusCode).toBe(400);
      expect(ApiError.parse(refused.json()).message).toContain(PORTAL_LINK_MESSAGE);
      const scan = await upload(contributor, await page());
      const reading = await read(contributor, { uploadIds: [scan], context: { link } });
      expect(reading.context.link).toBe(link);
      // The address is never fetched: the only requests went to the reading service, without it.
      expect(api.requests.map((r) => r.url)).toEqual(['https://api.anthropic.com/v1/messages']);
      expect(JSON.stringify(api.requests[0]!.body)).not.toContain('example-archive');
    });
  });
});
