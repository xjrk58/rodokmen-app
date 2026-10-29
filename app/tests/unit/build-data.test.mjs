// Task 2.1/2.2: the data build fails if a district has no archive, and the
// committed data matches what it reports.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { checkArchiveCoverage } from '../../scripts/lib/archives-check.mjs';
import { parseCsv } from '../../scripts/lib/csv.mjs';
import { APP, readJson } from './helpers.mjs';

const run = promisify(execFile);
const SCRIPT = join(APP, 'scripts', 'build-data.mjs');
const FIXTURE_CSV = join(APP, 'tests', 'fixtures', 'municipalities-small.csv');

/** @param {...string[]} groups districts of each archive */
const archivesFor = (...groups) => ({
  archives: groups.map((districts, i) => ({
    id: `a${i}`, name: `Archive ${i}`, color: '#123456', placeSearchUrl: null,
    portal: { name: 'Portal', url: `https://example.org/${i}/` }, districts,
  })),
  jewishRegisters: { id: 'j', name: 'Jewish', placeSearchUrl: null, portal: { name: 'Portal', url: 'https://example.org/j/' } },
});

test('build-data fails and names the district when a district has no archive', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'build-data-'));
  try {
    const archives = join(dir, 'archives.json');
    await writeFile(archives, JSON.stringify(archivesFor(['Alfa'])));
    await assert.rejects(
      run(process.execPath, [SCRIPT, '--municipalities-file', FIXTURE_CSV, '--archives', archives, '--out', join(dir, 'out'), '--districts-file', join(dir, 'missing.json')]),
      (/** @type {any} */ error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /District Beta has no archive/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the real archives.json covers every district of the municipality list exactly once', async () => {
  const csv = await readFile(join(APP, '.cache', 'sources', 'souradnice.csv'), 'utf8').catch(() => null);
  const districts = csv
    ? [...new Set(parseCsv(csv).map((r) => r.Okres))]
    : (await readJson('data/districts.geojson')).features.map((/** @type {any} */ f) => f.properties.name);
  assert.equal(districts.length, 77);
  assert.deepEqual(checkArchiveCoverage(await readJson('data/archives.json'), districts), []);
});

test('coverage check: missing, unknown and doubled districts', () => {
  assert.deepEqual(checkArchiveCoverage(archivesFor(['Alfa', 'Beta']), ['Alfa', 'Beta']), []);
  assert.deepEqual(checkArchiveCoverage(archivesFor(['Alfa']), ['Alfa', 'Beta']), ['District Beta has no archive']);
  assert.match(checkArchiveCoverage(archivesFor(['Alfa', 'Beta', 'Gama']), ['Alfa', 'Beta']).join(), /unknown district "Gama"/);
  assert.match(checkArchiveCoverage(archivesFor(['Alfa', 'Beta'], ['Beta']), ['Alfa', 'Beta']).join(), /Beta is listed under both/);
});

test('coverage check: municipality overrides', () => {
  const data = { ...archivesFor(['Alfa'], ['Beta']), municipalityOverrides: { 900001: { name: 'Testov', archive: 'a1', district: 'Beta', reason: 'r' } } };
  assert.deepEqual(checkArchiveCoverage(data, ['Alfa', 'Beta']), []);
  data.municipalityOverrides[900001].district = 'Alfa';
  assert.match(checkArchiveCoverage(data, ['Alfa', 'Beta']).join(), /"Alfa" is not a district of Archive 1/);
  data.municipalityOverrides[900001].archive = 'nope';
  assert.match(checkArchiveCoverage(data, ['Alfa', 'Beta']).join(), /unknown archive "nope"/);
});

test('committed overrides: one per reassigned municipality, with the archive of its listed district', async () => {
  const archives = await readJson('data/archives.json');
  const info = await readJson('data/build-info.json');
  const municipalities = await readJson('data/municipalities.json');
  const reassigned = info.reassigned.municipalities;
  assert.equal(reassigned.length, 15);
  assert.deepEqual(Object.keys(archives.municipalityOverrides).sort(), reassigned.map((/** @type {any} */ r) => r.code).sort());
  for (const r of reassigned) {
    const o = archives.municipalityOverrides[r.code];
    assert.equal(o.district, r.listedDistrict);
    assert.ok(archives.archives.find((/** @type {any} */ a) => a.id === o.archive).districts.includes(r.listedDistrict));
    assert.equal(municipalities.find((/** @type {any} */ m) => m.code === r.code).district, r.polygonDistrict);
  }
});

test('committed data: 77 named districts and every municipality inside its district', async () => {
  const districts = await readJson('data/districts.geojson');
  const municipalities = await readJson('data/municipalities.json');
  const info = await readJson('data/build-info.json');
  const names = districts.features.map((/** @type {any} */ f) => f.properties.name);
  assert.equal(names.length, 77);
  assert.equal(new Set(names).size, 77);
  assert.equal(municipalities.length, info.counts.municipalities);
  assert.equal(municipalities.length, 6258);
  const known = new Set(names);
  for (const m of municipalities) assert.ok(known.has(m.district), `${m.name}: unknown district ${m.district}`);
});

test('CSV reader handles quotes, commas and CRLF', () => {
  const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\r\nz,\r\n');
  assert.deepEqual(rows, [{ a: 'x, y', b: 'say "hi"' }, { a: 'z', b: '' }]);
});
