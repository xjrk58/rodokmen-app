// Rodokmen map: entry point. Loads the language and the reference data, then
// wires the map, search, place sheet, layers panel and settings together.

import { ArchiveIndex } from './src/archive-lookup.js';
import { loadData } from './src/data.js';
import { Gazetteer } from './src/gazetteer.js';
import { detectLanguage, onLanguageChange, setLanguage, t } from './src/i18n.js';
import { LayersPanel } from './src/layers-panel.js';
import { createMap } from './src/map.js';
import { PlaceSheet } from './src/place-sheet.js';
import { SearchBox } from './src/search-box.js';
import { Settings } from './src/settings.js';
import { registerServiceWorker } from './src/sw-client.js';
import { WorkPanel } from './src/work.js';

/**
 * @template {HTMLElement} T
 * @param {string} id
 * @returns {T}
 */
function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from index.html`);
  return /** @type {T} */ (el);
}

async function main() {
  const message = byId('message');
  const toast = byId('update-toast');
  const reload = /** @type {HTMLButtonElement} */ (byId('update-reload'));

  registerServiceWorker((apply) => {
    toast.hidden = false;
    reload.onclick = () => {
      reload.disabled = true;
      apply();
    };
  });

  await setLanguage(detectLanguage());

  // Drafts and the #work screens need no map data: they work even when it fails to load.
  new WorkPanel({
    panel: byId('work'),
    body: byId('work-body'),
    nav: byId('work-nav'),
    close: /** @type {HTMLButtonElement} */ (byId('work-close')),
    button: /** @type {HTMLButtonElement} */ (byId('work-button')),
    badge: byId('work-badge'),
    toast: byId('drafts-toast'),
  });

  let data;
  try {
    data = await loadData();
  } catch (error) {
    console.error(error);
    message.textContent = t('error.data');
    message.hidden = false;
    return;
  }

  const index = new ArchiveIndex(data.districts, data.archives);
  const gazetteer = new Gazetteer(data.municipalities);
  const mapView = createMap(byId('map'), data);

  const sheet = new PlaceSheet(byId('place-sheet'), {
    index,
    gazetteer,
    viewers: data.layers.viewers,
    onClose: () => mapView.clearMarker(),
  });

  const search = new SearchBox(/** @type {HTMLFormElement} */ (byId('search')), {
    gazetteer,
    onSelect: (m) => {
      layers.closePanel();
      mapView.centreOn(m.lat, m.lon);
      mapView.setMarker(m.lat, m.lon);
      sheet.show({ lat: m.lat, lon: m.lon, municipality: m });
    },
  });

  const layers = new LayersPanel(
    {
      panel: byId('layers-panel'),
      button: /** @type {HTMLButtonElement} */ (byId('layers-button')),
      close: /** @type {HTMLButtonElement} */ (byId('layers-close')),
      regionsToggle: /** @type {HTMLInputElement} */ (byId('regions-toggle')),
      overlayList: byId('overlay-list'),
    },
    { mapView, archives: data.archives.archives, overlays: data.layers.overlays },
  );

  const settings = new Settings(/** @type {HTMLDialogElement} */ (byId('settings')), /** @type {HTMLButtonElement} */ (byId('settings-button')), {
    overlays: data.layers.overlays,
  });

  mapView.onTap((lat, lon) => {
    // A tap outside an open menu only closes the menu.
    if (search.isOpen || layers.isOpen) {
      search.close();
      layers.closePanel();
      return;
    }
    mapView.setMarker(lat, lon);
    sheet.show({ lat, lon });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sheet.open && !search.isOpen && !layers.isOpen) sheet.hide();
  });

  onLanguageChange(() => {
    sheet.render();
    search.refresh();
    layers.render();
    settings.render();
  });

  document.body.dataset.ready = 'true';
}

main();
