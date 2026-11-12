// Task 6.2: the precache lists every file the app needs offline, and the
// version stamp matches the files (so a changed file means a new version).
// The stamp is written where the site is built, never committed (#91).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { copySite, siteFiles } from '../../scripts/site-files.mjs';
import { computeVersion, STAMPED_FILES, stampIn, stampSite, stampText, UNSTAMPED } from '../../scripts/stamp-version.mjs';
import { PRECACHE } from '../../src/precache.js';
import { APP } from './helpers.mjs';

/** Deployed but not needed offline: the worker itself, build notes, source maps and licence files. */
const NOT_PRECACHED = new Set(['sw.js', 'data/build-info.json']);
const NOT_PRECACHED_PATTERN = /\.map$|(^|\/)(LICENSE|VERSION)$/;

test('every deployed shell and data file is precached', async () => {
  const listed = new Set(PRECACHE);
  for (const file of await siteFiles()) {
    if (NOT_PRECACHED.has(file) || NOT_PRECACHED_PATTERN.test(file)) continue;
    assert.ok(listed.has(file), `${file} is not in src/precache.js`);
  }
});

test('every precached file is deployed', async () => {
  const site = new Set(await siteFiles());
  for (const path of PRECACHE) {
    if (path === './') continue;
    assert.ok(site.has(path), `${path} is precached but not deployed (scripts/site-files.mjs)`);
  }
  assert.equal(new Set(PRECACHE).size, PRECACHE.length, 'no duplicates');
});

/** @param {string} dir */
const stampsIn = async (dir) => Promise.all(STAMPED_FILES.map(async (file) => stampIn(file, await readFile(join(dir, file), 'utf8'))));

/** Runs `stamp-version.mjs --check dir`: its exit code and output. @param {string} dir */
async function check(dir) {
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [join(APP, 'scripts', 'stamp-version.mjs'), '--check', dir]);
    return { code: 0, out: stdout };
  } catch (error) {
    const e = /** @type {{ code: number, stderr: string }} */ (error);
    return { code: e.code, out: e.stderr };
  }
}

/** @param {(dir: string) => Promise<void>} use */
async function withSite(use) {
  const dir = await mkdtemp(join(tmpdir(), 'site-'));
  try {
    await copySite(dir);
    await use(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('the committed app carries the placeholder, not a stamp, so branches do not conflict on it', async () => {
  assert.deepEqual(await stampsIn(APP), [UNSTAMPED, UNSTAMPED]);
  await assert.rejects(stampSite(APP), /app\/ keeps the placeholder/);
});

test('a built copy of the site carries the stamp of its files in both places, and --check agrees', async () => {
  await withSite(async (dir) => {
    const version = await computeVersion(APP);
    assert.match(version, /^\d+\.\d+\.\d+\+[0-9a-f]{10}$/);
    assert.deepEqual(await stampsIn(dir), [version, version]);
    assert.deepEqual(await check(dir), { code: 0, out: `The site in ${dir} carries the stamp of its files: ${version}\n` });
  });
});

test('a changed precached file gives a new stamp, and --check refuses a site stamped before the change', async () => {
  await withSite(async (dir) => {
    const before = await computeVersion(dir);
    await appendFile(join(dir, 'styles.css'), '\n/* changed */\n');
    const after = await computeVersion(dir);
    assert.notEqual(after, before);
    const stale = await check(dir);
    assert.equal(stale.code, 1);
    assert.ok(stale.out.includes(`sw.js carries '${before}', its files give '${after}'`), stale.out);
    assert.equal(await stampSite(dir), after);
    assert.equal((await check(dir)).code, 0);
  });
});

test('--check refuses a site whose files carry the placeholder', async () => {
  await withSite(async (dir) => {
    const sw = join(dir, 'sw.js');
    await writeFile(sw, stampText('sw.js', await readFile(sw, 'utf8'), UNSTAMPED));
    const res = await check(dir);
    assert.equal(res.code, 1);
    assert.match(res.out, /sw\.js carries 'unstamped'/);
  });
});
