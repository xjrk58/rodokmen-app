import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateFixture } from '../src/fixture/generate.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, makeApp, signIn, type TestApp } from './helpers.js';

const L = generateFixture().landmarks;
const UNKNOWN = '0192f0c4-7a1e-7c3b-9d2a-00000000beef';

describe('Members and Agents only', () => {
  let t: TestDatabase;
  let a: TestApp;

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await makeApp(t);
  });
  afterAll(async () => {
    await a?.app.close();
    await t?.drop();
  });

  it('anonymous request: 401 for a Person, and the same answer whether the Person exists or not', async () => {
    const known = await a.app.inject({ method: 'GET', url: `/api/persons/${L.janNovak}` });
    const unknown = await a.app.inject({ method: 'GET', url: `/api/persons/${UNKNOWN}` });
    const malformed = await a.app.inject({ method: 'GET', url: '/api/persons/not-an-id' });
    for (const res of [known, unknown, malformed]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ statusCode: 401, error: 'Unauthorized', message: 'Sign in to continue.', code: 'unauthorized' });
    }
    expect(known.body).toBe(unknown.body);
    expect(known.headers['content-length']).toBe(unknown.headers['content-length']);
  });

  it('answers 401 on every non-public API route, and on unknown API paths', async () => {
    const routes = a.app.routeRecords.filter((r) => r.url.startsWith('/api/') && r.method !== 'HEAD');
    let checked = 0;
    for (const r of routes) {
      const url = r.url.replace(/:id/g, UNKNOWN);
      const res = await a.app.inject({ method: r.method as 'GET', url, payload: r.method === 'GET' || r.method === 'DELETE' ? undefined : {} });
      const isPublic = url === '/api/health' || (url.startsWith('/api/auth/') && !url.startsWith('/api/auth/passkey/registration'));
      if (isPublic) {
        expect(res.statusCode, `${r.method} ${url}`).not.toBe(401);
      } else {
        expect(res.statusCode, `${r.method} ${url}`).toBe(401);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(25);
    expect((await a.app.inject({ method: 'GET', url: '/api/no-such-route' })).statusCode).toBe(401);
  });

  it('refuses tokens until Agent accounts exist, and unknown or ended sessions', async () => {
    const bearer = await a.app.inject({ method: 'GET', url: `/api/persons/${L.janNovak}`, headers: { authorization: 'Bearer rdk_ag_0000000000000000000000' } });
    expect(bearer.statusCode).toBe(401);
    const forged = await a.app.inject({ method: 'GET', url: `/api/persons/${L.janNovak}`, headers: { cookie: 'rdk_session=forged-token-forged-token-forged' } });
    expect(forged.statusCode).toBe(401);
  });

  it('the health check is open to anyone', async () => {
    const res = await a.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', database: 'ok', release: 'test' });
  });

  it('signed in, the same request is answered, and an unknown id is a 404', async () => {
    await ensureOwner(t.db);
    const cookie = await signIn(t.db, a.clock, await createMember(t.db));
    expect((await a.app.inject({ method: 'GET', url: `/api/persons/${L.janNovak}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await a.app.inject({ method: 'GET', url: `/api/persons/${UNKNOWN}`, headers: { cookie } })).statusCode).toBe(404);
  });

  it('refuses cookie-authenticated writes from another origin', async () => {
    const cookie = await signIn(t.db, a.clock, await ensureOwner(t.db));
    const res = await a.app.inject({ method: 'POST', url: '/api/invitations', headers: { cookie, origin: 'https://evil.example' }, payload: { email: 'x@example.test', language: 'en' } });
    expect(res.statusCode).toBe(403);
    const sameOrigin = await a.app.inject({ method: 'POST', url: '/api/invitations', headers: { cookie, origin: a.config.publicOrigin }, payload: { email: 'x@example.test', language: 'en' } });
    expect(sameOrigin.statusCode).toBe(201);
  });
});
