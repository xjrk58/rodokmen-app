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
/** Files that carry the stamp are not part of the hash. */
const STAMPED = ['sw.js', 'src/version.js'];

export async function computeVersion() {
  const { version } = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
  const hash = createHash('sha256');
  const files = [...new Set(PRECACHE.map((p) => (p === './' ? 'index.html' : p)))].filter((p) => !STAMPED.includes(p)).sort();
  for (const file of files) {
    hash.update(`${file}\0`);
    hash.update(await readFile(join(appDir, file)));
    hash.update('\0');
  }
  return `${version}+${hash.digest('hex').slice(0, 10)}`;
}

const SW_PATTERN = /const VERSION = '[^']*';/;
const MODULE_PATTERN = /export const APP_VERSION = '[^']*';/;

export async function readStamps() {
  const sw = await readFile(join(appDir, 'sw.js'), 'utf8');
  const mod = await readFile(join(appDir, 'src/version.js'), 'utf8');
  return { sw: sw.match(/const VERSION = '([^']*)';/)?.[1], module: mod.match(/export const APP_VERSION = '([^']*)';/)?.[1], swText: sw, moduleText: mod };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = await computeVersion();
  const stamps = await readStamps();
  if (process.argv.includes('--check')) {
    if (stamps.sw !== version || stamps.module !== version) {
      console.error(`Version stamp is stale: sw.js has ${stamps.sw}, src/version.js has ${stamps.module}, files give ${version}. Run node scripts/stamp-version.mjs`);
      process.exit(1);
    }
    console.log(`Version stamp ${version} is current`);
  } else {
    await writeFile(join(appDir, 'sw.js'), stamps.swText.replace(SW_PATTERN, `const VERSION = '${version}';`));
    await writeFile(join(appDir, 'src/version.js'), stamps.moduleText.replace(MODULE_PATTERN, `export const APP_VERSION = '${version}';`));
    console.log(`Stamped ${version}`);
  }
}
