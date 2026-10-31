import { InvitationList, InvitationView, Me, SignedIn } from '@rodokmen/shared';
import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../src/auth/sessions.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { cookieFrom, createMember, DAY, ensureOwner, errorOf, makeApp, MINUTE, signIn, tokenFromEmail, type TestApp, type MemberAccount } from './helpers.js';

describe('invitations', () => {
  let t: TestDatabase;
  let a: TestApp;
  let owner: MemberAccount;
  let ownerCookie: string;

  const invite = async (email: string, language: 'cs' | 'en', cookie = ownerCookie) =>
    a.app.inject({ method: 'POST', url: '/api/invitations', headers: { cookie }, payload: { email, language } });
  const post = (url: string, payload: object, cookie?: string) => a.app.inject({ method: 'POST', url, payload, headers: cookie ? { cookie } : {} });

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t);
    owner = await ensureOwner(t.db);
    ownerCookie = await signIn(t.db, a.clock, owner);
  });
  beforeEach(() => a.mailer.clear());
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  it('only the Owner invites: Contributors and Editors get 403, anonymous 401', async () => {
    const contributor = await signIn(t.db, a.clock, await createMember(t.db, 'contributor'));
    const editor = await signIn(t.db, a.clock, await createMember(t.db, 'editor'));
    expect((await invite('a@example.test', 'en', contributor)).statusCode).toBe(403);
    expect((await invite('a@example.test', 'en', editor)).statusCode).toBe(403);
    expect((await a.app.inject({ method: 'POST', url: '/api/invitations', payload: { email: 'a@example.test', language: 'en' } })).statusCode).toBe(401);
    expect(a.mailer.messages).toHaveLength(0);
  });

  it('there is no public sign-up: no route creates an account without an invitation', () => {
    const creating = a.app.routeRecords.filter((r) => r.method === 'POST' && /sign-?up|register$|\/accounts?$|\/members$/.test(r.url));
    expect(creating).toEqual([]);
  });

  it('accepting an invitation: the relative sets display name and language, signs in and becomes a Contributor', async () => {
    const created = await invite('Cousin.Marta@Example.test', 'en');
    expect(created.statusCode).toBe(201);
    const view = InvitationView.parse(created.json());
    expect(view).toMatchObject({ email: 'cousin.marta@example.test', language: 'en', status: 'pending' });
    expect(new Date(view.expiresAt).getTime() - a.clock.now().getTime()).toBe(7 * DAY);

    const email = a.mailer.lastTo('cousin.marta@example.test')!;
    expect(email.subject).toBe('Your invitation to Rodokmen');
    expect(email.text).toContain(owner.display_name);
    const token = tokenFromEmail(email.text);
    expect(email.text).toContain(`${a.config.publicOrigin}/auth/invite#token=${token}`);

    // Only the hash is stored.
    const stored = await t.db.selectFrom('invitation').select('token_hash').where('id', '=', view.id).executeTakeFirstOrThrow();
    expect(stored.token_hash.equals(hashToken(token))).toBe(true);
    expect(stored.token_hash.toString('utf8')).not.toContain(token);

    const check = await post('/api/auth/invitation/check', { token });
    expect(check.json()).toMatchObject({ status: 'pending', language: 'en' });

    a.clock.advance(6 * DAY);
    const accepted = await post('/api/auth/invitation/accept', { token, displayName: 'Marta', language: 'cs' });
    expect(accepted.statusCode).toBe(201);
    const signedIn = SignedIn.parse(accepted.json());
    expect(signedIn.member).toMatchObject({ email: 'cousin.marta@example.test', displayName: 'Marta', language: 'cs', role: 'contributor', passkeyCount: 0 });
    expect(signedIn.member.permissions).toMatchObject({ propose: true, review: false, inviteMembers: false });

    // The session cookie is HttpOnly, Secure and SameSite=Lax.
    const setCookie = String(accepted.headers['set-cookie']);
    expect(setCookie).toMatch(/rdk_session=[A-Za-z0-9_-]{43};/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    const me = await a.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: cookieFrom(accepted) } });
    expect(Me.parse(me.json()).role).toBe('contributor');
    // Next step on the page: register a passkey, which needs this session.
    const options = await a.app.inject({ method: 'POST', url: '/api/auth/passkey/registration/options', headers: { cookie: cookieFrom(accepted) } });
    expect(options.statusCode).toBe(200);
    expect(z.object({ rp: z.unknown() }).parse(options.json()).rp).toEqual({ name: 'Rodokmen', id: 'localhost' });

    // The link works once.
    const again = await post('/api/auth/invitation/accept', { token, displayName: 'Someone else', language: 'en' });
    expect(again.statusCode).toBe(410);
    expect(errorOf(again).code).toBe('invitation_accepted');
  });

  it('expired invitation: refused after 7 days, and the relative is told to ask the Owner for a new one', async () => {
    await invite('late@example.test', 'cs');
    const token = tokenFromEmail(a.mailer.lastTo('late@example.test')!.text);
    a.clock.advance(7 * DAY + MINUTE);
    const check = await post('/api/auth/invitation/check', { token });
    expect(check.json()).toEqual({ status: 'expired', language: 'cs', message: 'Platnost pozvánky vypršela. Požádejte správce Rodokmenu o novou.' });
    const res = await post('/api/auth/invitation/accept', { token, displayName: 'Late', language: 'cs' });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toMatchObject({ code: 'invitation_expired', message: 'Platnost pozvánky vypršela. Požádejte správce Rodokmenu o novou.' });
    expect(await t.db.selectFrom('account').select('id').where('email', '=', 'late@example.test').executeTakeFirst()).toBeUndefined();

    await invite('late-en@example.test', 'en');
    const tokenEn = tokenFromEmail(a.mailer.lastTo('late-en@example.test')!.text);
    a.clock.advance(8 * DAY);
    expect(errorOf(await post('/api/auth/invitation/accept', { token: tokenEn, displayName: 'Late', language: 'en' })).message).toBe(
      'This invitation has expired. Ask the Owner for a new one.',
    );
  });

  it('Czech invitation: the Owner picks Czech and the email is in Czech', async () => {
    await invite('babicka@example.test', 'cs');
    const email = a.mailer.lastTo('babicka@example.test')!;
    expect(email.subject).toBe('Pozvánka do Rodokmenu');
    expect(email.text).toContain('Pozvánku přijmete tímto odkazem. Platí 7 dní a dá se použít jen jednou.');
  });

  it('when the invitation email cannot be sent, no invitation is left behind', async () => {
    const send = a.mailer.send.bind(a.mailer);
    a.mailer.send = async () => {
      throw new Error('SMTP is down');
    };
    try {
      expect((await invite('unreached@example.test', 'en')).statusCode).toBe(500);
    } finally {
      a.mailer.send = send;
    }
    expect(await t.db.selectFrom('invitation').select('id').where('email', '=', 'unreached@example.test').execute()).toEqual([]);
  });

  it('refuses an unknown token, a revoked invitation, and an address that is already a Member', async () => {
    expect((await post('/api/auth/invitation/check', { token: 'x'.repeat(43) })).statusCode).toBe(404);
    const created = InvitationView.parse((await invite('revoked@example.test', 'en')).json());
    const token = tokenFromEmail(a.mailer.lastTo('revoked@example.test')!.text);
    expect((await a.app.inject({ method: 'DELETE', url: `/api/invitations/${created.id}`, headers: { cookie: ownerCookie } })).statusCode).toBe(204);
    expect(errorOf(await post('/api/auth/invitation/accept', { token, displayName: 'R', language: 'en' })).code).toBe('invitation_revoked');
    expect((await invite(owner.email, 'en')).statusCode).toBe(409);
    const list = await a.app.inject({ method: 'GET', url: '/api/invitations', headers: { cookie: ownerCookie } });
    expect(InvitationList.parse(list.json()).items.find((i) => i.id === created.id)!.status).toBe('revoked');
  });
});
