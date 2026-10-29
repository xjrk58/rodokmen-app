// Task 6.2: the precache lists every file the app needs offline, and the
// version stamp matches the files (so a changed file means a new version).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { PRECACHE } from '../../src/precache.js';
import { APP } from './helpers.mjs';

const NOT_SHELL_DIRS = new Set(['node_modules', 'tests', 'scripts', '.cache', 'test-results', 'playwright-report']);
const NOT_SHELL_FILES = new Set(['sw.js', 'package.json', 'tsconfig.json', 'tsconfig.sw.json', 'tsconfig.node.json', 'playwright.config.js', 'data/build-info.json']);
const NOT_SHELL_PATTERN = /\.(map|d\.ts)$|(^|\/)(LICENSE|VERSION)$/;

/**
 * @param {string} dir
 * @returns {AsyncGenerator<string>}
 */
async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const rel = relative(APP, path).split(sep).join('/');
    if (entry.isDirectory()) {
      if (!NOT_SHELL_DIRS.has(rel.split('/')[0])) yield* walk(path);
    } else {
      yield rel;
    }
  }
}

test('every shell and data file is precached', async () => {
  const listed = new Set(PRECACHE);
  for await (const file of walk(APP)) {
    if (NOT_SHELL_FILES.has(file) || NOT_SHELL_PATTERN.test(file)) continue;
    assert.ok(listed.has(file), `${file} is not in src/precache.js`);
  }
});

test('every precached file exists', async () => {
  for (const path of PRECACHE) {
    if (path === './') continue;
    assert.ok((await stat(join(APP, path))).isFile(), path);
  }
  assert.equal(new Set(PRECACHE).size, PRECACHE.length, 'no duplicates');
});

test('the version stamp is current (run node scripts/stamp-version.mjs)', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [join(APP, 'scripts', 'stamp-version.mjs'), '--check']);
  assert.match(stdout, /is current/);
});
