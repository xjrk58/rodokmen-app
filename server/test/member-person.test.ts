import { ApiError, Me, MemberList, MemberView } from '@rodokmen/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateFixture } from '../src/fixture/generate.js';
import type { Account } from '../src/db/types.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, makeApp, signIn, type TestApp } from './helpers.js';

// add-family-view tasks 2a.5 and 2.4: the Owner links a Member to their Person (me.person), and
// every Member changes their own language.
const L = generateFixture().landmarks;
const UNKNOWN = '0192f0c4-7a1e-7c3b-9d2a-000000000000';

describe("the Member's own Person and own settings", () => {
  let t: TestDatabase;
  let a: TestApp;
  let owner: Account;
  let ownerCookie: string;
  let member: Account;
  let memberCookie: string;
  const call = async (cookie: string, method: 'GET' | 'PUT' | 'PATCH', url: string, payload?: object) =>
    a.app.inject({ method, url, headers: { cookie, origin: a.config.publicOrigin }, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t);
    owner = await ensureOwner(t.db);
    ownerCookie = await signIn(t.db, a.clock, owner);
    member = await createMember(t.db, 'contributor', { displayName: 'Bohdana Invented', language: 'en' });
    memberCookie = await signIn(t.db, a.clock, member);
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  it('a Member starts without a linked Person', async () => {
    expect(Me.parse((await call(memberCookie, 'GET', '/api/me')).json()).person).toBeNull();
  });

  it('new Member: the Owner links them, and /api/me then names their own Person', async () => {
    const res = await call(ownerCookie, 'PUT', `/api/members/${member.id}/person`, { personId: L.proband });
    expect(res.statusCode, res.body).toBe(200);
    expect(MemberView.parse(res.json()).person?.id).toBe(L.proband);
    const me = Me.parse((await call(memberCookie, 'GET', '/api/me')).json());
    expect(me.person?.id).toBe(L.proband);
    expect(me.person?.surname).not.toBe('');
    // The Owner sees the link in the list of Members.
    const list = MemberList.parse((await call(ownerCookie, 'GET', '/api/members')).json());
    expect(list.items.find((m) => m.id === member.id)?.person?.id).toBe(L.proband);
    expect(list.items.find((m) => m.id === owner.id)?.person).toBeNull();
  });

  it('only the Owner links, only to a Person that exists, and null removes the link', async () => {
    const editor = await createMember(t.db, 'editor');
    const editorCookie = await signIn(t.db, a.clock, editor);
    const refused = await call(editorCookie, 'PUT', `/api/members/${member.id}/person`, { personId: L.janNovak });
    expect(refused.statusCode).toBe(403);
    expect((await call(memberCookie, 'PUT', `/api/members/${member.id}/person`, { personId: L.janNovak })).statusCode).toBe(403);
    const unknownPerson = await call(ownerCookie, 'PUT', `/api/members/${member.id}/person`, { personId: UNKNOWN });
    expect(unknownPerson.statusCode).toBe(404);
    expect(ApiError.parse(unknownPerson.json()).code).toBe('person_not_found');
    expect((await call(ownerCookie, 'PUT', `/api/members/${UNKNOWN}/person`, { personId: L.janNovak })).statusCode).toBe(404);
    expect(Me.parse((await call(memberCookie, 'GET', '/api/me')).json()).person?.id).toBe(L.proband);

    expect(MemberView.parse((await call(ownerCookie, 'PUT', `/api/members/${member.id}/person`, { personId: null })).json()).person).toBeNull();
    expect(Me.parse((await call(memberCookie, 'GET', '/api/me')).json()).person).toBeNull();
  });

  it('a link to a Person merged later follows the merge to the kept Person', async () => {
    // A Person needs a primary Name when the transaction ends, and a merged one has none.
    const merged = await t.db.transaction().execute(async (tx) => {
      const p = await tx.insertInto('person').values({ sex: 'female' }).returning('id').executeTakeFirstOrThrow();
      await tx.insertInto('name').values({ person_id: p.id, given: 'Dana', surname: 'Invented', type: 'birth', as_found: 'Dana', is_primary: true }).execute();
      return p;
    });
    expect((await call(ownerCookie, 'PUT', `/api/members/${member.id}/person`, { personId: merged.id })).statusCode).toBe(200);
    await t.db.transaction().execute(async (tx) => {
      await tx.deleteFrom('name').where('person_id', '=', merged.id).execute();
      await tx.updateTable('person').set({ merged_into_id: L.janNovak }).where('id', '=', merged.id).execute();
    });
    expect(Me.parse((await call(memberCookie, 'GET', '/api/me')).json()).person?.id).toBe(L.janNovak);
    await call(ownerCookie, 'PUT', `/api/members/${member.id}/person`, { personId: null });
  });

  it("a Member changes their own language and display name, and nobody else's", async () => {
    const res = await call(memberCookie, 'PATCH', '/api/me', { language: 'cs' });
    expect(res.statusCode, res.body).toBe(200);
    expect(Me.parse(res.json())).toMatchObject({ language: 'cs', displayName: 'Bohdana Invented' });
    expect(Me.parse((await call(memberCookie, 'PATCH', '/api/me', { displayName: '  Bohda  ' })).json())).toMatchObject({
      language: 'cs',
      displayName: 'Bohda',
    });
    expect((await t.db.selectFrom('account').select('language').where('id', '=', owner.id).executeTakeFirstOrThrow()).language).toBe('cs');
    for (const body of [{}, { language: 'de' }, { displayName: '   ' }]) {
      expect((await call(memberCookie, 'PATCH', '/api/me', body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await a.app.inject({ method: 'PATCH', url: '/api/me', payload: { language: 'en' } })).statusCode).toBe(401);
  });
});
