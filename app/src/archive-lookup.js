// Which archive holds the parish registers for a location: the district
// polygon that contains the point, then that district's archive. A location
// within NEAR_BORDER_KM of another archive's region also names that archive,
// because a parish is filed under the archive of its seat, which can lie
// across the line.

import { bboxContains, bboxOf, distanceToEdgesKm, polygonsContain, polygonsOf } from './geo.js';

/** @typedef {import('./types.js').Archive} Archive */
/** @typedef {import('./types.js').ArchiveData} ArchiveData */
/** @typedef {import('./types.js').DistrictCollection} DistrictCollection */

export const NEAR_BORDER_KM = 5;

/**
 * @typedef {object} DistrictShape
 * @property {string} name
 * @property {Archive} archive
 * @property {import('./geo.js').PolygonRings[]} polygons
 * @property {import('./geo.js').BBox} bbox
 */

/**
 * @typedef {object} ArchiveAnswer
 * @property {string} district
 * @property {Archive} archive
 * @property {{ archive: Archive, km: number }[]} alsoCheck other archives within NEAR_BORDER_KM, nearest first
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
    this.archives = data.archives;
    this.jewishRegisters = data.jewishRegisters;
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
   * @returns {ArchiveAnswer | null}
   */
  lookup(lat, lon) {
    const home = this.districtAt(lat, lon);
    if (!home) return null;
    /** @type {Map<string, { archive: Archive, km: number }>} */
    const near = new Map();
    for (const shape of this.shapes) {
      if (shape.archive === home.archive || !bboxContains(shape.bbox, lon, lat, NEAR_BORDER_KM)) continue;
      const km = distanceToEdgesKm(shape.polygons, lon, lat);
      if (km > NEAR_BORDER_KM) continue;
      const seen = near.get(shape.archive.id);
      if (!seen || km < seen.km) near.set(shape.archive.id, { archive: shape.archive, km });
    }
    const alsoCheck = [...near.values()].sort((a, b) => a.km - b.km);
    return { district: home.name, archive: home.archive, alsoCheck };
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
    return archive.placeSearchUrl.replaceAll('{name}', encodeURIComponent(municipalityName));
  }
  return archive.portal.url;
}
