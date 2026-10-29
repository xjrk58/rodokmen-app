// The app's own data files, read on the Node side for test expectations.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @param {string} path */
const read = (path) => JSON.parse(readFileSync(join(APP_DIR, path), 'utf8'));

/** @type {import('../../src/types.js').Municipality[]} */
export const municipalities = read('data/municipalities.json');
/** @type {import('../../src/types.js').ArchiveData} */
export const archives = read('data/archives.json');
/** @type {import('../../src/types.js').LayersConfig} */
export const layers = read('data/layers.json');

/**
 * The one Municipality with this name in this district.
 * @param {string} name
 * @param {string} [district]
 */
export function municipality(name, district = name) {
  const found = municipalities.filter((m) => m.name === name && m.district === district);
  if (found.length !== 1) throw new Error(`Expected one ${name} in ${district}, found ${found.length}`);
  return found[0];
}
