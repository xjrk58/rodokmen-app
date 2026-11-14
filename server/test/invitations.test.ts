import { CreatedInvitation, InvitationCheck, InvitationList, InvitationView, Me, SignedIn } from '@rodokmen/shared';
import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
    expect(email.text).toContain(`${a.config.publicOrigin}/#invite/${token}`);

    // Only the hash is stored.
    const stored = await t.db.selectFrom('invitation').select('token_hash').where('id', '=', view.id).executeTakeFirstOrThrow();
    expect(stored.token_hash.equals(hashToken(token))).toBe(true);
    expect(stored.token_hash.toString('utf8')).not.toContain(token);

    const check = await post('/api/auth/invitation/check', { token });
    expect(check.json()).toMatchObject({ status: 'pending', language: 'en', email: 'cousin.marta@example.test' });

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
    expect(check.json()).toEqual({
      status: 'expired',
      language: 'cs',
      message: 'Platnost pozvánky vypršela. Požádejte správce Rodokmenu o novou.',
      email: null,
    });
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

  // member-accounts spec, "Invitation link for the Owner's own WhatsApp" and "One invitation, whichever way its link travels".
  describe("the link for the Owner's own WhatsApp", () => {
    it('the link comes back once: in the answer that creates the invitation, the same as in the email, and never in the list', async () => {
      const created = await invite('whatsapp.cousin@example.test', 'en');
      expect(created.statusCode).toBe(201);
      const view = CreatedInvitation.parse(created.json());
      const token = tokenFromEmail(a.mailer.lastTo('whatsapp.cousin@example.test')!.text);
      expect(view.link).toBe(`${a.config.publicOrigin}/#invite/${token}`);
      // The message: the inviter, the link on its own line, 7 days, once, and the invited address.
      expect(view.shareText).toContain(owner.display_name);
      expect(view.shareText).toContain(`\n${view.link}\n`);
      expect(view.shareText).toContain('valid for 7 days and works only once');
      expect(view.shareText).toContain('whatsapp.cousin@example.test');

      const list = await a.app.inject({ method: 'GET', url: '/api/invitations', headers: { cookie: ownerCookie } });
      expect(list.statusCode).toBe(200);
      const listed = InvitationList.parse(list.json()).items.find((i) => i.id === view.id)!;
      expect(listed.status).toBe('pending');
      // Neither the link nor the token is in any later answer: only the token's hash is stored.
      const raw = z
        .object({ items: z.array(z.looseObject({ id: z.string() })) })
        .parse(list.json())
        .items.find((i) => i.id === view.id);
      expect(raw).not.toHaveProperty('link');
      expect(raw).not.toHaveProperty('shareText');
      expect(list.body).not.toContain(token);
    });

    it('Czech message: the Owner picks Czech and the message is in Czech', async () => {
      const view = CreatedInvitation.parse((await invite('teta@example.test', 'cs')).json());
      expect(view.shareText).toContain('vás zve do Rodokmenu');
      expect(view.shareText).toContain('Platí 7 dní a dá se použít jen jednou');
      expect(view.shareText).toContain('teta@example.test');
      expect(view.shareText).toContain(view.link);
    });

    it('accepted through WhatsApp: the emailed link is the same one, and is then refused as already used', async () => {
      const view = CreatedInvitation.parse((await invite('both.ways@example.test', 'en')).json());
      const viaWhatsApp = tokenFromEmail(view.shareText);
      expect((await post('/api/auth/invitation/accept', { token: viaWhatsApp, displayName: 'Both', language: 'en' })).statusCode).toBe(201);
      const viaEmail = tokenFromEmail(a.mailer.lastTo('both.ways@example.test')!.text);
      const again = await post('/api/auth/invitation/accept', { token: viaEmail, displayName: 'Both again', language: 'en' });
      expect(again.statusCode).toBe(410);
      expect(errorOf(again).code).toBe('invitation_accepted');
      // A used invitation no longer names its address.
      expect(InvitationCheck.parse((await post('/api/auth/invitation/check', { token: viaEmail })).json())).toMatchObject({ status: 'accepted', email: null });
    });

    it('withdrawn after sending: the link that went through WhatsApp is refused', async () => {
      const view = CreatedInvitation.parse((await invite('withdrawn.chat@example.test', 'en')).json());
      expect((await a.app.inject({ method: 'DELETE', url: `/api/invitations/${view.id}`, headers: { cookie: ownerCookie } })).statusCode).toBe(204);
      const res = await post('/api/auth/invitation/accept', { token: tokenFromEmail(view.shareText), displayName: 'W', language: 'en' });
      expect(res.statusCode).toBe(410);
      expect(res.json()).toMatchObject({ code: 'invitation_revoked', message: 'This invitation was withdrawn. Ask the Owner for a new one.' });
      expect(InvitationCheck.parse((await post('/api/auth/invitation/check', { token: tokenFromEmail(view.shareText) })).json()).email).toBeNull();
    });

    it('expired WhatsApp link: refused after 7 days', async () => {
      const view = CreatedInvitation.parse((await invite('late.chat@example.test', 'en')).json());
      a.clock.advance(7 * DAY + MINUTE);
      const res = await post('/api/auth/invitation/accept', { token: tokenFromEmail(view.link), displayName: 'L', language: 'en' });
      expect(res.statusCode).toBe(410);
      expect(errorOf(res).code).toBe('invitation_expired');
    });

    it('the link is lost: the Owner withdraws the invitation and invites again, and only the new link works', async () => {
      const first = CreatedInvitation.parse((await invite('lost.link@example.test', 'cs')).json());
      expect((await a.app.inject({ method: 'DELETE', url: `/api/invitations/${first.id}`, headers: { cookie: ownerCookie } })).statusCode).toBe(204);
      const second = CreatedInvitation.parse((await invite('lost.link@example.test', 'cs')).json());
      expect(second.link).not.toBe(first.link);
      expect(a.mailer.messages.filter((m) => m.to === 'lost.link@example.test')).toHaveLength(2);
      expect(errorOf(await post('/api/auth/invitation/accept', { token: tokenFromEmail(first.link), displayName: 'L', language: 'cs' })).code).toBe(
        'invitation_revoked',
      );
      expect((await post('/api/auth/invitation/accept', { token: tokenFromEmail(second.link), displayName: 'L', language: 'cs' })).statusCode).toBe(201);
    });
  });

  // member-accounts spec, "The Owner is told when an invitation is accepted" and "Accepting does not wait on the Owner's email".
  describe('the Owner is told when an invitation is accepted', () => {
    const accept = (token: string, displayName: string) => post('/api/auth/invitation/accept', { token, displayName, language: 'en' });
    const invited = async (email: string) => CreatedInvitation.parse((await invite(email, 'en')).json());
    const toOwner = (ownerEmail = owner.email) => a.mailer.messages.filter((m) => m.to === ownerEmail);
    const pragueTime = (language: 'cs' | 'en', d: Date) =>
      new Intl.DateTimeFormat(language === 'cs' ? 'cs-CZ' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague' }).format(d);

    it("a cousin accepts: the Owner gets one email in the Owner's language with the name, the address, the time and a link to Settings", async () => {
      const view = await invited('cousin.told@example.test');
      a.mailer.clear();
      expect((await accept(tokenFromEmail(view.link), 'Marta Invented')).statusCode).toBe(201);
      // One email, and only to the Owner.
      expect(a.mailer.messages.map((m) => m.to)).toEqual([owner.email]);
      const email = toOwner()[0]!;
      // The Owner's language (Czech), not the language the relative chose (English).
      expect(email.subject).toBe('Pozvánka do Rodokmenu byla přijata');
      expect(email.text).toContain('„Marta Invented“');
      expect(email.text).toContain('cousin.told@example.test');
      expect(email.text).toContain(pragueTime('cs', a.clock.now()));
      expect(email.text).toContain(`${a.config.publicOrigin}/#settings`);
      expect(email.html).toContain(`href="${a.config.publicOrigin}/#settings"`);
      // The display name is the relative's own text: it stays out of the subject.
      expect(email.subject).not.toContain('Marta');
    });

    it('link sent both ways: accepting through WhatsApp and then the emailed link sends one email, not two', async () => {
      const view = await invited('told.once@example.test');
      const viaEmail = tokenFromEmail(a.mailer.lastTo('told.once@example.test')!.text);
      a.mailer.clear();
      expect((await accept(tokenFromEmail(view.shareText), 'Once')).statusCode).toBe(201);
      expect(errorOf(await accept(viaEmail, 'Once again')).code).toBe('invitation_accepted');
      expect(toOwner()).toHaveLength(1);
    });

    it('two invitations to one address: the second is refused as already a Member, and one email went out', async () => {
      const first = await invited('twice.invited@example.test');
      const second = await invited('twice.invited@example.test');
      a.mailer.clear();
      expect((await accept(tokenFromEmail(second.link), 'Twice')).statusCode).toBe(201);
      const again = await accept(tokenFromEmail(first.link), 'Twice again');
      expect(again.statusCode).toBe(409);
      expect(errorOf(again).code).toBe('already_member');
      expect(toOwner()).toHaveLength(1);
    });

    it('the email cannot be sent: the relative is still a Contributor and signed in, and the failure is logged', async () => {
      const view = await invited('mail.down@example.test');
      const send = a.mailer.send.bind(a.mailer);
      const logged = vi.spyOn(a.app.log, 'error');
      a.mailer.send = async () => {
        throw new Error('SMTP is down');
      };
      try {
        const res = await accept(tokenFromEmail(view.link), 'Mail Down');
        expect(res.statusCode).toBe(201);
        expect(SignedIn.parse(res.json()).member).toMatchObject({ email: 'mail.down@example.test', role: 'contributor' });
        const me = await a.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: cookieFrom(res) } });
        expect(Me.parse(me.json()).email).toBe('mail.down@example.test');
        const [logArgs] = logged.mock.calls.filter((call: unknown[]) => call[1] === 'could not tell the Owner that an invitation was accepted');
        expect(z.object({ err: z.instanceof(Error) }).parse(logArgs?.[0]).err.message).toBe('SMTP is down');
      } finally {
        a.mailer.send = send;
        logged.mockRestore();
      }
      const stored = await t.db.selectFrom('invitation').select('accepted_at').where('id', '=', view.id).executeTakeFirstOrThrow();
      expect(stored.accepted_at).not.toBeNull();
    });

    // Last in the file: it hands ownership over and back.
    it('ownership handed over: the email goes to the new Owner, in the new Owner’s language', async () => {
      const view = await invited('after.handover@example.test');
      const heir = await createMember(t.db, 'editor', { email: 'heir@example.test', language: 'en' });
      const handOver = await a.app.inject({ method: 'PUT', url: `/api/members/${heir.id}/role`, headers: { cookie: ownerCookie }, payload: { role: 'owner' } });
      expect(handOver.statusCode).toBe(200);
      try {
        a.mailer.clear();
        expect((await accept(tokenFromEmail(view.link), 'After Handover')).statusCode).toBe(201);
        expect(toOwner()).toHaveLength(0);
        const sent = toOwner(heir.email);
        expect(sent).toHaveLength(1);
        expect(sent[0]!.subject).toBe('Your Rodokmen invitation was accepted');
        expect(sent[0]!.text).toContain('“After Handover”');
        expect(sent[0]!.text).toContain(pragueTime('en', a.clock.now()));
      } finally {
        const heirCookie = await signIn(t.db, a.clock, heir);
        const back = await a.app.inject({ method: 'PUT', url: `/api/members/${owner.id}/role`, headers: { cookie: heirCookie }, payload: { role: 'owner' } });
        expect(back.statusCode).toBe(200);
      }
    });
  });
});
