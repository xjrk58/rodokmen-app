import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { checkRouteCoverage, openApiDocument } from '../src/openapi.js';
import { OPENAPI_FILE, openApiJson } from '../src/ops/openapi-file.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { ensureOwner, makeApp, signIn, testConfig } from './helpers.js';

type Doc = { paths: Record<string, Record<string, { responses?: Record<string, unknown>; security?: unknown[] }>> };

describe('OpenAPI description generated from the shared schemas', () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => t?.drop());

  it('description matches behaviour: every route of the running API is in the description', async () => {
    const { app } = await makeApp(t);
    const doc = openApiDocument(app) as Doc;
    expect(checkRouteCoverage(app.routeRecords, doc)).toEqual([]);
    const apiRoutes = app.routeRecords.filter((r) => r.url.startsWith('/api/') && r.method !== 'HEAD');
    expect(apiRoutes.length).toBeGreaterThan(30);
    // Only the health check and the sign-in steps are public.
    const publicPaths = Object.entries(doc.paths)
      .filter(([, ops]) => Object.values(ops).some((op) => Array.isArray(op.security) && op.security.length === 0))
      .map(([p]) => p);
    expect(publicPaths.filter((p) => !p.startsWith('/api/auth/'))).toEqual(['/api/health']);
    await app.close();
  });

  it('CI route comparison fails when a route is added without a schema', async () => {
    const { app } = await makeApp(t, {
      extraRoutes: (scope) => {
        scope.get('/api/undocumented', async () => ({ secret: true }));
        scope.get('/api/request-schema-only', { schema: { querystring: z.object({ q: z.string() }) } }, async () => ({}));
      },
    });
    const problems = checkRouteCoverage(app.routeRecords, openApiDocument(app) as Doc);
    expect(problems).toEqual(['GET /api/undocumented has no response schema', 'GET /api/request-schema-only has no response schema']);
    // A route hidden from the description is caught too.
    const { app: hidden } = await makeApp(t, { extraRoutes: (scope) => void scope.get('/api/hidden', { schema: { hide: true, response: { 200: z.object({}) } } }, async () => ({})) });
    expect(checkRouteCoverage(hidden.routeRecords, openApiDocument(hidden) as Doc)).toEqual(['GET /api/hidden is missing from the OpenAPI description']);
    await app.close();
    await hidden.close();
  });

  it('the published server/openapi.json is up to date', async () => {
    const { json, problems } = await openApiJson(testConfig(t.url));
    expect(problems).toEqual([]);
    expect(await readFile(OPENAPI_FILE, 'utf8')).toBe(json);
  });

  it('serves the description to Members only', async () => {
    const { app, clock } = await makeApp(t);
    expect((await app.inject({ method: 'GET', url: '/api/openapi.json' })).statusCode).toBe(401);
    const cookie = await signIn(t.db, clock, await ensureOwner(t.db));
    const res = await app.inject({ method: 'GET', url: '/api/openapi.json', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().openapi).toBe('3.1.0');
    expect(res.json().components.schemas.PersonDetail).toBeDefined();
    await app.close();
  });
});
