#!/usr/bin/env node
// The release version of the app: the package version plus a hash of every
// precached file. It is written into sw.js and src/version.js, so any change to
// the shell or the data gives the service worker a new precache, and the open
// app offers "New version, reload".
//
// The stamp is never committed (#91): in the repo both files carry the
// placeholder UNSTAMPED, so two branches that change app files do not conflict
// on it. It is written where the site is built or served instead:
//   - scripts/site-files.mjs --copy stamps the copy: the Docker image, the
//     Pages preview and the service worker tests;
//   - scripts/serve.mjs, and the API server when it serves a checkout's app/,
//     stamp the two files as they send them, from the files as they are then.
//
//   node scripts/stamp-version.mjs              print the version app/'s files give
//   node scripts/stamp-version.mjs --check DIR  exit 1 unless the built site in DIR
//                                               carries the stamp of its own files
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PRECACHE } from '../src/precache.js';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** What the committed sw.js and src/version.js carry instead of a stamp. */
export const UNSTAMPED = 'unstamped';

/**
 * Files that carry the stamp (they are not part of the hash): where the stamp
 * is (the version in the first group) and the line that writes it.
 */
const STAMPED = [
  { file: 'sw.js', pattern: /const VERSION = '([^']*)';/, line: (/** @type {string} */ v) => `const VERSION = '${v}';` },
  { file: 'src/version.js', pattern: /export const APP_VERSION = '([^']*)';/, line: (/** @type {string} */ v) => `export const APP_VERSION = '${v}';` },
];

/** The files that carry the stamp, as paths relative to the site with "/". */
export const STAMPED_FILES = STAMPED.map((s) => s.file);

/**
 * The version the files in `dir` give: app/package.json's version plus a hash
 * of the precached files in `dir` (app/ itself, or a built copy of it).
 * @param {string} [dir]
 */
export async function computeVersion(dir = APP_DIR) {
  /** @type {unknown} */
  const pkg = JSON.parse(await readFile(join(APP_DIR, 'package.json'), 'utf8'));
  const version = typeof pkg === 'object' && pkg !== null && 'version' in pkg && typeof pkg.version === 'string' ? pkg.version : null;
  if (!version) throw new Error('app/package.json has no version');
  const hash = createHash('sha256');
  const files = [...new Set(PRECACHE.map((p) => (p === './' ? 'index.html' : p)))].filter((p) => !STAMPED_FILES.includes(p)).sort();
  for (const file of files) {
    hash.update(`${file}\0`);
    hash.update(await readFile(join(dir, file)));
    hash.update('\0');
  }
  return `${version}+${hash.digest('hex').slice(0, 10)}`;
}

/** @param {string} file one of STAMPED_FILES */
function stamped(file) {
  const s = STAMPED.find((x) => x.file === file);
  if (!s) throw new Error(`${file} carries no version stamp`);
  return s;
}

/**
 * The version a stamped file's text carries: UNSTAMPED, a stamp, or null when
 * it has no stamp line at all.
 * @param {string} file one of STAMPED_FILES
 * @param {string} text
 */
export function stampIn(file, text) {
  return stamped(file).pattern.exec(text)?.[1] ?? null;
}

/**
 * The text of a stamped file with `version` in its stamp line.
 * @param {string} file one of STAMPED_FILES
 * @param {string} text
 * @param {string} version
 */
export function stampText(file, text, version) {
  const s = stamped(file);
  if (!s.pattern.test(text)) throw new Error(`${file} has no version stamp line`);
  return text.replace(s.pattern, s.line(version));
}

/**
 * Stamps a built copy of the site in `dir` with the version of its own files.
 * Never app/ itself: its files keep the placeholder.
 * @param {string} dir
 * @returns {Promise<string>} the version
 */
export async function stampSite(dir) {
  if (resolve(dir) === APP_DIR) throw new Error('app/ keeps the placeholder; stamp a copy of the site (scripts/site-files.mjs --copy)');
  const version = await computeVersion(dir);
  for (const file of STAMPED_FILES) {
    const path = join(dir, file);
    await writeFile(path, stampText(file, await readFile(path, 'utf8'), version));
  }
  return version;
}

/**
 * What is wrong with the stamp of the built site in `dir`: each file that does
 * not carry the version of the site's own files. Empty when the stamp is right.
 * @param {string} dir
 * @returns {Promise<{ version: string, problems: string[] }>}
 */
export async function checkSite(dir) {
  const version = await computeVersion(dir);
  const problems = [];
  for (const file of STAMPED_FILES) {
    const found = stampIn(file, await readFile(join(dir, file), 'utf8'));
    if (found !== version) problems.push(`${file} carries ${found === null ? 'no stamp line' : `'${found}'`}, its files give '${version}'`);
  }
  return { version, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { check: { type: 'string' } } });
  if (values.check) {
    const { version, problems } = await checkSite(values.check);
    if (problems.length) {
      console.error(`The version stamp of the site in ${values.check} is wrong: ${problems.join('; ')}.`);
      process.exit(1);
    }
    console.log(`The site in ${values.check} carries the stamp of its files: ${version}`);
  } else {
    console.log(await computeVersion());
  }
}
