// add-kinship task 7.1: the app says kinship as the server wrote it, in the reader's language, with
// "možná" through an i18n key; it joins no words into a term.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isForMe, kinshipText, lineAndDegree, shortKinship } from '../../src/kinship.js';
import { setLanguage } from '../../src/i18n.js';
import { kinshipOf } from '../e2e/kinship-api.js';
import { APP } from './helpers.mjs';

// i18n loads its tables with fetch and translates the page: a table from disk, and no page.
globalThis.fetch = /** @type {typeof fetch} */ (
  async (url) => new Response(readFileSync(`${APP}/${typeof url === 'string' ? url : url instanceof URL ? url.href : url.url}`, 'utf8'))
);
Object.assign(globalThis, { document: { documentElement: {}, querySelectorAll: () => [] } });

const term = { cs: { text: 'praděd', gender: /** @type {'m'} */ ('m') }, en: { text: 'great-grandfather', gender: /** @type {'m'} */ ('m') } };
const path = { kind: 'birth', term, possible: false, line: /** @type {'direct'} */ ('direct'), degree: 3 };

test('the term in the reader’s language, with and without the mark of a possible path', async () => {
  await setLanguage('cs');
  assert.equal(kinshipText(path), 'praděd');
  assert.equal(kinshipText({ ...path, possible: true }), 'možná praděd');
  assert.equal(kinshipText({ ...path, kind: 'self' }), 'vy');
  assert.equal(lineAndDegree(path), 'linie přímá, 3. stupeň');
  assert.equal(lineAndDegree({ ...path, kind: 'marriage', line: 'collateral', degree: 2 }), 'švagrovství, linie vedlejší, 2. stupeň');
  assert.equal(lineAndDegree({ ...path, kind: 'partner', line: null, degree: null }), '');
  await setLanguage('en');
  assert.equal(kinshipText({ ...path, possible: true }), 'possibly great-grandfather');
  assert.equal(lineAndDegree(path), 'direct line, degree 3 (Czech law)');
});

test('the short form of a Person summary, and none without one', async () => {
  await setLanguage('cs');
  const [first] = kinshipOf(20).paths;
  assert.ok(first);
  assert.equal(shortKinship({ kinship: { ...first, others: 1, more: false } }), 'teta (přes osvojení)');
  assert.equal(shortKinship({ kinship: null }), null);
  assert.equal(shortKinship({}), null);
});

test('an answer kept on the device for another own Person is not the reader’s', () => {
  const k = kinshipOf(20);
  assert.equal(isForMe(k, /** @type {never} */ ({ person: { id: k.from } })), true);
  assert.equal(isForMe(k, /** @type {never} */ ({ person: { id: k.to } })), false);
  assert.equal(isForMe(k, null), false);
});

test('no text is built by joining words: kinship.js writes only API paths, and every word comes from the answer or an i18n key', () => {
  // The code, without its comments.
  const source = readFileSync(`${APP}/src/kinship.js`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const templates = [...source.matchAll(/`([^`]*)`/g)].map((m) => m[1] ?? '');
  for (const text of templates) assert.match(text, /^(persons|members)\/|^kinship\./, text);
  assert.doesNotMatch(source, /['"`](možná|possibly)|\+ ' '|' \+/);
});
