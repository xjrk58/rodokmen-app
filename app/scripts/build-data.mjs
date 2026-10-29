#!/usr/bin/env node
// Builds the map's public reference data from public sources:
//
//   app/data/districts.geojson    77 district (okres) polygons, named, simplified
//   app/data/country.geojson      the national border (all districts dissolved)
//   app/data/municipalities.json  every Municipality: code, name, normalized name, district, lat, lon
//   app/data/build-info.json      source checksums, counts and data notes
//
// Sources are downloaded once into app/.cache/sources/ and reused, so a rebuild
// is reproducible; pass --refresh to download them again. The script fails if
// a district in the municipality list has no archive in app/data/archives.json,
// if any polygon gets no name, or if any Municipality falls outside every
// district polygon.
//
// Usage: node scripts/build-data.mjs [--out dir] [--archives file] [--cache dir]
//          [--districts-file file] [--municipalities-file file] [--refresh]
// Behind an HTTPS proxy, run with NODE_USE_ENV_PROXY=1.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { bboxContains, bboxOf, polygonsContain, polygonsOf } from '../src/geo.js';
import { czechCollator, normalize } from '../src/text.js';
import { checkArchiveCoverage } from './lib/archives-check.mjs';
import { parseCsv } from './lib/csv.mjs';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SOURCES = {
  districts: {
    url: 'https://raw.githubusercontent.com/siwekm/czech-geojson/master/okresy.json',
    file: 'okresy.json',
    description: 'District (okres) polygons derived from RÚIAN, without properties',
  },
  municipalities: {
    url: 'https://raw.githubusercontent.com/33bcdd/souradnice-mest/master/souradnice.csv',
    file: 'souradnice.csv',
    description: 'Municipalities with district and coordinates',
  },
};

/** Rows of the municipality list that are no longer Municipalities, by municipality code. */
const ABOLISHED = new Map([['539996', 'military area abolished on 1 January 2016']]);

/** Share of vertices kept by mapshaper; about 300 KB of GeoJSON. */
const SIMPLIFY = '2%';
const PRECISION = 0.0001;
const COORD_DECIMALS = 5;

const { values: args } = parseArgs({
  options: {
    out: { type: 'string', default: join(appDir, 'data') },
    archives: { type: 'string', default: join(appDir, 'data', 'archives.json') },
    cache: { type: 'string', default: join(appDir, '.cache', 'sources') },
    'districts-file': { type: 'string' },
    'municipalities-file': { type: 'string' },
    refresh: { type: 'boolean', default: false },
  },
});

class BuildError extends Error {}

/**
 * @param {keyof typeof SOURCES} key
 * @param {string | undefined} override
 * @returns {Promise<Buffer>}
 */
