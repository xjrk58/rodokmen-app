// Plain geometry on longitude/latitude coordinates, shared by the browser and
// the data build script. Distances use a local flat projection around the
// query point, which is accurate to well under 1 % at the 5 km scale used here.

/** @typedef {import('geojson').Position} Position */
/** @typedef {Position[][]} PolygonRings outer ring first, then holes */
/** @typedef {[number, number, number, number]} BBox west, south, east, north */

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_AT_EQUATOR = 111.32;
const EARTH_RADIUS_KM = 6371.0088;

/**
 * The polygons of a Polygon or MultiPolygon geometry.
 * @param {import('geojson').Polygon | import('geojson').MultiPolygon} geometry
 * @returns {PolygonRings[]}
 */
export function polygonsOf(geometry) {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

/**
 * @param {PolygonRings[]} polygons
 * @returns {BBox}
 */
export function bboxOf(polygons) {
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  for (const rings of polygons) {
    for (const [x, y] of rings[0]) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return [w, s, e, n];
}

/**
 * @param {BBox} bbox
 * @param {number} lon
 * @param {number} lat
 * @param {number} [marginKm]
 */
export function bboxContains(bbox, lon, lat, marginKm = 0) {
  const dLat = marginKm / KM_PER_DEG_LAT;
  const dLon = marginKm / (KM_PER_DEG_LON_AT_EQUATOR * Math.cos((lat * Math.PI) / 180));
  return lon >= bbox[0] - dLon && lon <= bbox[2] + dLon && lat >= bbox[1] - dLat && lat <= bbox[3] + dLat;
}

/**
 * Even-odd ray casting.
 * @param {Position[]} ring
 * @param {number} lon
 * @param {number} lat
 */
export function ringContains(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1];
    const xj = ring[j][0],
      yj = ring[j][1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * @param {PolygonRings[]} polygons
 * @param {number} lon
 * @param {number} lat
 */
export function polygonsContain(polygons, lon, lat) {
  for (const rings of polygons) {
    if (!ringContains(rings[0], lon, lat)) continue;
    let inHole = false;
    for (let k = 1; k < rings.length; k++) {
      if (ringContains(rings[k], lon, lat)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/**
 * Shortest distance in km from a point to any edge of the polygons.
 * @param {PolygonRings[]} polygons
 * @param {number} lon
 * @param {number} lat
 */
export function distanceToEdgesKm(polygons, lon, lat) {
  const kx = KM_PER_DEG_LON_AT_EQUATOR * Math.cos((lat * Math.PI) / 180);
  const ky = KM_PER_DEG_LAT;
  let best = Infinity;
  for (const rings of polygons) {
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        const ax = (ring[i - 1][0] - lon) * kx,
          ay = (ring[i - 1][1] - lat) * ky;
        const bx = (ring[i][0] - lon) * kx,
          by = (ring[i][1] - lat) * ky;
        const dx = bx - ax,
          dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const px = ax + t * dx,
          py = ay + t * dy;
        const d2 = px * px + py * py;
        if (d2 < best) best = d2;
      }
    }
  }
  return Math.sqrt(best);
}

/**
 * Great-circle distance in km.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
