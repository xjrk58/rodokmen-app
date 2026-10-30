// Every interface string exists in Czech and English.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { APP, readJson } from './helpers.mjs';

/** @type {Record<string, string>} */
const cs = await readJson('i18n/cs.json');
/** @type {Record<string, string>} */
const en = await readJson('i18n/en.json');
/** @type {import('../../src/types.js').LayersConfig} */
const layers = await readJson('data/layers.json');

test('cs.json and en.json have the same keys and no empty strings', () => {
  assert.deepEqual(Object.keys(cs).sort(), Object.keys(en).sort());
  for (const [lang, strings] of Object.entries({ cs, en })) {
    for (const [key, value] of Object.entries(strings)) assert.ok(typeof value === 'string' && value.trim(), `${lang}: ${key}`);
  }
});

test('placeholders match between languages', () => {
  const params = (/** @type {string} */ s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const key of Object.keys(en)) assert.deepEqual(params(cs[key]), params(en[key]), key);
});

test('every key used in index.html and the code exists', async () => {
  const html = await readFile(join(APP, 'index.html'), 'utf8');
  const used = new Set([...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(';')) used.add(pair.split(':')[1]);
  // The entry point and the service worker as well as src/.
  const files = ['app.js', 'sw.js', ...(await readdir(join(APP, 'src'))).map((f) => `src/${f}`)];
  for (const file of files) {
    const code = await readFile(join(APP, file), 'utf8');
    for (const m of code.matchAll(/\bt\('([\w.]+)'/g)) used.add(m[1]);
  }
  assert.ok(used.has('error.data'), 'app.js is scanned');
  // Keys built from data ids.
  for (const { id } of layers.overlays) used.add(`overlay.${id}`);
  for (const { id } of layers.viewers) used.add(`viewer.${id}`);
  for (const key of used) assert.ok(key in en, `missing key ${key}`);
});