async function loadSource(key, override) {
  if (override) return readFile(override);
  const { url, file } = SOURCES[key];
  const path = join(args.cache, file);
  if (!args.refresh) {
    try {
      return await readFile(path);
    } catch {
      // not cached yet
    }
  }
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new BuildError(`Download failed: ${url} answered ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  await mkdir(args.cache, { recursive: true });
  await writeFile(path, body);
  return body;
}

/** @param {Buffer} data */
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** @param {number} x */
const round = (x) => Number(x.toFixed(COORD_DECIMALS));

async function main() {
  // 1. Municipalities
  const csvBuffer = await loadSource('municipalities', args['municipalities-file']);
  const rows = parseCsv(csvBuffer.toString('utf8'));
  const required = ['Obec', 'Kód obce', 'Okres', 'Kód okresu', 'Latitude', 'Longitude'];
  for (const column of required) {
    if (!(column in rows[0])) throw new BuildError(`Municipality list has no column "${column}"`);
  }
  /** @type {{ code: string, name: string, reason: string | undefined }[]} */
  const excluded = [];
  /** @type {{ code: string, name: string, listedDistrict: string, districtCode: string, lat: number, lon: number }[]} */
  const municipalities = [];
  for (const row of rows) {
    if (ABOLISHED.has(row['Kód obce'])) {
      excluded.push({ code: row['Kód obce'], name: row.Obec, reason: ABOLISHED.get(row['Kód obce']) });
      continue;
    }
    const lat = Number(row.Latitude);
    const lon = Number(row.Longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new BuildError(`No coordinates for ${row.Obec} (${row['Kód obce']})`);
    municipalities.push({ code: row['Kód obce'], name: row.Obec, listedDistrict: row.Okres, districtCode: row['Kód okresu'], lat, lon });
  }
  /** @type {Map<string, string>} district name -> district code */
  const districtCodes = new Map();
  for (const m of municipalities) districtCodes.set(m.listedDistrict, m.districtCode);

  // 2. Every district needs exactly one archive (checked before the slow part).
  const archives = JSON.parse(await readFile(args.archives, 'utf8'));
  const coverageErrors = checkArchiveCoverage(archives, [...districtCodes.keys()]);
  if (coverageErrors.length) throw new BuildError(`archives.json does not match the districts:\n  ${coverageErrors.join('\n  ')}`);

  // 3. Name each district polygon by the municipality points inside it.
  const districtsBuffer = await loadSource('districts', args['districts-file']);
  /** @type {import('geojson').FeatureCollection<import('geojson').Polygon | import('geojson').MultiPolygon>} */
  const source = JSON.parse(districtsBuffer.toString('utf8'));
  const shapes = source.features.map((/** @type {import('geojson').Feature<import('geojson').Polygon | import('geojson').MultiPolygon>} */ f) => {
    const polygons = polygonsOf(f.geometry);
    return { feature: f, polygons, bbox: bboxOf(polygons) };
  });
  /** @type {Map<string, number>[]} */
  const tallies = shapes.map(() => new Map());
  for (const m of municipalities) {
    shapes.forEach((shape, i) => {
      if (bboxContains(shape.bbox, m.lon, m.lat) && polygonsContain(shape.polygons, m.lon, m.lat)) {
        tallies[i].set(m.listedDistrict, (tallies[i].get(m.listedDistrict) ?? 0) + 1);
      }
    });
  }
  const names = tallies.map((tally, i) => {
    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    if (!ranked.length) throw new BuildError(`District polygon #${i} contains no municipality and gets no name`);
    if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) throw new BuildError(`District polygon #${i} is a tie between ${ranked[0][0]} and ${ranked[1][0]}`);
    return ranked[0][0];
  });
  /** @type {Map<string, number>} */
  const seen = new Map();
  names.forEach((name, i) => {
    if (seen.has(name)) throw new BuildError(`Two polygons (#${seen.get(name)} and #${i}) are both named ${name}`);
    seen.set(name, i);
  });
  const unnamed = [...districtCodes.keys()].filter((d) => !seen.has(d));
  if (unnamed.length) throw new BuildError(`No polygon for district(s): ${unnamed.join(', ')}`);

  const named = shapes
    .map((shape, i) => ({
      type: 'Feature',
      properties: { name: names[i], code: districtCodes.get(names[i]) },
      geometry: shape.feature.geometry,
    }))
    .sort((a, b) => czechCollator.compare(a.properties.name, b.properties.name));

  // 4. Simplify with shared borders kept shared, and dissolve to the national border.
  const { default: mapshaper } = await import('mapshaper');
  const input = JSON.stringify({ type: 'FeatureCollection', features: named });
  const output = await mapshaper.applyCommands(
    `-i districts.json -simplify ${SIMPLIFY} keep-shapes ` +
      `-o districts.geojson format=geojson precision=${PRECISION} ` +
      `-dissolve -each "name='Česko'" -o country.geojson format=geojson precision=${PRECISION}`,
    { 'districts.json': input },
  );
  const districtsOut = output['districts.geojson'].toString();
  const countryOut = output['country.geojson'].toString();

  // 5. Check every Municipality against the simplified polygons the app uses.
  /** @type {import('geojson').FeatureCollection<import('geojson').Polygon | import('geojson').MultiPolygon, {name: string, code: string}>} */
  const simplified = JSON.parse(districtsOut);
  const simpleShapes = simplified.features.map((/** @type {import('geojson').Feature<import('geojson').Polygon | import('geojson').MultiPolygon, {name: string, code: string}>} */ f) => {
    const polygons = polygonsOf(f.geometry);
    return { name: f.properties.name, polygons, bbox: bboxOf(polygons) };
  });
  const country = JSON.parse(countryOut);
  const countryPolygons = polygonsOf(country.features[0].geometry);
  /** @type {string[]} */
  const outside = [];
  /** @type {string[]} */
  const overlapping = [];
  /** @type {{ code: string, name: string, listedDistrict: string, polygonDistrict: string }[]} */
  const reassigned = [];
  const records = municipalities.map((m) => {
    const hits = simpleShapes.filter((s) => bboxContains(s.bbox, m.lon, m.lat) && polygonsContain(s.polygons, m.lon, m.lat));
    if (hits.length === 0 || !polygonsContain(countryPolygons, m.lon, m.lat)) outside.push(`${m.name} (${m.code})`);
    if (hits.length > 1) overlapping.push(`${m.name} (${m.code}): ${hits.map((h) => h.name).join(', ')}`);
    const district = hits[0]?.name ?? m.listedDistrict;
    if (hits.length === 1 && district !== m.listedDistrict) {
      reassigned.push({ code: m.code, name: m.name, listedDistrict: m.listedDistrict, polygonDistrict: district });
    }
    return { code: m.code, name: m.name, norm: normalize(m.name), district, lat: round(m.lat), lon: round(m.lon) };
  });
  if (outside.length) throw new BuildError(`${outside.length} municipalities fall outside every district: ${outside.slice(0, 20).join(', ')}`);
  if (overlapping.length) throw new BuildError(`${overlapping.length} municipalities fall inside two districts: ${overlapping.slice(0, 20).join('; ')}`);

  records.sort((a, b) => czechCollator.compare(a.name, b.name) || czechCollator.compare(a.district, b.district) || a.code.localeCompare(b.code));

  // 6. Write.
  await mkdir(args.out, { recursive: true });
  await writeFile(join(args.out, 'districts.geojson'), districtsOut.endsWith('\n') ? districtsOut : `${districtsOut}\n`);
  await writeFile(join(args.out, 'country.geojson'), countryOut.endsWith('\n') ? countryOut : `${countryOut}\n`);
  await writeFile(join(args.out, 'municipalities.json'), `[\n${records.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`);
  const info = {
    sources: {
      districts: { ...SOURCES.districts, sha256: sha256(districtsBuffer), bytes: districtsBuffer.length },
      municipalities: { ...SOURCES.municipalities, sha256: sha256(csvBuffer), bytes: csvBuffer.length, rows: rows.length },
    },
    simplify: { keep: SIMPLIFY, precision: PRECISION },
    counts: { districts: simplified.features.length, municipalities: records.length },
    excluded,
    reassigned: {
      note: 'Listed under one district in the municipality list but inside the polygon of another (district boundaries changed in 2021). The app uses the polygon district.',
      municipalities: reassigned,
    },
  };
  await writeFile(join(args.out, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);

  const kb = (/** @type {string} */ s) => `${Math.round(Buffer.byteLength(s) / 1024)} KB`;
  console.log(`${simplified.features.length} named districts (districts.geojson ${kb(districtsOut)}, country.geojson ${kb(countryOut)})`);
  console.log(`${records.length.toLocaleString('en')} municipalities, each inside a district`);
  console.log(`Every district has an archive (${archives.archives.length} archives)`);
  for (const e of excluded) console.log(`Excluded ${e.name} (${e.code}): ${e.reason}`);
  if (reassigned.length) {
    console.log(`${reassigned.length} municipalities lie in a different district polygon than listed (see build-info.json):`);
    for (const r of reassigned) console.log(`  ${r.name}: listed ${r.listedDistrict}, lies in ${r.polygonDistrict}`);
  }
}

main().catch((error) => {
  if (error instanceof BuildError) {
    console.error(`build-data failed: ${error.message}`);
    process.exit(1);
  }
  throw error;
});
