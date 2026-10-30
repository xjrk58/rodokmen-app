import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateFixture } from '../src/fixture/generate.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { createMember, ensureOwner, makeApp, signIn, type TestApp } from './helpers.js';

const L = generateFixture().landmarks;
const UNKNOWN = '0192f0c4-7a1e-7c3b-9d2a-00000000beef';
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

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
      const method = METHODS.find((m) => m === r.method);
      if (!method) continue;
      const res = await a.app.inject({ method, url, payload: method === 'GET' || method === 'DELETE' ? undefined : {} });
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
    const forged = await a.app.inject({
      method: 'GET',
      url: `/api/persons/${L.janNovak}`,
      headers: { cookie: 'rdk_session=forged-token-forged-token-forged' },
    });
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
    const res = await a.app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: { cookie, origin: 'https://evil.example' },
      payload: { email: 'x@example.test', language: 'en' },
    });
    expect(res.statusCode).toBe(403);
    const sameOrigin = await a.app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: { cookie, origin: a.config.publicOrigin },
      payload: { email: 'x@example.test', language: 'en' },
    });
    expect(sameOrigin.statusCode).toBe(201);
  });
});

/**
 * The router decodes and normalises paths before it matches them, so the check must follow the
 * route that was matched, not the URL as written. Each of these reaches, or tries to reach, a
 * Person, the Owner's Member list or a register page image without a session.
 */
const PERSON = `/persons/${L.janNovak}`;
const ODD_PATHS = [
  `/%61pi${PERSON}`,
  `/ap%69${PERSON}`,
  `/%61%70%69${PERSON}`,
  `//api${PERSON}`,
  `/api/.${PERSON}`,
  `/api/x/..${PERSON}`,
  `/API${PERSON}`,
  `/api${PERSON}%2F`,
  `/api${PERSON}/`,
  `/api%2Fpersons/${L.janNovak}`,
  '/%61pi/places?q=a',
  '/%61pi/members',
  '/%61pi/me',
  `/%61pi/images/${L.pageImage}`,
  `/api/images/${L.pageImage}%2F`,
];

describe('odd encodings of API paths never skip the session check', () => {
  let t: TestDatabase;
  let appDir: string;
  let bare: TestApp;
  let withMap: TestApp;

  beforeAll(async () => {
    t = await createTestDatabase();
    // With the map app present, its catch-all file route answers every path no other route takes.
    appDir = await mkdtemp(join(tmpdir(), 'rdk-app-'));
    await writeFile(join(appDir, 'index.html'), '<!doctype html><title>map</title>');
    bare = await makeApp(t);
    withMap = await makeApp(t, { config: { APP_DIR: appDir } });
  });
  afterAll(async () => {
    await bare?.app.close();
    await withMap?.app.close();
    await t?.drop();
    await rm(appDir, { recursive: true, force: true });
  });

  for (const setup of ['without the map app', 'with the map app'] as const) {
    it(`anonymous: no Tree data, image link or 500 for any of them, ${setup}`, async () => {
      const { app } = setup === 'with the map app' ? withMap : bare;
      for (const url of ODD_PATHS) {
        const res = await app.inject({ method: 'GET', url });
        // 403: the map app's file server refuses paths such as `//api/…` itself.
        expect([401, 403, 404], `${url} answered ${res.statusCode}`).toContain(res.statusCode);
        expect(res.headers.location, url).toBeUndefined();
        expect(res.body, url).not.toContain(L.janNovak);
        expect(res.body, url).not.toContain('Novák');
      }
    });

    it(`anonymous: paths the router sends to an API route answer 401, ${setup}`, async () => {
      const { app } = setup === 'with the map app' ? withMap : bare;
      for (const url of [
        `/%61pi${PERSON}`,
        `/ap%69${PERSON}`,
        '/%61pi/me',
        '/%61pi/members',
        `/%61pi/images/${L.pageImage}`,
        '/api/no-such-route',
        '/%61pi/no-such-route',
        '/api',
      ]) {
        expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(401);
      }
    });
  }

  it('the sign-in pages, their files and the map app stay public', async () => {
    for (const url of ['/auth/sign-in', '/auth/invite', '/auth/auth.js', '/auth/auth.css']) {
      expect((await bare.app.inject({ method: 'GET', url })).statusCode, url).toBe(200);
      expect((await bare.app.inject({ method: 'HEAD', url })).statusCode, `HEAD ${url}`).toBe(200);
    }
    expect((await bare.app.inject({ method: 'GET', url: '/' })).statusCode).toBe(200);
    const map = await withMap.app.inject({ method: 'GET', url: '/' });
    expect(map.statusCode).toBe(200);
    expect(map.body).toContain('<title>map</title>');
    expect((await withMap.app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
  });

  it('signed in, an unknown API path is a 404, also with the map app', async () => {
    await ensureOwner(t.db);
    const cookie = await signIn(t.db, withMap.clock, await createMember(t.db));
    for (const { app } of [bare, withMap]) {
      const res = await app.inject({ method: 'GET', url: '/api/no-such-route', headers: { cookie } });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: 'not_found' });
      expect((await app.inject({ method: 'GET', url: `/api${PERSON}`, headers: { cookie } })).statusCode).toBe(200);
    }
  });
});
