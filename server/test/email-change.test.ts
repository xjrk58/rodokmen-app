import { EmailChangeConfirmed, MemberList, MemberView, Me } from '@rodokmen/shared';
import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashToken } from '../src/auth/sessions.js';
import type { MailMessage } from '../src/mail/mailer.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import {
  bearer,
  createAgentWithToken,
  createMember,
  DAY,
  ensureOwner,
  errorOf,
  makeApp,
  MINUTE,
  signIn,
  tokenFromEmail,
  type MemberAccount,
  type TestApp,
} from './helpers.js';

/** The token of a link that confirms a new address (…/#address/XYZ). */
function addressToken(text: string): string {
  const m = /#address\/([A-Za-z0-9_-]+)/.exec(text);
  if (!m) throw new Error(`no address link in email:\n${text}`);
  return m[1]!;
}

// member-accounts spec: "The Owner corrects a Member's address", "Confirming a new address",
// "An address belongs to one Member" and "After an address is corrected".
describe("correcting a Member's address", () => {
  let t: TestDatabase;
  let a: TestApp;
  let owner: MemberAccount;
  let ownerCookie: string;

  const ask = (memberId: string, email: string, cookie = ownerCookie) =>
    a.app.inject({ method: 'POST', url: `/api/members/${memberId}/email-change`, headers: { cookie }, payload: { email } });
  const withdraw = (memberId: string) => a.app.inject({ method: 'DELETE', url: `/api/members/${memberId}/email-change`, headers: { cookie: ownerCookie } });
  const confirm = (token: string) => a.app.inject({ method: 'POST', url: '/api/auth/email-change/confirm', payload: { token } });
  const requestSignInLink = (email: string) => a.app.inject({ method: 'POST', url: '/api/auth/email-link', payload: { email } });
  const verifySignInLink = (token: string) => a.app.inject({ method: 'POST', url: '/api/auth/email-link/verify', payload: { token } });
  const listed = async (memberId: string) => {
    const res = await a.app.inject({ method: 'GET', url: '/api/members', headers: { cookie: ownerCookie } });
    return MemberList.parse(res.json()).items.find((m) => m.id === memberId)!;
  };
  const addressOf = async (memberId: string) => (await t.db.selectFrom('account').select('email').where('id', '=', memberId).executeTakeFirstOrThrow()).email;
  const cousin = (n: string, language: 'cs' | 'en' = 'en') =>
    createMember(t.db, 'contributor', { email: `${n}@example.test`, displayName: `Cousin ${n}`, language });
  /** Makes the mailer fail for one address while the test runs. */
  const failingFor = async (address: string, run: () => Promise<void>) => {
    const send = a.mailer.send.bind(a.mailer);
    a.mailer.send = async (m: MailMessage) => {
      if (m.to === address) throw new Error('SMTP is down');
      return send(m);
    };
    try {
      await run();
    } finally {
      a.mailer.send = send;
    }
  };

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

  it('only the Owner asks: an Editor, a Contributor and an Agent get 403, anonymous 401, and nothing is sent', async () => {
    const target = await cousin('target');
    const editor = await signIn(t.db, a.clock, await createMember(t.db, 'editor'));
    const contributor = await signIn(t.db, a.clock, await createMember(t.db, 'contributor'));
    const { token } = await createAgentWithToken(t.db, a.clock);
    expect((await ask(target.id, 'other@example.test', editor)).statusCode).toBe(403);
    expect((await ask(target.id, 'other@example.test', contributor)).statusCode).toBe(403);
    const asAgent = await a.app.inject({
      method: 'POST',
      url: `/api/members/${target.id}/email-change`,
      headers: bearer(token),
      payload: { email: 'other@example.test' },
    });
    expect(asAgent.statusCode).toBe(403);
    const anonymous = await a.app.inject({ method: 'POST', url: `/api/members/${target.id}/email-change`, payload: { email: 'other@example.test' } });
    expect(anonymous.statusCode).toBe(401);
    for (const cookie of [editor, contributor]) {
      expect((await a.app.inject({ method: 'DELETE', url: `/api/members/${target.id}/email-change`, headers: { cookie } })).statusCode).toBe(403);
    }
    expect(a.mailer.messages).toHaveLength(0);
    expect(await addressOf(target.id)).toBe('target@example.test');
  });

  it('correcting a mistyped address: the link goes to the new address in the Member’s language, and sign-in links go to the old one until it is confirmed', async () => {
    const marta = await cousin('marta.typo', 'cs');
    const res = await ask(marta.id, 'Marta.Right@Example.test');
    expect(res.statusCode).toBe(200);
    expect(MemberView.parse(res.json())).toMatchObject({ id: marta.id, email: 'marta.typo@example.test', pendingEmail: 'marta.right@example.test' });
    expect(await listed(marta.id)).toMatchObject({ email: 'marta.typo@example.test', pendingEmail: 'marta.right@example.test' });

    // One email, to the new address, in Czech, naming the Member and the Owner.
    expect(a.mailer.messages.map((m) => m.to)).toEqual(['marta.right@example.test']);
    const email = a.mailer.lastTo('marta.right@example.test')!;
    expect(email.subject).toBe('Potvrďte svou novou adresu v Rodokmenu');
    expect(email.text).toContain('Cousin marta.typo');
    expect(email.text).toContain(owner.display_name);
    expect(email.text).toContain('Odkaz platí 7 dní a dá se použít jen jednou.');
    const token = addressToken(email.text);
    expect(email.text).toContain(`${a.config.publicOrigin}/#address/${token}`);
    // Only the token's hash is stored.
    const stored = await t.db.selectFrom('email_change').select('token_hash').where('account_id', '=', marta.id).executeTakeFirstOrThrow();
    expect(stored.token_hash.equals(hashToken(token))).toBe(true);

    // Nothing changed yet: sign-in links still go to the old address, and the new one is no Member's.
    a.mailer.clear();
    expect((await requestSignInLink('marta.right@example.test')).statusCode).toBe(202);
    expect((await requestSignInLink('marta.typo@example.test')).statusCode).toBe(202);
    expect(a.mailer.messages.map((m) => m.to)).toEqual(['marta.typo@example.test']);
  });

  it('confirmed: the address changes, the next sign-in link goes there, old sign-in links stop working, sessions and passkeys stay, and the old address is told', async () => {
    const jan = await cousin('jan.old');
    const phone = await signIn(t.db, a.clock, jan);
    await t.db
      .insertInto('passkey')
      .values({ account_id: jan.id, credential_id: 'jan-phone-credential', public_key: Buffer.from('key'), device_type: 'multiDevice', name: 'Phone' })
      .execute();
    // A sign-in link that went to the old address before the change, not used yet.
    await requestSignInLink('jan.old@example.test');
    const oldSignInLink = tokenFromEmail(a.mailer.lastTo('jan.old@example.test')!.text);

    await ask(jan.id, 'jan.new@example.test');
    const token = addressToken(a.mailer.lastTo('jan.new@example.test')!.text);
    a.clock.advance(6 * DAY);
    a.mailer.clear();
    const res = await confirm(token);
    expect(res.statusCode).toBe(200);
    expect(EmailChangeConfirmed.parse(res.json())).toEqual({ ok: true, email: 'jan.new@example.test' });
    // Confirming signs nobody in.
    expect(res.headers['set-cookie']).toBeUndefined();

    expect(await addressOf(jan.id)).toBe('jan.new@example.test');
    expect(await listed(jan.id)).toMatchObject({ email: 'jan.new@example.test', pendingEmail: null });

    // The old address got one notice, which names neither the Member nor the new address.
    expect(a.mailer.messages.map((m) => m.to)).toEqual(['jan.old@example.test']);
    const notice = a.mailer.lastTo('jan.old@example.test')!;
    expect(notice.subject).toBe('Rodokmen no longer uses this address');
    expect(notice.text).not.toContain('jan.new');
    expect(notice.text).not.toContain('Cousin jan.old');
    expect(notice.text).toContain(owner.display_name);

    // The old sign-in link is used up; the next one goes to the new address.
    expect(errorOf(await verifySignInLink(oldSignInLink)).code).toBe('link_invalid');
    a.mailer.clear();
    await requestSignInLink('jan.old@example.test');
    await requestSignInLink('jan.new@example.test');
    expect(a.mailer.messages.map((m) => m.to)).toEqual(['jan.new@example.test']);
    expect((await verifySignInLink(tokenFromEmail(a.mailer.lastTo('jan.new@example.test')!.text))).statusCode).toBe(200);

    // Signed in on a phone: the session and the passkey stay.
    const me = await a.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: phone } });
    expect(me.statusCode).toBe(200);
    expect(Me.parse(me.json())).toMatchObject({ email: 'jan.new@example.test', passkeyCount: 1 });

    // The link worked once.
    const again = await confirm(token);
    expect(again.statusCode).toBe(410);
    expect(errorOf(again).code).toBe('address_link_invalid');
  });

  it('asking again replaces the waiting change: the first link is refused, the second works', async () => {
    const eva = await cousin('eva.first');
    await ask(eva.id, 'eva.wrong@example.test');
    const first = addressToken(a.mailer.lastTo('eva.wrong@example.test')!.text);
    await ask(eva.id, 'eva.right@example.test');
    const second = addressToken(a.mailer.lastTo('eva.right@example.test')!.text);
    expect(await listed(eva.id)).toMatchObject({ pendingEmail: 'eva.right@example.test' });
    expect(errorOf(await confirm(first)).code).toBe('address_link_invalid');
    expect(await addressOf(eva.id)).toBe('eva.first@example.test');
    expect((await confirm(second)).statusCode).toBe(200);
    expect(await addressOf(eva.id)).toBe('eva.right@example.test');
  });

  it('two requests at once for one Member leave exactly one change waiting', async () => {
    const lea = await cousin('lea');
    const answers = await Promise.all([ask(lea.id, 'lea.one@example.test'), ask(lea.id, 'lea.two@example.test')]);
    expect(answers.map((r) => r.statusCode)).toEqual([200, 200]);
    const open = await t.db
      .selectFrom('email_change')
      .select('email')
      .where('account_id', '=', lea.id)
      .where('confirmed_at', 'is', null)
      .where('revoked_at', 'is', null)
      .execute();
    expect(open).toHaveLength(1);
    expect((await listed(lea.id)).pendingEmail).toBe(open[0]!.email);
  });

  it('withdrawn: the link stops working, and nothing waits any more', async () => {
    const ota = await cousin('ota');
    await ask(ota.id, 'ota.typo@example.test');
    const token = addressToken(a.mailer.lastTo('ota.typo@example.test')!.text);
    expect((await withdraw(ota.id)).statusCode).toBe(204);
    expect(await listed(ota.id)).toMatchObject({ email: 'ota@example.test', pendingEmail: null });
    expect(errorOf(await confirm(token)).code).toBe('address_link_invalid');
    expect(await addressOf(ota.id)).toBe('ota@example.test');
    expect((await withdraw(ota.id)).statusCode).toBe(404);
  });

  it('expired: a link used after 7 days is refused, and the waiting address is gone from the list', async () => {
    const ida = await cousin('ida');
    await ask(ida.id, 'ida.new@example.test');
    const token = addressToken(a.mailer.lastTo('ida.new@example.test')!.text);
    a.clock.advance(7 * DAY + MINUTE);
    expect(await listed(ida.id)).toMatchObject({ pendingEmail: null });
    const res = await confirm(token);
    expect(res.statusCode).toBe(410);
    expect(errorOf(res)).toMatchObject({ code: 'address_link_invalid', message: expect.stringContaining('Ask the Owner') as unknown });
    expect(await addressOf(ida.id)).toBe('ida@example.test');
    expect((await confirm('x'.repeat(43))).statusCode).toBe(410);
    // Asking again after expiry works.
    expect((await ask(ida.id, 'ida.new@example.test')).statusCode).toBe(200);
  });

  it('refuses the same address, another Member’s, an invited one, an Agent and an unknown id, and sends nothing', async () => {
    const pavel = await cousin('pavel');
    await cousin('pavla');
    const { agent } = await createAgentWithToken(t.db, a.clock, 'Address Agent');
    await a.app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: { cookie: ownerCookie },
      payload: { email: 'invited.cousin@example.test', language: 'en' },
    });
    a.mailer.clear();

    const same = await ask(pavel.id, 'Pavel@example.test');
    expect([same.statusCode, errorOf(same).code]).toEqual([409, 'email_unchanged']);
    const taken = await ask(pavel.id, 'pavla@example.test');
    expect([taken.statusCode, errorOf(taken).code]).toEqual([409, 'already_member']);
    const ownersAddress = await ask(pavel.id, owner.email);
    expect([ownersAddress.statusCode, errorOf(ownersAddress).code]).toEqual([409, 'already_member']);
    const invited = await ask(pavel.id, 'invited.cousin@example.test');
    expect([invited.statusCode, errorOf(invited).code]).toEqual([409, 'invitation_pending']);
    expect(errorOf(invited).message).toContain('Withdraw it first');
    expect((await ask(agent.id, 'agent.address@example.test')).statusCode).toBe(404);
    expect((await ask('0192f0c4-7a1e-7c3b-9d2a-00000000dead', 'nobody@example.test')).statusCode).toBe(404);
    expect((await ask(pavel.id, 'not an address')).statusCode).toBe(400);

    expect(a.mailer.messages).toHaveLength(0);
    expect(await listed(pavel.id)).toMatchObject({ email: 'pavel@example.test', pendingEmail: null });
  });

  it('taken before confirming: confirming is refused, and the Member keeps their old address', async () => {
    const vera = await cousin('vera');
    await ask(vera.id, 'vera.new@example.test');
    const token = addressToken(a.mailer.lastTo('vera.new@example.test')!.text);
    // Meanwhile someone else became a Member with that address.
    await createMember(t.db, 'contributor', { email: 'vera.new@example.test' });
    const res = await confirm(token);
    expect([res.statusCode, errorOf(res).code]).toEqual([409, 'already_member']);
    expect(await addressOf(vera.id)).toBe('vera@example.test');
  });

  it('the confirmation email cannot be sent: the request fails and nothing waits', async () => {
    const olga = await cousin('olga');
    await failingFor('olga.new@example.test', async () => {
      expect((await ask(olga.id, 'olga.new@example.test')).statusCode).toBe(500);
    });
    expect(await listed(olga.id)).toMatchObject({ pendingEmail: null });
    expect(await t.db.selectFrom('email_change').select('id').where('account_id', '=', olga.id).execute()).toEqual([]);
  });

  it('the notice to the old address cannot be sent: the change stays, and the failure is logged', async () => {
    const karel = await cousin('karel');
    await ask(karel.id, 'karel.new@example.test');
    const token = addressToken(a.mailer.lastTo('karel.new@example.test')!.text);
    const logged = vi.spyOn(a.app.log, 'error');
    try {
      await failingFor('karel@example.test', async () => {
        expect((await confirm(token)).statusCode).toBe(200);
      });
      const [logArgs] = logged.mock.calls.filter((call: unknown[]) => call[1] === 'could not tell the old address that Rodokmen no longer uses it');
      expect(z.object({ err: z.instanceof(Error) }).parse(logArgs?.[0]).err.message).toBe('SMTP is down');
    } finally {
      logged.mockRestore();
    }
    expect(await addressOf(karel.id)).toBe('karel.new@example.test');
  });

  it('the Owner corrects their own address the same way', async () => {
    const res = await ask(owner.id, 'owner.new@example.test');
    expect(res.statusCode).toBe(200);
    expect(MemberView.parse(res.json())).toMatchObject({ email: owner.email, pendingEmail: 'owner.new@example.test' });
    expect((await confirm(addressToken(a.mailer.lastTo('owner.new@example.test')!.text))).statusCode).toBe(200);
    expect(await addressOf(owner.id)).toBe('owner.new@example.test');
    // The Owner's session stays.
    expect((await a.app.inject({ method: 'GET', url: '/api/members', headers: { cookie: ownerCookie } })).statusCode).toBe(200);
  });
});
