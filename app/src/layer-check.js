// "Check map layers": asks each historical overlay service for one map image
// in Web Mercator and reports whether an image came back.

/** @typedef {import('./types.js').OverlayConfig} OverlayConfig */

const HALF_WORLD_M = 20037508.342789244;

/**
 * Web Mercator bounds of the tile that contains a point.
 * @param {number} lat
 * @param {number} lon
 * @param {number} zoom
 * @returns {[number, number, number, number]} minX, minY, maxX, maxY in metres
 */
export function tileBounds3857(lat, lon, zoom) {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  const size = (2 * HALF_WORLD_M) / n;
  return [x * size - HALF_WORLD_M, HALF_WORLD_M - (y + 1) * size, (x + 1) * size - HALF_WORLD_M, HALF_WORLD_M - y * size];
}

/** A sample point in central Bohemia (Čáslav), well inside both surveys. */
export const SAMPLE = { lat: 49.9108, lon: 15.3897, zoom: 13 };

/**
 * The GetMap URL for one 256×256 tile, as Leaflet would request it.
 * @param {OverlayConfig} overlay
 */
export function sampleGetMapUrl(overlay) {
  const bbox = tileBounds3857(SAMPLE.lat, SAMPLE.lon, SAMPLE.zoom)
    .map((v) => v.toFixed(3))
    .join(',');
  const params = new URLSearchParams({
    service: 'WMS',
    request: 'GetMap',
    version: overlay.version,
    layers: overlay.layers,
    styles: '',
    format: overlay.format,
    transparent: String(overlay.transparent),
    crs: overlay.crs,
    bbox,
    width: '256',
    height: '256',
  });
  return `${overlay.url}?${params}`;
}

/**
 * Resolves true if the URL loads as an image within the timeout.
 * @param {string} url
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
export function probeImage(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => finish(false), timeoutMs);
    /** @param {boolean} ok */
    function finish(ok) {
      clearTimeout(timer);
      img.onload = img.onerror = null;
      img.src = '';
      resolve(ok);
    }
    img.onload = () => finish(img.naturalWidth > 0);
    img.onerror = () => finish(false);
    img.src = url;
  });
}

/**
 * @param {OverlayConfig[]} overlays
 * @returns {Promise<{ overlay: OverlayConfig, working: boolean }[]>}
 */
export async function checkOverlays(overlays) {
  return Promise.all(overlays.map(async (overlay) => ({ overlay, working: await probeImage(sampleGetMapUrl(overlay)) })));
}
