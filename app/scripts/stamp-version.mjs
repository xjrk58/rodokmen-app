#!/usr/bin/env node
// Writes the release version into sw.js and src/version.js: the package
// version plus a hash of every precached file. Any change to the shell or the
// data therefore gives the service worker a new precache, and the open app
// offers "New version, reload". Run after changing app files:
//   node scripts/stamp-version.mjs          write the stamp
//   node scripts/stamp-version.mjs --check  exit 1 if the stamp is stale (CI)
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRECACHE } from '../src/precache.js';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * Files that carry the stamp (they are not part of the hash): where the stamp
 * is (the version in the first group) and the line that writes it.
 */
const STAMPED = [
  { file: 'sw.js', pattern: /const VERSION = '([^']*)';/, line: (/** @type {string} */ v) => `const VERSION = '${v}';` },
  { file: 'src/version.js', pattern: /export const APP_VERSION = '([^']*)';/, line: (/** @type {string} */ v) => `export const APP_VERSION = '${v}';` },
];

export async function computeVersion() {
  /** @type {unknown} */
  const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
  const version = typeof pkg === 'object' && pkg !== null && 'version' in pkg && typeof pkg.version === 'string' ? pkg.version : null;
  if (!version) throw new Error('app/package.json has no version');
  const hash = createHash('sha256');
  const files = [...new Set(PRECACHE.map((p) => (p === './' ? 'index.html' : p)))].filter((p) => !STAMPED.some((s) => s.file === p)).sort();
  for (const file of files) {
    hash.update(`${file}\0`);
    hash.update(await readFile(join(appDir, file)));
    hash.update('\0');
  }
  return `${version}+${hash.digest('hex').slice(0, 10)}`;
}

/**
 * The stamp in each stamped file: its text, and the version it carries (null
 * when the file has no stamp line, which is an error both when checking and when writing).
 */
export async function readStamps() {
  return Promise.all(
    STAMPED.map(async ({ file, pattern, line }) => {
      const text = await readFile(join(appDir, file), 'utf8');
      return { file, text, line, pattern, version: pattern.exec(text)?.[1] ?? null };
    }),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = await computeVersion();
  const stamps = await readStamps();
  const missing = stamps.filter((s) => s.version === null).map((s) => s.file);
  if (missing.length) {
    console.error(`No version stamp line in ${missing.join(', ')}`);
    process.exit(1);
  }
  if (process.argv.includes('--check')) {
    const stale = stamps.filter((s) => s.version !== version);
    if (stale.length) {
      console.error(
        `Version stamp is stale: ${stale.map((s) => `${s.file} has ${s.version}`).join(', ')}; the files give ${version}. Run node scripts/stamp-version.mjs`,
      );
      process.exit(1);
    }
    console.log(`Version stamp ${version} is current`);
  } else {
    for (const s of stamps) await writeFile(join(appDir, s.file), s.text.replace(s.pattern, s.line(version)));
    console.log(`Stamped ${version}`);
  }
}
