import { ProposalList, type OperationInput } from '@rodokmen/shared';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { DailyScheduler, pragueTime } from '../src/jobs/daily.js';
import { MemoryImageStorage } from '../src/storage/images.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, idOf, makeApp, MINUTE, signIn, type TestApp } from './helpers.js';

const evidence = (tag: string): OperationInput[] => [
  { op: 'createSource', tempId: `tmp:s${tag}`, type: 'parish_register', title: `Invented register ${tag}` },
  { op: 'createCitation', tempId: `tmp:c${tag}`, sourceId: `tmp:s${tag}`, page: '3', transcription: 'Invented entry.', readOn: '2026-10-01', confidence: 'normal' },
];

describe('notifications: the daily Editor digest and outcome emails', () => {
  let t: TestDatabase;
  let a: TestApp;
  let jobs: DailyScheduler;
  let owner: Account;
  let editor: Account;
  let karel: Account;
  let jana: Account;
  const cookies = new Map<string, string>();
  const call = (m: Account, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => a.app.inject({ method, url, headers: { cookie: cookies.get(m.id)! }, ...(payload === undefined ? {} : { payload }) });
  const propose = async (m: Account, tag: string) => {
    const res = await call(m, 'POST', '/api/proposals', {
      formatVersion: 1,
      idempotencyKey: randomBytes(8).toString('hex'),
      note: `Finding ${tag}`,
      operations: [{ op: 'createPerson', tempId: `tmp:p${tag}`, sex: 'female', name: { given: `Person ${tag}`, surname: 'Invented', type: 'birth', asFound: `Person ${tag}` } }, ...evidence(tag)],
    });
    expect(res.statusCode, res.body).toBe(201);
    return idOf(res);
  };
  const at = (iso: string) => {
    a.clock.current = new Date(iso);
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t, { images: (clock) => new MemoryImageStorage(clock) });
    owner = await ensureOwner(t.db);
    editor = await createMember(t.db, 'editor', { displayName: 'Eva Editor', language: 'en' });
    karel = await createMember(t.db, 'contributor', { displayName: 'Karel', language: 'cs' });
    jana = await createMember(t.db, 'contributor', { displayName: 'Jana', language: 'en' });
    for (const m of [owner, editor, karel, jana]) cookies.set(m.id, await signIn(t.db, a.clock, m));
    jobs = new DailyScheduler({ db: t.db, clock: a.clock, mailer: a.mailer, images: new MemoryImageStorage(a.clock), publicOrigin: 'https://rodokmen.example' });
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  it('runs at 18:00 Prague time in winter and in summer', () => {
    expect(pragueTime(new Date('2026-12-01T17:00:00Z'))).toEqual({ day: '2026-12-01', minutes: 18 * 60 });
    expect(pragueTime(new Date('2027-07-01T16:00:00Z'))).toEqual({ day: '2027-07-01', minutes: 18 * 60 });
  });

  it('quiet day: no Proposals pending at digest time, no digest email', async () => {
    at('2026-10-29T16:59:00Z'); // 17:59 in Prague
    a.mailer.clear();
    expect(await jobs.tick()).not.toContain('editor-digest');
    at('2026-10-29T17:00:00Z');
    expect(await jobs.tick()).toContain('editor-digest');
    expect(a.mailer.messages).toEqual([]);
  });

  it('busy day: with four Proposals pending, each Editor receives one email listing the four with links into the review queue', async () => {
    at('2026-10-30T08:00:00Z');
    const ids = [await propose(karel, 'A'), await propose(jana, 'B'), await propose(karel, 'C'), await propose(jana, 'D')];
    a.mailer.clear();
    at('2026-10-30T16:59:00Z');
    await jobs.tick();
    expect(a.mailer.messages).toEqual([]);
    at('2026-10-30T17:00:00Z');
    expect(await jobs.tick()).toEqual(['editor-digest']);
    at('2026-10-30T17:00:00Z');
    a.clock.advance(30 * MINUTE);
    expect(await jobs.tick()).toEqual([]); // once a day
    const recipients = a.mailer.messages.map((m) => m.to).sort();
    expect(recipients).toEqual([owner.email, editor.email].sort());
    const toEditor = a.mailer.lastTo(editor.email)!;
    expect(toEditor.subject).toBe('Rodokmen: 4 Proposals to review');
    for (const id of ids) expect(toEditor.text).toContain(`https://rodokmen.example/#work/review/${id}`);
    // Grouped by author.
    expect(toEditor.text.indexOf('Finding C')).toBeLessThan(toEditor.text.indexOf('Jana\n'));
    expect(a.mailer.lastTo(owner.email)!.subject).toBe('Rodokmen: návrhy ke kontrole (4)');
  });

  it('rejected Proposal: the Contributor receives an email in their language with the outcome and the note', async () => {
    const id = await propose(karel, 'R');
    a.mailer.clear();
    expect((await call(editor, 'POST', `/api/proposals/${id}/reject`, { note: 'Špatná farnost, viz matrika 1820' })).statusCode).toBe(200);
    const mail = a.mailer.lastTo(karel.email)!;
    expect(mail.subject).toBe('Váš návrh nebyl přijat');
    expect(mail.text).toContain('Poznámka: Špatná farnost, viz matrika 1820');
    expect(mail.text).toContain('Eva Editor váš návrh do Rodokmenu nepřijal(a)');
    expect(mail.text).toContain(`/#work/mine/${id}`);
  });

  it('muted Contributor: no email is sent, and the outcome still shows in the app', async () => {
    expect((await call(jana, 'PUT', '/api/me/notifications', { outcomeEmails: false })).json()).toEqual({ outcomeEmails: false });
    const id = await propose(jana, 'M');
    a.mailer.clear();
    expect((await call(editor, 'POST', `/api/proposals/${id}/accept`, { note: 'Thank you' })).statusCode).toBe(200);
    expect(a.mailer.messages).toEqual([]);
    const mine = ProposalList.parse((await call(jana, 'GET', '/api/proposals?mine=true')).json()).items.find((p) => p.id === id)!;
    expect(mine).toMatchObject({ status: 'accepted', decisionNote: 'Thank you' });
  });

  it("Editors' digests stay on while they are Editors, even with outcome emails muted", async () => {
    await call(editor, 'PUT', '/api/me/notifications', { outcomeEmails: false });
    a.mailer.clear();
    at('2026-10-31T17:05:00Z');
    expect(await jobs.tick()).toContain('editor-digest');
    expect(a.mailer.lastTo(editor.email)).toBeDefined();
  });

  it('an outcome email that cannot be sent does not fail the decision', async () => {
    const id = await propose(karel, 'O');
    const send = a.mailer.send.bind(a.mailer);
    a.mailer.send = async () => {
      throw new Error('SMTP is down');
    };
    try {
      expect((await call(editor, 'POST', `/api/proposals/${id}/reject`, { note: 'no' })).statusCode).toBe(200);
    } finally {
      a.mailer.send = send;
    }
  });

  it('a digest that fails for one Editor is retried only for that Editor, and given up after three tries', async () => {
    at('2026-11-02T08:00:00Z');
    await propose(karel, 'S');
    const failing = new Set([owner.email]);
    const send = a.mailer.send.bind(a.mailer);
    a.mailer.send = async (m) => {
      if (failing.has(m.to)) throw new Error('mailbox unavailable');
      return send(m);
    };
    try {
      a.mailer.clear();
      at('2026-11-02T17:00:00Z');
      await jobs.tick();
      expect(a.mailer.messages.map((m) => m.to)).toEqual([editor.email]);
      expect((await t.db.selectFrom('job_run').select('status').where('job', '=', 'editor-digest').where('day', '=', '2026-11-02').executeTakeFirstOrThrow()).status).toBe('failed');
      // Next minute: only the Editor not yet reached.
      failing.clear();
      at('2026-11-02T17:01:00Z');
      await jobs.tick();
      expect(a.mailer.messages.map((m) => m.to).sort()).toEqual([editor.email, owner.email].sort());

      // Another day, a mailbox that never works: tried three times, nobody else gets duplicates.
      failing.add(owner.email);
      a.mailer.clear();
      for (const minute of ['00', '01', '02', '03', '04']) {
        at(`2026-11-03T17:${minute}:00Z`);
        await jobs.tick();
      }
      expect(a.mailer.messages.map((m) => m.to)).toEqual([editor.email]);
      const delivery = await t.db.selectFrom('job_delivery').selectAll().where('day', '=', '2026-11-03').where('account_id', '=', owner.id).executeTakeFirstOrThrow();
      expect([delivery.sent_at, delivery.attempts]).toEqual([null, 3]);
      expect((await t.db.selectFrom('job_run').select('status').where('job', '=', 'editor-digest').where('day', '=', '2026-11-03').executeTakeFirstOrThrow()).status).toBe('done');
    } finally {
      a.mailer.send = send;
    }
  });

  it('a run left "running" by a crash is taken over once stale; a fresh claim is left alone', async () => {
    a.mailer.clear();
    at('2026-11-04T17:10:00Z');
    await t.db.insertInto('job_run').values({ job: 'editor-digest', day: '2026-11-04', status: 'running', claimed_at: new Date('2026-11-04T17:05:00Z') }).execute();
    expect(await jobs.tick()).not.toContain('editor-digest');
    expect(a.mailer.messages).toEqual([]);
    at('2026-11-04T17:25:00Z');
    expect(await jobs.tick()).toContain('editor-digest');
    expect(a.mailer.messages.length).toBe(2);
  });

  it('stopping waits for a running tick', async () => {
    let release!: () => void;
    const slow = new DailyScheduler({ db: t.db, clock: a.clock, mailer: a.mailer, images: new MemoryImageStorage(a.clock), publicOrigin: 'https://rodokmen.example' }, [
      { name: 'slow-test-job', at: { hour: 0, minute: 0 }, run: () => new Promise((resolve) => (release = () => resolve({ detail: 'ok', complete: true }))) },
    ]);
    const stop = slow.start(5);
    await expect.poll(() => typeof release).toBe('function');
    let stopped = false;
    const stopping = stop().then(() => (stopped = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect((await t.db.selectFrom('job_run').select('status').where('job', '=', 'slow-test-job').executeTakeFirstOrThrow()).status).toBe('done');
  });
});
