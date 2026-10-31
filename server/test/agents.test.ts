import { AgentList, CreatedAgent, History, IssuedAgentToken, Me, MemberList, ProposalList, ProposalView, type OperationInput } from '@rodokmen/shared';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/db/types.js';
import { generateFixture } from '../src/fixture/generate.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { bearer, createAgentWithToken, createMember, ensureOwner, errorOf, makeApp, signIn, type TestApp } from './helpers.js';
import { citation, newKey } from './proposal-testbed.js';

const L = generateFixture().landmarks;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** A baptism the way an Agent finds one: a new child, the Event, its Role and the Citation. */
function baptism(given: string): OperationInput[] {
  return [
    { op: 'createPerson', tempId: 'tmp:p', sex: 'female', name: { given, surname: 'Invented', type: 'birth', asFound: `${given} Invented` } },
    { op: 'createEvent', tempId: 'tmp:e', type: 'baptism', date: '1843-04-02', placeId: L.kamennaLhota },
    { op: 'addRole', eventId: 'tmp:e', personId: 'tmp:p', role: 'child' },
    ...citation(given),
    { op: 'attachCitation', citationId: `tmp:cit${given}`, eventId: 'tmp:e' },
  ];
}

describe('Agent accounts belong to the Owner', () => {
  let t: TestDatabase;
  let a: TestApp;
  let owner: Account;
  let ownerCookie: string;

  const asOwner = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    a.app.inject({ method, url, headers: { cookie: ownerCookie }, ...(payload ? { payload } : {}) });
  const withToken = (token: string, url = `/api/persons/${L.janNovak}`) => a.app.inject({ method: 'GET', url, headers: bearer(token) });

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

  it('the Owner creates an Agent with a name and a token, shown in full once; only its hash is stored', async () => {
    const res = await asOwner('POST', '/api/agents', { name: 'Register reader', tokenLabel: 'laptop' });
    expect(res.statusCode).toBe(201);
    const { agent, token } = CreatedAgent.parse(res.json());
    expect(agent.name).toBe('Register reader');
    expect(token.token).toMatch(/^rdk_ag_[0-9a-f]{64}$/);
    expect(token.token.startsWith(token.prefix)).toBe(true);
    expect(token.prefix).toMatch(/^rdk_ag_[0-9a-f]{8}$/);
    expect(token.label).toBe('laptop');

    const stored = await t.db.selectFrom('agent_token').selectAll().where('id', '=', token.id).executeTakeFirstOrThrow();
    expect(stored.token_hash.equals(createHash('sha256').update(token.token).digest())).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(token.token.slice(15));

    // The list shows the prefix, never the token.
    const list = await asOwner('GET', '/api/agents');
    expect(list.body).not.toContain(token.token);
    const listed = AgentList.parse(list.json()).items.find((x) => x.id === agent.id)!;
    expect(listed.tokens.map((x) => x.prefix)).toEqual([token.prefix]);
    expect(listed.tokens[0]).not.toHaveProperty('token');

    // An Agent is an account without email, and the token works at once.
    const me = Me.parse((await withToken(token.token, '/api/me')).json());
    expect(me).toMatchObject({ id: agent.id, role: 'agent', email: null, displayName: 'Register reader' });
    expect(me.permissions).toEqual({ propose: true, review: false, inviteMembers: false, changeRoles: false, disableMembers: false, markFamilyRoots: false });
    expect((await withToken(token.token)).statusCode).toBe(200);
  });

  it('only the Owner creates Agents and issues or revokes their tokens', async () => {
    const editor = await createMember(t.db, 'editor');
    const contributor = await createMember(t.db, 'contributor');
    const { agent, token, tokenId } = await createAgentWithToken(t.db, a.clock);
    for (const cookie of [await signIn(t.db, a.clock, editor), await signIn(t.db, a.clock, contributor)]) {
      const created = await a.app.inject({ method: 'POST', url: '/api/agents', headers: { cookie }, payload: { name: 'Mine' } });
      expect(created.statusCode).toBe(403);
      expect(errorOf(created).message).toBe('Only the Owner can do this.');
      expect((await a.app.inject({ method: 'GET', url: '/api/agents', headers: { cookie } })).statusCode).toBe(403);
      expect((await a.app.inject({ method: 'POST', url: `/api/agents/${agent.id}/tokens`, headers: { cookie }, payload: {} })).statusCode).toBe(403);
      expect((await a.app.inject({ method: 'DELETE', url: `/api/agents/${agent.id}/tokens/${tokenId}`, headers: { cookie } })).statusCode).toBe(403);
    }
    // Nor does an Agent, for itself or another.
    const own = await a.app.inject({ method: 'POST', url: `/api/agents/${agent.id}/tokens`, headers: bearer(token), payload: {} });
    expect(own.statusCode).toBe(403);
    expect(errorOf(own).message).toBe('An Agent may only read the Tree and submit Proposals.');
    expect((await a.app.inject({ method: 'POST', url: '/api/agents', headers: bearer(token), payload: { name: 'Child' } })).statusCode).toBe(403);
    expect(await t.db.selectFrom('agent_token').select('id').where('account_id', '=', agent.id).execute()).toHaveLength(1);
  });

  it('revoking a token: the next request with that token is refused with 401, and the Agent’s other tokens still work', async () => {
    const { agent, token, tokenId } = await createAgentWithToken(t.db, a.clock);
    const second = IssuedAgentToken.parse((await asOwner('POST', `/api/agents/${agent.id}/tokens`, { label: 'server' })).json());
    expect((await withToken(token)).statusCode).toBe(200);

    expect((await asOwner('DELETE', `/api/agents/${agent.id}/tokens/${tokenId}`)).statusCode).toBe(204);
    const refused = await withToken(token);
    expect(refused.statusCode).toBe(401);
    expect(errorOf(refused)).toMatchObject({ code: 'unauthorized', message: 'This token is not valid.' });
    expect((await withToken(second.token)).statusCode).toBe(200);

    const listed = AgentList.parse((await asOwner('GET', '/api/agents')).json()).items.find((x) => x.id === agent.id)!;
    expect(listed.tokens.find((x) => x.id === tokenId)!.revokedAt).toBe(a.clock.now().toISOString());
    expect(listed.tokens.find((x) => x.id === second.id)!.revokedAt).toBeNull();
    // Revoking again changes nothing; a token of another Agent is not found.
    expect((await asOwner('DELETE', `/api/agents/${agent.id}/tokens/${tokenId}`)).statusCode).toBe(204);
    const other = await createAgentWithToken(t.db, a.clock);
    expect((await asOwner('DELETE', `/api/agents/${agent.id}/tokens/${other.tokenId}`)).statusCode).toBe(404);
    expect((await withToken(other.token)).statusCode).toBe(200);
  });

  it('disabling an Agent stops all its tokens at once, until it is enabled again', async () => {
    const { agent, token } = await createAgentWithToken(t.db, a.clock);
    expect((await asOwner('POST', `/api/agents/${agent.id}/disable`)).statusCode).toBe(200);
    expect((await withToken(token)).statusCode).toBe(401);
    expect((await asOwner('POST', `/api/agents/${agent.id}/enable`)).statusCode).toBe(200);
    expect((await withToken(token)).statusCode).toBe(200);
  });

  it('unknown and malformed tokens are refused with 401, also on routes no one may call', async () => {
    for (const value of ['rdk_ag_' + '0'.repeat(64), 'rdk_ag_short', 'not-a-token', '']) {
      const res = await withToken(value);
      expect(res.statusCode, value).toBe(401);
      expect(errorOf(res).message).toBe('This token is not valid.');
      expect((await a.app.inject({ method: 'POST', url: '/api/agents', headers: bearer(value), payload: { name: 'x' } })).statusCode).toBe(401);
    }
  });

  it('an Agent is not a Member: not in the Member list, no role change, no session, no sign-in link', async () => {
    const { agent } = await createAgentWithToken(t.db, a.clock, 'Listed nowhere');
    const members = MemberList.parse((await asOwner('GET', '/api/members')).json()).items;
    expect(members.map((m) => m.id)).not.toContain(agent.id);
    const role = await a.app.inject({ method: 'PUT', url: `/api/members/${agent.id}/role`, headers: { cookie: ownerCookie }, payload: { role: 'editor' } });
    expect(role.statusCode).toBe(404);
    expect((await asOwner('POST', `/api/members/${agent.id}/disable`)).statusCode).toBe(404);
    await expect(signIn(t.db, a.clock, agent)).rejects.toThrow(/signs in only with a token/);
    await expect(
      t.db.insertInto('account').values({ email: 'agent@example.test', display_name: 'x', language: 'en', role: 'agent' }).execute(),
    ).rejects.toThrow(/account_agent_no_email/);
  });
});

