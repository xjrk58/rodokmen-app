// Archive lookup and search on the committed data, without a browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArchiveIndex, NEAR_BORDER_KM, scansUrl } from '../../src/archive-lookup.js';
import { Gazetteer } from '../../src/gazetteer.js';
import { readJson } from './helpers.mjs';

const districts = await readJson('data/districts.geojson');
const archives = await readJson('data/archives.json');
/** @type {import('../../src/types.js').Municipality[]} */
const municipalities = await readJson('data/municipalities.json');
const index = new ArchiveIndex(districts, archives);
const gazetteer = new Gazetteer(municipalities);

/** @param {string} name */
const town = (name) => /** @type {import('../../src/types.js').Municipality} */ (municipalities.find((m) => m.name === name && m.district === name));

test('spec cases', () => {
  for (const [name, archive] of [['Pardubice', 'SOA Zámrsk'], ['Havlíčkův Brod', 'SOA Zámrsk'], ['Pelhřimov', 'SOA Třeboň'], ['Vsetín', 'Zemský archiv Opava'], ['Praha', 'Archiv hlavního města Prahy']]) {
    const m = town(name);
    assert.equal(index.lookup(m.lat, m.lon)?.archive.name, archive, name);
  }
  assert.equal(index.lookup(48.511, 14.5045), null, 'Freistadt, Austria');
  assert.equal(index.lookup(51.05, 13.74), null, 'Dresden, Germany');
});

test('every Municipality lies in the district it is labelled with', () => {
  for (const m of municipalities) assert.equal(index.districtAt(m.lat, m.lon)?.name, m.district, m.name);
});

test('near-border hint: 3 km from MZA Brno inside SOA Zámrsk', () => {
  const answer = index.lookup(49.642, 16.34);
  assert.equal(answer?.archive.id, 'soa-zamrsk');
  assert.deepEqual(answer?.alsoCheck.map((a) => a.archive.id), ['mza-brno']);
  assert.ok(Math.abs((answer?.alsoCheck[0].km ?? 0) - 3) < 0.05);
  assert.ok(NEAR_BORDER_KM === 5);
});

test('scans link: place search when a pattern is known, else the portal', () => {
  const archive = { portal: { url: 'https://example.org/' }, placeSearchUrl: null };
  assert.equal(scansUrl(archive, 'Žďár'), 'https://example.org/');
  assert.equal(scansUrl({ ...archive, placeSearchUrl: 'https://example.org/find?q={name}' }, 'Žďár nad Sázavou'), 'https://example.org/find?q=%C5%BD%C4%8F%C3%A1r%20nad%20S%C3%A1zavou');
});

test('search ranks whole names, then prefixes, then words, then the rest', () => {
  const { results } = gazetteer.search('zdar');
  assert.ok(results.some((m) => m.name === 'Žďár nad Sázavou'));
  assert.equal(results[0].name, 'Žďár');
  const names = gazetteer.search('Adamov').results.filter((m) => m.name === 'Adamov');
  assert.equal(names.length, municipalities.filter((m) => m.name === 'Adamov').length);
  assert.deepEqual(gazetteer.search('   ').results, []);
});

test('nearest municipality', () => {
  const m = town('Pardubice');
  assert.equal(gazetteer.nearest(m.lat + 0.001, m.lon)?.municipality.name, 'Pardubice');
});
