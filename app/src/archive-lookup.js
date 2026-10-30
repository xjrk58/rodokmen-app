// Which archive holds the parish registers for a location: the district
// polygon that contains the point, then that district's archive. A location
// within NEAR_BORDER_KM of another archive's region also names that archive,
// because a parish is filed under the archive of its seat, which can lie
// across the line.
//
// Exception: a few Municipalities changed district in 2021, after the
// registers were filed. When the place's Municipality has an override in
// archives.json and the point lies in that Municipality's (today's) district,
// the override's archive answers and the district's own archive becomes an
// "also check".

import { bboxContains, bboxOf, distanceToEdgesKm, polygonsContain, polygonsOf } from './geo.js';
import { withName } from './text.js';

/** @typedef {import('./types.js').Archive} Archive */
/** @typedef {import('./types.js').ArchiveData} ArchiveData */
/** @typedef {import('./types.js').DistrictCollection} DistrictCollection */
/** @typedef {import('./types.js').Municipality} Municipality */

export const NEAR_BORDER_KM = 5;

/**
 * @typedef {object} DistrictShape
 * @property {string} name
 * @property {Archive} archive
 * @property {import('./geo.js').PolygonRings[]} polygons
 * @property {import('./geo.js').BBox} bbox
 */

/**
 * Another archive worth checking.
 * - "district": the point lies in this archive's region today, but the
 *   Municipality's registers follow its older district (km is 0).
 * - "border": this archive's region is within NEAR_BORDER_KM.
 * @typedef {object} AlsoCheck
 * @property {Archive} archive
 * @property {'district' | 'border'} reason
 * @property {number} km distance to that archive's region
 * @property {string} [district] today's district (reason "district")
 * @property {string} [olderDistrict] the district the registers follow (reason "district")
 */

/**
 * @typedef {object} ArchiveAnswer
 * @property {string} district the district polygon the point lies in
 * @property {Archive} archive
 * @property {AlsoCheck[]} alsoCheck the "district" entry first, then border archives nearest first
 */

export class ArchiveIndex {
  /**
   * @param {DistrictCollection} districts
   * @param {ArchiveData} data
   */
  constructor(districts, data) {
    /** @type {Map<string, Archive>} */
    const byDistrict = new Map();
    for (const archive of data.archives) for (const d of archive.districts) byDistrict.set(d, archive);
    this.jewishRegisters = data.jewishRegisters;
    /** @type {Map<string, Archive>} */
    const byId = new Map(data.archives.map((a) => [a.id, a]));
    /** @type {Map<string, { archive: Archive, district: string }>} municipality code -> override */
    this.overrides = new Map();
    for (const [code, o] of Object.entries(data.municipalityOverrides ?? {})) {
      const archive = byId.get(o.archive);
      if (archive) this.overrides.set(code, { archive, district: o.district });
    }
    /** @type {DistrictShape[]} */
    this.shapes = districts.features.map((f) => {
      const archive = byDistrict.get(f.properties.name);
      if (!archive) throw new Error(`District ${f.properties.name} has no archive`);
      const polygons = polygonsOf(f.geometry);
      return { name: f.properties.name, archive, polygons, bbox: bboxOf(polygons) };
    });
  }

  /**
   * @param {number} lat
   * @param {number} lon
   * @returns {DistrictShape | null}
   */
  districtAt(lat, lon) {
    for (const shape of this.shapes) {
      if (bboxContains(shape.bbox, lon, lat) && polygonsContain(shape.polygons, lon, lat)) return shape;
    }
    return null;
  }

  /**
   * The archive answer for a point, or null outside the Czech Republic.
   * @param {number} lat
   * @param {number} lon
   * @param {Municipality} [municipality] the place's Municipality (the nearest one, or the search result)
   * @returns {ArchiveAnswer | null}
   */
  lookup(lat, lon, municipality) {
    const home = this.districtAt(lat, lon);
    if (!home) return null;
    const override = municipality && municipality.district === home.name ? this.overrides.get(municipality.code) : undefined;
    const archive = override ? override.archive : home.archive;
    /** @type {AlsoCheck[]} */
    const alsoCheck = [];
    if (override && override.archive !== home.archive) {
      alsoCheck.push({ archive: home.archive, reason: 'district', km: 0, district: home.name, olderDistrict: override.district });
    }
    const named = new Set([archive.id, ...alsoCheck.map((a) => a.archive.id)]);
    /** @type {Map<string, AlsoCheck>} */
    const near = new Map();
    for (const shape of this.shapes) {
      if (named.has(shape.archive.id) || !bboxContains(shape.bbox, lon, lat, NEAR_BORDER_KM)) continue;
      const km = distanceToEdgesKm(shape.polygons, lon, lat);
      if (km > NEAR_BORDER_KM) continue;
      const seen = near.get(shape.archive.id);
      if (!seen || km < seen.km) near.set(shape.archive.id, { archive: shape.archive, reason: 'border', km });
    }
    alsoCheck.push(...[...near.values()].sort((a, b) => a.km - b.km));
    return { district: home.name, archive, alsoCheck };
  }
}

/**
 * Where "Open scans" goes: the viewer's search for the Municipality where a
 * pattern is known, otherwise the viewer's start page.
 * @param {{ portal: { url: string }, placeSearchUrl: string | null }} archive
 * @param {string | undefined} municipalityName
 */
export function scansUrl(archive, municipalityName) {
  if (archive.placeSearchUrl && municipalityName) {
    return withName(archive.placeSearchUrl, municipalityName);
  }
  return archive.portal.url;
}
