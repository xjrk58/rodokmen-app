import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appContentSecurityPolicy, mapSources, readMapSources, sourceOfTemplate } from '../src/csp.js';
import { DEFAULT_APP_DIR } from '../src/routes/pages.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { makeApp, type TestApp } from './helpers.js';

/** The app's Content-Security-Policy and Referrer-Policy (issue #52); csp.e2e.test.ts runs the app under them. */
const FILES = 'https://files.rodokmen.dev';
const OSM = 'https://tile.openstreetmap.org';
const CENIA = 'https://geoportal.gov.cz';

const policy = (remote: string) =>
  [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' data: blob: ${remote}`,
    `connect-src 'self' ${remote}`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

describe('the policy, from the image host and the map layers', () => {
  it('takes scheme and host of a tile or service URL, and nothing else', () => {
    expect(sourceOfTemplate('https://tile.openstreetmap.org/{z}/{x}/{y}.png')).toBe(OSM);
    expect(sourceOfTemplate('https://{s}.tile.example.org/{z}/{x}/{y}.png')).toBe('https://*.tile.example.org');
    expect(sourceOfTemplate('https://Maps.Example.cz:8443/wms?service=WMS')).toBe('https://maps.example.cz:8443');
    expect(sourceOfTemplate('//tile.example.org/{z}/{x}/{y}.png')).toBeNull();
    expect(sourceOfTemplate("https://evil.example'; script-src *")).toBeNull();
    expect(sourceOfTemplate('javascript:alert(1)')).toBeNull();
  });

  it('allows the hosts of the base map and of every overlay in app/data/layers.json', () => {
    const layers: unknown = JSON.parse(readFileSync(`${DEFAULT_APP_DIR}data/layers.json`, 'utf8'));
    expect(mapSources(layers)).toEqual([OSM, CENIA]);
    // Switched off or not: "Check map layers" asks every one.
    expect(mapSources({ base: { url: `${OSM}/{z}/{x}/{y}.png` }, overlays: [{ url: 'https://old.example/wms', enabled: false }] })).toEqual([
      OSM,
      'https://old.example',
    ]);
  });

  it('allows no map host when the layers cannot be read, and says so', () => {
    const logged: string[] = [];
    expect(readMapSources('/nonexistent-app-dir', (m) => logged.push(m))).toEqual([]);
    expect(logged[0]).toMatch(/^Could not read the map layers in \/nonexistent-app-dir\/data\/layers\.json/);
    expect(() => mapSources({ base: {} })).toThrow();
  });

  it('lists each host once', () => {
    expect(appContentSecurityPolicy({ imageOrigin: FILES, mapSources: [OSM, FILES, CENIA] })).toBe(policy(`${FILES} ${OSM} ${CENIA}`));
  });
});

describe('headers of the app and of the API', () => {
  let t: TestDatabase;
  let withApp: TestApp;
  let bare: TestApp;
  beforeAll(async () => {
    t = await createTestDatabase();
    // The S3 storage of testConfig: links signed for https://files.rodokmen.dev.
    withApp = await makeApp(t, { config: { APP_DIR: DEFAULT_APP_DIR } });
    bare = await makeApp(t);
  });
  afterAll(async () => {
    await withApp?.app.close();
    await bare?.app.close();
    await t?.drop();
  });

  it('every file of the app has the policy and sends no Referer; the service worker gets it as its own', async () => {
    for (const url of [
      '/',
      '/index.html',
      '/app.js',
      '/sw.js',
      '/src/map.js',
      '/styles.css',
      '/manifest.webmanifest',
      '/data/layers.json',
      '/icons/icon.svg',
    ]) {
      const res = await withApp.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-security-policy'], url).toBe(policy(`${FILES} ${OSM} ${CENIA}`));
      expect(res.headers['referrer-policy'], url).toBe('no-referrer');
      expect(res.headers['x-content-type-options'], url).toBe('nosniff');
    }
  });

  it('the placeholder without the app has the policy too, without map hosts', async () => {
    const res = await bare.app.inject({ method: 'GET', url: '/' });
    expect(res.headers['content-security-policy']).toBe(policy(FILES));
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('the API keeps its own Referrer-Policy and needs no page policy', async () => {
    for (const { app } of [withApp, bare]) {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.headers['content-security-policy']).toBeUndefined();
      expect(res.headers['referrer-policy']).toBe('same-origin');
    }
  });
});
