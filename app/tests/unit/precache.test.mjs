// Task 6.2: the precache lists every file the app needs offline, and the
// version stamp matches the files (so a changed file means a new version).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { siteFiles } from '../../scripts/site-files.mjs';
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

test('the version stamp is current (run node scripts/stamp-version.mjs)', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [join(APP, 'scripts', 'stamp-version.mjs'), '--check']);
  assert.match(stdout, /is current/);
});
