import { ProposalList, type OperationInput } from '@rodokmen/shared';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { DailyScheduler, pragueTime } from '../src/jobs/daily.js';
import { MemoryImageStorage } from '../src/storage/images.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, makeApp, MINUTE, signIn, type TestApp } from './helpers.js';

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
  const call = (m: Account, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => a.app.inject({ method, url, headers: { cookie: cookies.get(m.id)! }, ...(payload === undefined ? {} : { payload: payload as object }) });
  const propose = async (m: Account, tag: string) => {
    const res = await call(m, 'POST', '/api/proposals', {
      formatVersion: 1,
      idempotencyKey: randomBytes(8).toString('hex'),
      note: `Finding ${tag}`,
      operations: [{ op: 'createPerson', tempId: `tmp:p${tag}`, sex: 'female', name: { given: `Person ${tag}`, surname: 'Invented', type: 'birth', asFound: `Person ${tag}` } }, ...evidence(tag)],
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id as string;
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
});
