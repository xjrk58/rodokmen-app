// M15: one list of the deployed files (scripts/site-files.mjs), used by both
// deploy paths and the tests; nothing else of app/ is served.
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { copySite, NOT_SITE, SITE_DIRS, SITE_FILES, siteFiles } from '../../scripts/site-files.mjs';
import { APP } from './helpers.mjs';

test('the site has the shell and its data, and no tests, scripts, package files or type declarations', async () => {
  const files = await siteFiles();
  for (const needed of [
    'index.html',
    'app.js',
    'sw.js',
    'src/work.js',
    'i18n/cs.json',
    'data/municipalities.json',
    'vendor/leaflet/leaflet-src.esm.js',
    'vendor/leaflet/LICENSE',
  ])
    assert.ok(files.includes(needed), needed);
  for (const file of files) {
    assert.doesNotMatch(file, /^(tests|scripts|node_modules)\/|^package\.json$|^tsconfig|^playwright\.config|\.d\.ts$/, file);
  }
});

test('everything at the top of app/ is either deployed or known not to be', async () => {
  const known = new Set([...SITE_FILES, ...SITE_DIRS, ...NOT_SITE]);
  for (const entry of await readdir(APP)) assert.ok(known.has(entry), `${entry}: add it to SITE_FILES, SITE_DIRS or NOT_SITE in scripts/site-files.mjs`);
});

test('--copy copies exactly the site', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'site-'));
  try {
    await copySite(dir);
    const copied = (await readdir(dir, { recursive: true, withFileTypes: true }))
      .filter((e) => e.isFile())
      .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'));
    assert.deepEqual(copied.sort(), await siteFiles());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('both deploy paths copy the site with scripts/site-files.mjs', async () => {
  const docker = await readFile(join(APP, '..', 'deploy', 'Dockerfile'), 'utf8');
  const pages = await readFile(join(APP, '..', '.github', 'workflows', 'pages-preview.yml'), 'utf8');
  assert.match(docker, /node app\/scripts\/site-files\.mjs --copy \/site/);
  assert.match(docker, /COPY --from=build \/site \/srv\/app/);
  assert.doesNotMatch(docker, /COPY --from=build \/repo\/app /);
  assert.match(pages, /node app\/scripts\/site-files\.mjs --copy _site/);
});
