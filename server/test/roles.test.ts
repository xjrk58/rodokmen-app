import { Me, MemberList, MemberView, SessionList } from '@rodokmen/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, errorOf, makeApp, signIn, type TestApp } from './helpers.js';

describe('roles, the single Owner, sessions and disabling', () => {
  let t: TestDatabase;
  let a: TestApp;
  let owner: Account;
  let ownerCookie: string;

  const me = async (cookie: string) => a.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
  const setRole = (id: string, role: string, cookie = ownerCookie) =>
    a.app.inject({ method: 'PUT', url: `/api/members/${id}/role`, headers: { cookie }, payload: { role } });
  const owners = async () => (await t.db.selectFrom('account').select('id').where('role', '=', 'owner').execute()).map((r) => r.id);

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t);
    owner = await ensureOwner(t.db);
    ownerCookie = await signIn(t.db, a.clock, owner);
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  it('every new Member is a Contributor', async () => {
    const m = await createMember(t.db);
    expect(m.role).toBe('contributor');
  });

  it('promoting an Editor: the Member can review from their next request on', async () => {
    const member = await createMember(t.db, 'contributor');
    const cookie = await signIn(t.db, a.clock, member);
    expect(Me.parse((await me(cookie)).json()).permissions.review).toBe(false);

    const res = await setRole(member.id, 'editor');
    expect(res.statusCode).toBe(200);
    expect(MemberView.parse(res.json()).role).toBe('editor');

    // Same session, next request: the role is read on every request.
    const after = Me.parse((await me(cookie)).json());
    expect(after.role).toBe('editor');
    expect(after.permissions).toEqual({ propose: true, review: true, inviteMembers: false, changeRoles: false, disableMembers: false, markFamilyRoots: false });
  });

  it('only the Owner changes roles', async () => {
    const editor = await createMember(t.db, 'editor');
    const target = await createMember(t.db);
    const res = await setRole(target.id, 'editor', await signIn(t.db, a.clock, editor));
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).message).toBe('Only the Owner can do this.');
  });

  it('there is exactly one Owner: handing over ownership makes the old Owner an Editor', async () => {
    expect(await owners()).toEqual([owner.id]);
    expect((await setRole(owner.id, 'editor')).statusCode).toBe(409);

    const heir = await createMember(t.db, 'editor');
    const res = await setRole(heir.id, 'owner');
    expect(res.statusCode).toBe(200);
    expect(await owners()).toEqual([heir.id]);
    expect(Me.parse((await me(ownerCookie)).json()).role).toBe('editor');
    // The old Owner can no longer change roles; the new one hands ownership back.
    expect((await setRole(heir.id, 'contributor')).statusCode).toBe(403);
    const heirCookie = await signIn(t.db, a.clock, heir);
    expect((await setRole(owner.id, 'owner', heirCookie)).statusCode).toBe(200);
    expect(await owners()).toEqual([owner.id]);

    // The database refuses a second Owner, whatever the code does.
    await expect(t.db.updateTable('account').set({ role: 'owner' }).where('id', '=', heir.id).execute()).rejects.toThrow(/account_one_owner_idx/);
    await expect(t.db.updateTable('account').set({ role: 'editor' }).where('id', '=', owner.id).execute()).rejects.toThrow(/exactly one Owner/);
  });

  it('a Member sees and ends their own sessions, and only their own', async () => {
    const member = await createMember(t.db);
    const phone = await signIn(t.db, a.clock, member);
    const tablet = await signIn(t.db, a.clock, member);
    const list = SessionList.parse((await a.app.inject({ method: 'GET', url: '/api/me/sessions', headers: { cookie: phone } })).json()).items;
    expect(list).toHaveLength(2);
    const tabletSession = list.find((s) => !s.current)!;
    // Someone else cannot end it.
    expect((await a.app.inject({ method: 'DELETE', url: `/api/me/sessions/${tabletSession.id}`, headers: { cookie: ownerCookie } })).statusCode).toBe(404);
    expect((await a.app.inject({ method: 'DELETE', url: `/api/me/sessions/${tabletSession.id}`, headers: { cookie: phone } })).statusCode).toBe(204);
    expect((await me(tablet)).statusCode).toBe(401);
    expect((await me(phone)).statusCode).toBe(200);
  });

  it('disabling a Member: their open app sessions stop working on their next request', async () => {
    const member = await createMember(t.db);
    const phone = await signIn(t.db, a.clock, member);
    const laptop = await signIn(t.db, a.clock, member);
    expect((await me(phone)).statusCode).toBe(200);

    const res = await a.app.inject({ method: 'POST', url: `/api/members/${member.id}/disable`, headers: { cookie: ownerCookie } });
    expect(res.statusCode).toBe(200);
    expect(MemberView.parse(res.json()).disabled).toBe(true);

    for (const cookie of [phone, laptop]) {
      expect((await me(cookie)).statusCode).toBe(401);
      expect((await a.app.inject({ method: 'GET', url: '/api/persons', headers: { cookie } })).statusCode).toBe(401);
    }
    const open = await t.db.selectFrom('session').select('id').where('account_id', '=', member.id).where('ended_at', 'is', null).execute();
    expect(open).toEqual([]);
    // No new sign-in either, until enabled again.
    a.mailer.clear();
    await a.app.inject({ method: 'POST', url: '/api/auth/email-link', payload: { email: member.email } });
    expect(a.mailer.messages).toHaveLength(0);
    expect(
      MemberView.parse((await a.app.inject({ method: 'POST', url: `/api/members/${member.id}/enable`, headers: { cookie: ownerCookie } })).json()).disabled,
    ).toBe(false);
  });

  it('the Owner cannot be disabled, and only the Owner disables', async () => {
    expect((await a.app.inject({ method: 'POST', url: `/api/members/${owner.id}/disable`, headers: { cookie: ownerCookie } })).statusCode).toBe(409);
    const editor = await signIn(t.db, a.clock, await createMember(t.db, 'editor'));
    const target = await createMember(t.db);
    expect((await a.app.inject({ method: 'POST', url: `/api/members/${target.id}/disable`, headers: { cookie: editor } })).statusCode).toBe(403);
    const list = await a.app.inject({ method: 'GET', url: '/api/members', headers: { cookie: ownerCookie } });
    expect(MemberList.parse(list.json()).items.length).toBeGreaterThan(5);
  });
});
