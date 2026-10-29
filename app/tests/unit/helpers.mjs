import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @param {string} path relative to app/ */
export async function readJson(path) {
  return JSON.parse(await readFile(join(APP, path), 'utf8'));
}
