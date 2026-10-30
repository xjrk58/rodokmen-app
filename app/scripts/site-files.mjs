#!/usr/bin/env node
// The files of app/ that are deployed: the one list every deploy path and test
// uses. deploy/Dockerfile and .github/workflows/pages-preview.yml copy them,
// tests/e2e/sw-helpers.js serves a copy of them, and tests/unit/site-files.test.mjs
// and precache.test.mjs check them against app/ and the precache.
//
//   node scripts/site-files.mjs             print the files, one per line
//   node scripts/site-files.mjs --copy DIR  copy them to DIR (created if needed)
//
// Only Node's own modules: the Docker build runs this before installing app/.
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Files at the top of app/ that are deployed. */
export const SITE_FILES = ['index.html', 'app.js', 'sw.js', 'styles.css', 'manifest.webmanifest'];
/** Directories of app/ deployed with everything in them, except NOT_DEPLOYED. */
export const SITE_DIRS = ['src', 'vendor', 'i18n', 'data', 'icons'];
/** Files inside SITE_DIRS that are not deployed: type declarations for the type check. */
const NOT_DEPLOYED = /\.d\.ts$/;
/** Everything else at the top of app/: tooling, tests and build output, never deployed. */
export const NOT_SITE = ['package.json', 'tsconfig.json', 'tsconfig.node.json', 'tsconfig.sw.json', 'playwright.config.js', 'scripts', 'tests', 'node_modules', '.cache', 'test-results', 'playwright-report'];

/**
 * @param {string} dir
 * @returns {AsyncGenerator<string>} absolute paths of the files below dir
 */
async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

/**
 * The deployed files, as paths relative to the app directory with "/", sorted.
 * @param {string} [appDir]
 * @returns {Promise<string[]>}
 */
export async function siteFiles(appDir = APP_DIR) {
  const files = [...SITE_FILES];
  for (const dir of SITE_DIRS) {
    for await (const path of walk(join(appDir, dir))) {
      const rel = relative(appDir, path).split(sep).join('/');
      if (!NOT_DEPLOYED.test(rel)) files.push(rel);
    }
  }
  return files.sort();
}

/**
 * Copies the deployed files to `dest`, keeping their paths.
 * @param {string} dest
 * @param {string} [appDir]
 */
export async function copySite(dest, appDir = APP_DIR) {
  for (const file of await siteFiles(appDir)) {
    const to = join(dest, ...file.split('/'));
    await mkdir(dirname(to), { recursive: true });
    await copyFile(join(appDir, ...file.split('/')), to);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { copy: { type: 'string' } } });
  if (values.copy) {
    await copySite(resolve(values.copy));
    console.log(`Copied the site to ${values.copy}`);
  } else {
    for (const file of await siteFiles()) console.log(file);
  }
}
