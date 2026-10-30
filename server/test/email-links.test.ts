import { Me, SessionList, SignedIn } from '@rodokmen/shared';
import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SIGN_IN_LINKS_PER_HOUR } from '../src/auth/accounts.js';
import { hashToken } from '../src/auth/sessions.js';
import type { Account } from '../src/db/types.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { cookieFrom, createMember, ensureOwner, errorOf, makeApp, MINUTE, signIn, tokenFromEmail, type TestApp } from './helpers.js';

describe('emailed sign-in links', () => {
  let t: TestDatabase;
  let a: TestApp;
  let member: Account;

  const request = (email: string) => a.app.inject({ method: 'POST', url: '/api/auth/email-link', payload: { email } });
  const verify = (token: string) => a.app.inject({ method: 'POST', url: '/api/auth/email-link/verify', payload: { token } });

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t);
    await ensureOwner(t.db);
    member = await createMember(t.db, 'contributor', { email: 'jana@example.test', displayName: 'Jana', language: 'cs' });
  });
  beforeEach(() => a.mailer.clear());
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  it('new phone: request a link, sign in with it, and register a passkey on the new phone', async () => {
    // The old phone keeps its session.
    const oldPhone = await signIn(t.db, a.clock, member);

    const requested = await request('Jana@Example.test');
    expect(requested.statusCode).toBe(202);
    const email = a.mailer.lastTo('jana@example.test')!;
    // In the Member's language.
    expect(email.subject).toBe('Přihlášení do Rodokmenu');
    expect(email.text).toContain('Platí 15 minut a dá se použít jen jednou.');
    const token = tokenFromEmail(email.text);
    expect(email.text).toContain(`${a.config.publicOrigin}/auth/link#token=${token}`);

    a.clock.advance(14 * MINUTE);
    const res = await verify(token);
    expect(res.statusCode).toBe(200);
    const newPhone = cookieFrom(res);
    expect(SignedIn.parse(res.json()).member.id).toBe(member.id);

    const options = await a.app.inject({ method: 'POST', url: '/api/auth/passkey/registration/options', headers: { cookie: newPhone } });
    expect(options.statusCode).toBe(200);
    expect(z.object({ user: z.object({ name: z.string() }) }).parse(options.json()).user.name).toBe('jana@example.test');
    expect(options.headers['set-cookie']).toMatch(/rdk_webauthn=.*HttpOnly.*SameSite=Strict/);

    const sessions = await a.app.inject({ method: 'GET', url: '/api/me/sessions', headers: { cookie: newPhone } });
    expect(SessionList.parse(sessions.json()).items.map((s) => [s.method, s.current]).sort()).toEqual([
      ['email_link', true],
      ['passkey', false],
    ]);
    expect((await a.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: oldPhone } })).statusCode).toBe(200);
  });

  it('stores the link token only as a hash, and the link works once', async () => {
    await request('jana@example.test');
    const token = tokenFromEmail(a.mailer.lastTo('jana@example.test')!.text);
    const rows = await t.db.selectFrom('sign_in_link').select(['token_hash']).where('account_id', '=', member.id).execute();
    expect(rows.some((r) => r.token_hash.equals(hashToken(token)))).toBe(true);
    expect(rows.every((r) => !r.token_hash.toString('latin1').includes(token))).toBe(true);
    expect((await verify(token)).statusCode).toBe(200);
    const second = await verify(token);
    expect(second.statusCode).toBe(410);
    expect(errorOf(second).message).toBe('This sign-in link has expired or was already used. Request a new one.');
  });

  it('expires after 15 minutes', async () => {
    await request('jana@example.test');
    const token = tokenFromEmail(a.mailer.lastTo('jana@example.test')!.text);
    a.clock.advance(15 * MINUTE + 1000);
    expect((await verify(token)).statusCode).toBe(410);
  });

  it('answers the same for unknown addresses and sends nothing', async () => {
    const res = await request('nobody@example.test');
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual((await request('jana@example.test')).json());
    expect(a.mailer.lastTo('nobody@example.test')).toBeUndefined();
  });

  it(`sends at most ${SIGN_IN_LINKS_PER_HOUR} links an hour to one Member`, async () => {
    a.clock.advance(2 * 60 * MINUTE);
    for (let i = 0; i < SIGN_IN_LINKS_PER_HOUR + 2; i++) await request('jana@example.test');
    expect(a.mailer.messages.filter((m) => m.to === 'jana@example.test')).toHaveLength(SIGN_IN_LINKS_PER_HOUR);
  });

  it(`also when the requests arrive at once: at most ${SIGN_IN_LINKS_PER_HOUR} links`, async () => {
    a.clock.advance(2 * 60 * MINUTE);
    a.mailer.clear();
    await Promise.all(Array.from({ length: SIGN_IN_LINKS_PER_HOUR * 3 }, () => request('jana@example.test')));
    expect(a.mailer.messages.filter((m) => m.to === 'jana@example.test')).toHaveLength(SIGN_IN_LINKS_PER_HOUR);
  });

  it('signs out the current session', async () => {
    a.clock.advance(2 * 60 * MINUTE);
    await request('jana@example.test');
    const res = await verify(tokenFromEmail(a.mailer.lastTo('jana@example.test')!.text));
    const cookie = cookieFrom(res);
    expect(Me.parse((await a.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json()).displayName).toBe('Jana');
    expect((await a.app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { cookie } })).statusCode).toBe(204);
    expect((await a.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
  });
});
