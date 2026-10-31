import { AgentList, IssuedAgentToken, RateLimited } from '@rodokmen/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateFixture } from '../src/fixture/generate.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { bearer, createAgentWithToken, createMember, ensureOwner, makeApp, MINUTE, signIn, TestClock, type TestApp } from './helpers.js';
import { citation, newKey } from './proposal-testbed.js';

const L = generateFixture().landmarks;
const HOUR = 60 * MINUTE;

/** A Proposal with a Citation and one fact: a baptism of a new Person. */
const proposal = (n: number) => ({
  formatVersion: 1,
  idempotencyKey: newKey(),
  note: `finding ${n}`,
  operations: [
    { op: 'createPerson', tempId: 'tmp:p', sex: 'male', name: { given: 'Vavřinec', surname: 'Invented', type: 'birth', asFound: `Laurentius ${n}` } },
    { op: 'createEvent', tempId: 'tmp:e', type: 'baptism', date: '1844', placeId: L.kamennaLhota },
    { op: 'addRole', eventId: 'tmp:e', personId: 'tmp:p', role: 'child' },
    ...citation(String(n)),
    { op: 'attachCitation', citationId: `tmp:cit${n}`, eventId: 'tmp:e' },
  ],
});

describe('Rate limits', () => {
  let t: TestDatabase;
  let a: TestApp;
  const clock = new TestClock(new Date('2026-10-30T09:00:00Z'));

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t, { clock });
    await ensureOwner(t.db);
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  const submit = (token: string, n: number) => a.app.inject({ method: 'POST', url: '/api/proposals', headers: bearer(token), payload: proposal(n) });
  const read = (token: string) => a.app.inject({ method: 'GET', url: `/api/persons/${L.janNovak}`, headers: bearer(token) });

  it('runaway agent: its 61st Proposal within one hour is refused with 429 and the time after which it may submit again', async () => {
    const { agent, token } = await createAgentWithToken(t.db, clock, 'Runaway');
    const start = clock.now();
    for (let n = 1; n <= 60; n++) {
      const res = await submit(token, n);
      expect(res.statusCode, `Proposal ${n}: ${res.body}`).toBe(201);
      clock.advance(MINUTE / 2);
    }
    // 30 minutes in: the 61st is refused, and nothing is stored.
    const refused = await submit(token, 61);
    expect(refused.statusCode).toBe(429);
    const body = RateLimited.parse(refused.json());
    const windowEnd = new Date(start.getTime() + HOUR);
    expect(body).toMatchObject({ statusCode: 429, code: 'rate_limited', retryAt: windowEnd.toISOString() });
    expect(body.message).toContain(windowEnd.toISOString());
    expect(refused.headers['retry-after']).toBe(String((windowEnd.getTime() - clock.now().getTime()) / 1000));
    expect(await t.db.selectFrom('proposal').select('id').where('author_id', '=', agent.id).execute()).toHaveLength(60);

    // Reads are counted apart and still answer.
    expect((await read(token)).statusCode).toBe(200);
    // Still refused a second before the window ends; allowed from its end on, in a new window.
    clock.current = new Date(windowEnd.getTime() - 1000);
    expect((await submit(token, 62)).statusCode).toBe(429);
    clock.current = windowEnd;
    expect((await submit(token, 63)).statusCode).toBe(201);
    expect(await t.db.selectFrom('proposal').select('id').where('author_id', '=', agent.id).execute()).toHaveLength(61);
  });

  it('1,000 reads per hour; the 1,001st is refused with its retry time', async () => {
    const { agent, token } = await createAgentWithToken(t.db, clock, 'Reader');
    const start = clock.now();
    expect((await read(token)).statusCode).toBe(200);
    // Fast-forward the counter to 999 reads in this window (the counting itself is tested above).
    await t.db.updateTable('agent_rate_window').set({ count: 999 }).where('account_id', '=', agent.id).where('kind', '=', 'read').execute();
    clock.advance(10 * MINUTE);
    expect((await read(token)).statusCode).toBe(200);
    const refused = await read(token);
    expect(refused.statusCode).toBe(429);
    expect(RateLimited.parse(refused.json()).retryAt).toBe(new Date(start.getTime() + HOUR).toISOString());
    // Searches and the Agent's own account count as reads too.
    expect((await a.app.inject({ method: 'GET', url: '/api/places?q=Lhota', headers: bearer(token) })).statusCode).toBe(429);
    expect((await a.app.inject({ method: 'GET', url: '/api/me', headers: bearer(token) })).statusCode).toBe(429);
  });

  it('the limits are per Agent: a second token does not give more', async () => {
    const owner = await ensureOwner(t.db);
    const first = await createAgentWithToken(t.db, clock, 'Two tokens');
    const second = await a.app.inject({
      method: 'POST',
      url: `/api/agents/${first.agent.id}/tokens`,
      headers: { cookie: await signIn(t.db, clock, owner) },
      payload: {},
    });
    const token2 = IssuedAgentToken.parse(second.json()).token;
    for (let n = 1; n <= 30; n++) expect((await submit(first.token, 100 + n)).statusCode).toBe(201);
    for (let n = 1; n <= 30; n++) expect((await submit(token2, 200 + n)).statusCode).toBe(201);
    expect((await submit(token2, 300)).statusCode).toBe(429);
    expect((await submit(first.token, 301)).statusCode).toBe(429);

    // The Owner sees the use of both windows.
    const list = AgentList.parse((await a.app.inject({ method: 'GET', url: '/api/agents', headers: { cookie: await signIn(t.db, clock, owner) } })).json());
    const usage = list.items.find((x) => x.id === first.agent.id)!.usage;
    expect(usage.proposals).toMatchObject({ count: 60, limit: 60 });
    expect(usage.reads).toMatchObject({ count: 0, limit: 1000, windowEndsAt: null });
  });

  it('refused requests do not count, and Members have no limit', async () => {
    const { agent, token } = await createAgentWithToken(t.db, clock, 'Refused');
    for (let i = 0; i < 5; i++) expect((await a.app.inject({ method: 'GET', url: '/api/review', headers: bearer(token) })).statusCode).toBe(403);
    expect(await t.db.selectFrom('agent_rate_window').selectAll().where('account_id', '=', agent.id).execute()).toEqual([]);

    const member = await createMember(t.db, 'contributor');
    const cookie = await signIn(t.db, clock, member);
    for (let n = 1; n <= 61; n++) {
      const res = await a.app.inject({ method: 'POST', url: '/api/proposals', headers: { cookie }, payload: proposal(400 + n) });
      expect(res.statusCode, res.body).toBe(201);
    }
  });
});
