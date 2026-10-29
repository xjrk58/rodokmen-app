// Every interface string exists in Czech and English.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { APP, readJson } from './helpers.mjs';

const cs = await readJson('i18n/cs.json');
const en = await readJson('i18n/en.json');

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
  for (const file of await readdir(join(APP, 'src'))) {
    const code = await readFile(join(APP, 'src', file), 'utf8');
    for (const m of code.matchAll(/\bt\('([\w.]+)'/g)) used.add(m[1]);
  }
  // Keys built from data ids.
  for (const { id } of (await readJson('data/layers.json')).overlays) used.add(`overlay.${id}`);
  for (const { id } of (await readJson('data/layers.json')).viewers) used.add(`viewer.${id}`);
  for (const key of used) assert.ok(key in en, `missing key ${key}`);
});
