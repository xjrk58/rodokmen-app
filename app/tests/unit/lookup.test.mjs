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

/** The Municipality a district is named after. @param {string} name */
const districtSeat = (name) => /** @type {import('../../src/types.js').Municipality} */ (municipalities.find((m) => m.name === name && m.district === name));

test('spec cases', () => {
  for (const [name, archive] of [
    ['Pardubice', 'SOA Zámrsk'],
    ['Havlíčkův Brod', 'SOA Zámrsk'],
    ['Pelhřimov', 'SOA Třeboň'],
    ['Vsetín', 'Zemský archiv Opava'],
    ['Praha', 'Archiv hlavního města Prahy'],
  ]) {
    const m = districtSeat(name);
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
  assert.deepEqual(
    answer?.alsoCheck.map((a) => a.archive.id),
    ['mza-brno'],
  );
  assert.ok(Math.abs((answer?.alsoCheck[0].km ?? 0) - 3) < 0.05);
  assert.ok(NEAR_BORDER_KM === 5);
});

test('scans link: place search when a pattern is known, else the portal', () => {
  const archive = { portal: { url: 'https://example.org/' }, placeSearchUrl: null };
  assert.equal(scansUrl(archive, 'Žďár'), 'https://example.org/');
  assert.equal(
    scansUrl({ ...archive, placeSearchUrl: 'https://example.org/find?q={name}' }, 'Žďár nad Sázavou'),
    'https://example.org/find?q=%C5%BD%C4%8F%C3%A1r%20nad%20S%C3%A1zavou',
  );
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
  const m = districtSeat('Pardubice');
  assert.equal(gazetteer.nearest(m.lat + 0.001, m.lon)?.municipality.name, 'Pardubice');
});

/** @param {string} name @param {string} district */
const find = (name, district) =>
  /** @type {import('../../src/types.js').Municipality} */ (municipalities.find((m) => m.name === name && m.district === district));

test('a district change of 2021 keeps the older archive and names today\'s as "also check"', () => {
  const harrachov = find('Harrachov', 'Jablonec nad Nisou');
  const answer = index.lookup(harrachov.lat, harrachov.lon, harrachov);
  assert.equal(answer?.archive.id, 'soa-zamrsk');
  assert.equal(answer?.alsoCheck[0].reason, 'district');
  assert.equal(answer?.alsoCheck[0].archive.id, 'soa-litomerice');
  assert.equal(answer?.alsoCheck[0].olderDistrict, 'Semily');
  // Zámrsk is the answer, so it is not repeated as a border hint.
  assert.ok(!answer?.alsoCheck.some((a) => a.archive.id === 'soa-zamrsk'));

  const studlov = find('Študlov', 'Zlín');
  const s = index.lookup(studlov.lat, studlov.lon, studlov);
  assert.equal(s?.archive.id, 'za-opava');
  assert.deepEqual(
    s?.alsoCheck.map((a) => [a.archive.id, a.reason]),
    [['mza-brno', 'district']],
  );
});

test('the override applies only with its Municipality and inside its district', () => {
  const harrachov = find('Harrachov', 'Jablonec nad Nisou');
  // Same point, no Municipality: the polygon decides.
  assert.equal(index.lookup(harrachov.lat, harrachov.lon)?.archive.id, 'soa-litomerice');
  // Študlov's override, but a point in another district (Uherské Hradiště, MZA Brno).
  const studlov = find('Študlov', 'Zlín');
  const elsewhere = find('Uherské Hradiště', 'Uherské Hradiště');
  const answer = index.lookup(elsewhere.lat, elsewhere.lon, studlov);
  assert.equal(answer?.archive.id, 'mza-brno');
  assert.ok(answer?.alsoCheck.every((a) => a.reason === 'border'));
});

test('an override within the same archive changes nothing', () => {
  const holysov = find('Holýšov', 'Plzeň-jih');
  const answer = index.lookup(holysov.lat, holysov.lon, holysov);
  assert.equal(answer?.archive.id, 'soa-plzen');
  assert.ok(answer?.alsoCheck.every((a) => a.reason === 'border'));
});
