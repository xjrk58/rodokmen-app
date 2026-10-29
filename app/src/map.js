// The Leaflet map: base tiles, district boundaries, the national border, the
// archive regions layer and the historical overlays. Vector layers come from
// app/data/, so borders and regions draw even when no tile loads.

import * as L from '../vendor/leaflet/leaflet-src.esm.js';

/** @typedef {import('./data.js').AppData} AppData */
/** @typedef {import('./types.js').OverlayConfig} OverlayConfig */

const REGION_FILL_OPACITY = 0.33;
const PLACE_ZOOM = 12;

/**
 * @typedef {object} MapView
 * @property {L.Map} map
 * @property {(on: boolean) => void} showRegions
 * @property {Map<string, L.TileLayer.WMS>} overlays enabled overlays by id
 * @property {(id: string, on: boolean) => void} showOverlay
 * @property {(id: string, opacity: number) => void} setOverlayOpacity
 * @property {(lat: number, lon: number) => void} setMarker
 * @property {() => void} clearMarker
 * @property {(lat: number, lon: number) => void} centreOn
 * @property {(handler: (lat: number, lon: number) => void) => void} onTap
 */

/**
 * Reads "#map=zoom/lat/lon".
 * @returns {{ zoom: number, lat: number, lon: number } | null}
 */
function viewFromHash() {
  const match = /^#map=(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(location.hash);
  if (!match) return null;
  const [zoom, lat, lon] = match.slice(1).map(Number);
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  return { zoom, lat, lon };
}

/**
 * @param {HTMLElement} container
 * @param {AppData} data
 * @returns {MapView}
 */
export function createMap(container, data) {
  const map = L.map(container, { zoomControl: false, minZoom: 5, maxZoom: 18, zoomSnap: 0.25 });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  L.tileLayer(data.layers.base.url, {
    maxZoom: data.layers.base.maxZoom,
    attribution: data.layers.base.attribution,
    crossOrigin: true,
  }).addTo(map);

  // Panes: overlays (tiles) < archive regions < boundaries < marker.
  map.createPane('regions').style.zIndex = '350';
  const boundaryPane = map.createPane('boundaries');
  boundaryPane.style.zIndex = '420';
  boundaryPane.style.pointerEvents = 'none';
  /** @type {HTMLElement} */ (map.getPane('regions')).style.pointerEvents = 'none';

  /** @type {Map<string, string>} */
  const colorByDistrict = new Map();
  for (const archive of data.archives.archives) for (const d of archive.districts) colorByDistrict.set(d, archive.color);

  const regions = L.geoJSON(data.districts, {
    pane: 'regions',
    interactive: false,
    style: (feature) => ({
      stroke: false,
      fillColor: colorByDistrict.get(feature?.properties?.name) ?? '#888888',
      fillOpacity: REGION_FILL_OPACITY,
      className: 'archive-region',
    }),
  });

  L.geoJSON(data.districts, {
    pane: 'boundaries',
    interactive: false,
    style: { color: '#4f5650', weight: 1, opacity: 0.55, fill: false, className: 'district-boundary' },
  }).addTo(map);

  const country = L.geoJSON(data.country, {
    pane: 'boundaries',
    interactive: false,
    style: { color: '#24392d', weight: 2.5, opacity: 0.9, fill: false, className: 'national-border' },
  }).addTo(map);

  /** @type {Map<string, L.TileLayer.WMS>} */
  const overlays = new Map();
  for (const overlay of data.layers.overlays) {
    if (!overlay.enabled) continue;
    overlays.set(
      overlay.id,
      L.tileLayer.wms(overlay.url, {
        layers: overlay.layers,
        format: overlay.format,
        transparent: overlay.transparent,
        version: overlay.version,
        crs: L.CRS.EPSG3857,
        opacity: overlay.opacity,
        attribution: overlay.attribution,
        maxZoom: 18,
        zIndex: 10,
        className: `overlay-${overlay.id}`,
      }),
    );
  }

  const initial = viewFromHash();
  if (initial) map.setView([initial.lat, initial.lon], initial.zoom);
  else map.fitBounds(country.getBounds(), { paddingTopLeft: [8, 62], paddingBottomRight: [8, 8] });

  const writeHash = () => {
    const c = map.getCenter();
    history.replaceState(null, '', `#map=${Number(map.getZoom().toFixed(2))}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`);
  };
  map.on('moveend', writeHash);
  writeHash();
  window.addEventListener('hashchange', () => {
    const view = viewFromHash();
    if (view) map.setView([view.lat, view.lon], view.zoom);
  });

  /** @type {L.CircleMarker | null} */
  let marker = null;

  return {
    map,
    overlays,
    showRegions(on) {
      if (on) regions.addTo(map);
      else regions.remove();
    },
    showOverlay(id, on) {
      const layer = overlays.get(id);
      if (!layer) return;
      if (on) layer.addTo(map);
      else layer.remove();
    },
    setOverlayOpacity(id, opacity) {
      overlays.get(id)?.setOpacity(opacity);
    },
    setMarker(lat, lon) {
      if (!marker) {
        marker = L.circleMarker([lat, lon], {
          radius: 9,
          color: '#fffdf8',
          weight: 3,
          fillColor: '#b5541c',
          fillOpacity: 1,
          interactive: false,
          className: 'place-marker',
        }).addTo(map);
      } else {
        marker.setLatLng([lat, lon]);
        if (!map.hasLayer(marker)) marker.addTo(map);
      }
    },
    clearMarker() {
      marker?.remove();
    },
    centreOn(lat, lon) {
      map.setView([lat, lon], Math.max(map.getZoom(), PLACE_ZOOM));
    },
    onTap(handler) {
      map.on('click', (event) => handler(event.latlng.lat, event.latlng.lng));
    },
  };
}