describe('Read and propose only', () => {
  let t: TestDatabase;
  let a: TestApp;
  let editorCookie: string;
  let agent: Account;
  let token: string;

  const asAgent = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    a.app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });
  const asEditor = (method: 'GET' | 'POST', url: string, payload?: object) =>
    a.app.inject({ method, url, headers: { cookie: editorCookie }, ...(payload ? { payload } : {}) });
  const submit = (operations: OperationInput[], extra: Record<string, unknown> = {}) =>
    asAgent('POST', '/api/proposals', { formatVersion: 1, idempotencyKey: newKey(), note: 'Found in the register', operations, ...extra });
  const statusOf = async (id: string) => (await t.db.selectFrom('proposal').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status;

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t);
    await ensureOwner(t.db);
    editorCookie = await signIn(t.db, a.clock, await createMember(t.db, 'editor', { displayName: 'Eva Editor' }));
    ({ agent, token } = await createAgentWithToken(t.db, a.clock, 'Register reader'));
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  it('an Agent reads the Tree and submits a Proposal, which waits for review', async () => {
    expect((await asAgent('GET', `/api/persons/${L.janNovak}/ancestors`)).statusCode).toBe(200);
    expect((await asAgent('GET', '/api/places?q=Kamenn')).statusCode).toBe(200);
    const res = await submit(baptism('Apolonie'));
    expect(res.statusCode, res.body).toBe(201);
    const p = ProposalView.parse(res.json());
    expect(p).toMatchObject({ status: 'pending', kind: 'contribution', author: { id: agent.id, displayName: 'Register reader', isAgent: true } });
    // It sees its own Proposals, not anyone else's, and not the review queue.
    expect(ProposalList.parse((await asAgent('GET', '/api/proposals')).json()).items.map((x) => x.id)).toEqual([p.id]);
  });

  it('Agent tries to accept its own Proposal: 403, and the Proposal stays pending', async () => {
    const p = ProposalView.parse((await submit(baptism('Bohumila'))).json());
    const res = await asAgent('POST', `/api/proposals/${p.id}/accept`, {});
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toMatchObject({ code: 'forbidden', message: 'An Agent may only read the Tree and submit Proposals.' });
    expect(await statusOf(p.id)).toBe('pending');
    // Nor reject it, see the queue, or undo or merge anything.
    expect((await asAgent('POST', `/api/proposals/${p.id}/reject`, { note: 'no' })).statusCode).toBe(403);
    expect((await asAgent('GET', '/api/review')).statusCode).toBe(403);
    expect((await asAgent('GET', `/api/proposals/${p.id}/undo`)).statusCode).toBe(403);
    expect((await asAgent('POST', `/api/proposals/${p.id}/undo`, { choices: [] })).statusCode).toBe(403);
    const merge = { mergeId: L.adoptedChild, keepBaseVersion: 1, mergeBaseVersion: 1, note: null };
    expect((await asAgent('POST', `/api/persons/${L.janNovak}/merge`, merge)).statusCode).toBe(403);
    expect(await statusOf(p.id)).toBe('pending');
  });

  it('a direct edit attempt by an Agent: 403, and nothing is created or changed', async () => {
    const before = await t.db.selectFrom('proposal').select('id').where('author_id', '=', agent.id).execute();
    const direct = await submit(baptism('Cecílie'), { direct: true });
    expect(direct.statusCode).toBe(403);
    expect(errorOf(direct).message).toBe('Only Editors change the Tree directly. Submit a Proposal for review instead.');
    // A merge inside a Proposal is an Editor's direct change too.
    const merge = await submit([{ op: 'mergePersons', keepId: L.janNovak, mergeId: L.adoptedChild, keepBaseVersion: 1, mergeBaseVersion: 1 }]);
    expect(merge.statusCode).toBe(403);
    expect(await t.db.selectFrom('proposal').select('id').where('author_id', '=', agent.id).execute()).toEqual(before);
    expect(await t.db.selectFrom('log_entry').select('id').where('author_id', '=', agent.id).execute()).toEqual([]);
  });

  it('no account management, and none of the account routes of a Member', async () => {
    for (const [method, url] of [
      ['GET', '/api/members'],
      ['GET', '/api/invitations'],
      ['POST', '/api/invitations'],
      ['GET', '/api/agents'],
      ['GET', '/api/me/sessions'],
      ['GET', '/api/me/passkeys'],
      ['GET', '/api/me/notifications'],
      ['PUT', '/api/me/notifications'],
      ['POST', '/api/auth/passkey/registration/options'],
    ] as const) {
      expect((await asAgent(method, url, method === 'GET' ? undefined : {})).statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('every route asks the role-and-action rule: an Agent gets 403 exactly where the route does more than read or propose', async () => {
    const UNKNOWN = '0192f0c4-7a1e-7c3b-9d2a-00000000beef';
    const routes = a.app.routeRecords.filter((r) => r.url.startsWith('/api/') && !r.public && r.method !== 'HEAD' && r.url !== '/api/*');
    let refused = 0;
    let allowed = 0;
    for (const r of routes) {
      expect(r.action, `${r.method} ${r.url}`).not.toBeNull();
      const url = r.url
        .replace(/:tokenId/g, UNKNOWN)
        .replace(/:id/g, UNKNOWN)
        .replace(/:kind/g, 'person');
      const method = METHODS.find((m) => m === r.method);
      if (!method) throw new Error(`unexpected method ${r.method}`);
      const res = await asAgent(method, url, method === 'GET' || method === 'DELETE' ? undefined : {});
      if (r.action === 'read' || r.action === 'propose') {
        expect(res.statusCode, `${r.method} ${url}`).not.toBe(403);
        allowed++;
      } else {
        expect(res.statusCode, `${r.method} ${url}`).toBe(403);
        refused++;
      }
    }
    expect(refused).toBeGreaterThan(15);
    expect(allowed).toBeGreaterThan(20);
  });

  it('reviewing an Agent Proposal: the Agent’s name and badge are next to the author, in the queue and in record history', async () => {
    const p = ProposalView.parse((await submit(baptism('Dorota'))).json());
    const queue = ProposalList.parse((await asEditor('GET', '/api/review')).json()).items.find((x) => x.id === p.id)!;
    expect(queue.author).toEqual({ id: agent.id, displayName: 'Register reader', isAgent: true });
    const accepted = ProposalView.parse((await asEditor('POST', `/api/proposals/${p.id}/accept`, {})).json());
    expect(accepted.status).toBe('accepted');
    const person = (
      await t.db
        .selectFrom('log_change as c')
        .innerJoin('log_entry as l', 'l.id', 'c.log_entry_id')
        .select('c.record_id')
        .where('l.proposal_id', '=', p.id)
        .where('c.record_table', '=', 'person')
        .executeTakeFirstOrThrow()
    ).record_id;
    const history = History.parse((await asAgent('GET', `/api/history/person/${person}`)).json());
    expect(history.items[0]!.author).toEqual({ id: agent.id, displayName: 'Register reader', isAgent: true });
    expect(history.items[0]!.acceptedBy.isAgent).toBe(false);
  });
});
