// Task 2.3: the link check fails, naming the archive and URL, when a portal
// URL is definitely broken; it passes when all answer, and only warns when a
// portal can't be reached from CI (timeouts, TLS chain problems, 403, 5xx).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import { severityOf, targetsOf } from '../../scripts/check-links.mjs';
import { APP, readJson } from './helpers.mjs';

const run = promisify(execFile);
const SCRIPT = join(APP, 'scripts', 'check-links.mjs');
/** @type {import('node:http').Server} */
let server;
let base = '';
let dir = '';

before(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith('/ok')) res.writeHead(200).end('ok');
    else if (req.url === '/moved') res.writeHead(301, { location: '/ok/after-redirect' }).end();
    else if (req.url === '/slow') return; // never answers
    else if (req.url === '/forbidden') res.writeHead(403).end('bot check');
    else if (req.url === '/down') res.writeHead(503).end('maintenance');
    else res.writeHead(404).end('gone');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  dir = await mkdtemp(join(tmpdir(), 'check-links-'));
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(() => resolve(undefined)));
  await rm(dir, { recursive: true, force: true });
});

/**
 * @param {Record<string, string>} portals archive name -> URL
 */
async function archivesFile(portals) {
  const entries = Object.entries(portals);
  const data = {
    archives: entries.slice(0, -1).map(([name, url], i) => ({ id: `a${i}`, name, portal: { name: 'Viewer', url }, placeSearchUrl: null, districts: [] })),
    jewishRegisters: { id: 'j', name: entries.at(-1)?.[0], portal: { name: 'Viewer', url: entries.at(-1)?.[1] }, placeSearchUrl: null },
  };
  const file = join(dir, `archives-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(file, JSON.stringify(data));
  return file;
}

test('passes when every portal answers (redirects followed)', async () => {
  const file = await archivesFile({ 'Archive A': `${base}/ok/a`, 'Archive B': `${base}/moved`, 'Jewish registers': `${base}/ok/j` });
  const { stdout } = await run(process.execPath, [SCRIPT, '--file', file, '--retries', '0']);
  assert.match(stdout, /All 3 archive links answer/);
});

test('fails on a broken portal URL and names the archive and URL', async () => {
  const file = await archivesFile({ 'Archive A': `${base}/ok/a`, 'Archive Broken': `${base}/broken`, 'Jewish registers': `${base}/ok/j` });
  await assert.rejects(run(process.execPath, [SCRIPT, '--file', file, '--retries', '0']), (/** @type {any} */ error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, new RegExp(`Archive Broken: ${base}/broken \\(HTTP 404\\)`));
    assert.doesNotMatch(error.stderr, /Archive A:/);
    return true;
  });
});

test('fails on an unreachable host', async () => {
  const file = await archivesFile({ 'Archive Down': 'http://127.0.0.1:9/', 'Jewish registers': `${base}/ok/j` });
  await assert.rejects(run(process.execPath, [SCRIPT, '--file', file, '--retries', '0', '--timeout', '3000']), /Archive Down/);
});

test('--extra adds a deliberately broken URL for a test run', async () => {
  const file = await archivesFile({ 'Archive A': `${base}/ok/a`, 'Jewish registers': `${base}/ok/j` });
  await assert.rejects(run(process.execPath, [SCRIPT, '--file', file, '--retries', '0', '--extra', `Broken on purpose=${base}/nope`]), /Broken on purpose: .*\/nope \(HTTP 404\)/);
});

test('the real archives.json yields one portal per archive plus the National Archives', async () => {
  const data = await readJson('data/archives.json');
  const targets = targetsOf(data);
  assert.equal(targets.length, data.archives.length + 1);
  for (const t of targets) assert.match(t.url, /^https:\/\//);
});

test('only warns when a portal times out, blocks the runner or is down', async () => {
  const file = await archivesFile({ 'Archive Slow': `${base}/slow`, 'Archive Blocked': `${base}/forbidden`, 'Archive Down': `${base}/down`, 'Jewish registers': `${base}/ok/j` });
  const { stdout } = await run(process.execPath, [SCRIPT, '--file', file, '--retries', '0', '--timeout', '500']);
  assert.match(stdout, /WARN {2}Archive Slow/);
  assert.match(stdout, /WARN {2}Archive Blocked .*HTTP 403/);
  assert.match(stdout, /WARN {2}Archive Down .*HTTP 503/);
  assert.match(stdout, /3 of 4 archive links could not be reached from here/);
});

test('severity rules', () => {
  assert.equal(severityOf({ ok: true }), 'ok');
  assert.equal(severityOf({ ok: false, httpStatus: 404 }), 'fail');
  assert.equal(severityOf({ ok: false, httpStatus: 410 }), 'fail');
  assert.equal(severityOf({ ok: false, httpStatus: 403 }), 'warn');
  assert.equal(severityOf({ ok: false, httpStatus: 502 }), 'warn');
  assert.equal(severityOf({ ok: false, timedOut: true }), 'warn');
  assert.equal(severityOf({ ok: false, code: 'UND_ERR_CONNECT_TIMEOUT' }), 'warn');
  assert.equal(severityOf({ ok: false, code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }), 'warn');
  assert.equal(severityOf({ ok: false, code: 'ENOTFOUND' }), 'fail');
  assert.equal(severityOf({ ok: false, code: 'ECONNREFUSED' }), 'fail');
});
