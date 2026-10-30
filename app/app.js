// Rodokmen map: entry point. Loads the language and the reference data, then
// wires the map, search, place sheet, layers panel and settings together.

import { ArchiveIndex } from './src/archive-lookup.js';
import { loadData } from './src/data.js';
import { Gazetteer } from './src/gazetteer.js';
import { required } from './src/dom.js';
import { detectLanguage, onLanguageChange, setLanguage, t } from './src/i18n.js';
import { LayersPanel } from './src/layers-panel.js';
import { createMap } from './src/map.js';
import { PlaceSheet } from './src/place-sheet.js';
import { SearchBox } from './src/search-box.js';
import { Settings } from './src/settings.js';
import { registerServiceWorker } from './src/sw-client.js';
import { WorkPanel } from './src/work.js';

/**
 * An element of index.html, checked to be of its type.
 * @template {HTMLElement} E
 * @param {string} id
 * @param {new () => E} type
 * @returns {E}
 */
const byId = (id, type) => required(document, `#${id}`, type);

/**
 * Shown when the app cannot start: in both languages, because the interface
 * strings themselves may be what failed to load.
 */
const FATAL = 'Aplikaci se nepodařilo načíst. Zkontrolujte připojení a obnovte stránku. · The app could not be loaded. Check the connection and reload the page.';

/** @param {unknown} error */
function showFatal(error) {
  console.error(error);
  const message = document.getElementById('message');
  if (message) {
    message.textContent = FATAL;
    message.hidden = false;
  }
  document.body.dataset.ready = 'error';
}

async function main() {
  const message = byId('message', HTMLElement);
  const toast = byId('update-toast', HTMLElement);
  const reload = byId('update-reload', HTMLButtonElement);

  registerServiceWorker((apply) => {
    toast.hidden = false;
    reload.onclick = () => {
      reload.disabled = true;
      apply();
    };
  }).catch((error) => console.warn('Service worker not registered; the app will not work offline.', error));

  await setLanguage(detectLanguage());

  // Drafts and the #work screens need no map data: they work even when it fails to load.
  new WorkPanel({
    panel: byId('work', HTMLElement),
    body: byId('work-body', HTMLElement),
    nav: byId('work-nav', HTMLElement),
    close: byId('work-close', HTMLButtonElement),
    button: byId('work-button', HTMLButtonElement),
    badge: byId('work-badge', HTMLElement),
    toast: byId('drafts-toast', HTMLElement),
  });

  let data;
  try {
    data = await loadData();
  } catch (error) {
    console.error(error);
    message.textContent = t('error.data');
    message.hidden = false;
    document.body.dataset.ready = 'error';
    return;
  }

  const index = new ArchiveIndex(data.districts, data.archives);
  const gazetteer = new Gazetteer(data.municipalities);
  const mapView = createMap(byId('map', HTMLElement), data);

  const sheet = new PlaceSheet(byId('place-sheet', HTMLElement), {
    index,
    gazetteer,
    viewers: data.layers.viewers,
    onClose: () => mapView.clearMarker(),
  });

  const search = new SearchBox(byId('search', HTMLFormElement), {
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
      panel: byId('layers-panel', HTMLElement),
      button: byId('layers-button', HTMLButtonElement),
      close: byId('layers-close', HTMLButtonElement),
      regionsToggle: byId('regions-toggle', HTMLInputElement),
      overlayList: byId('overlay-list', HTMLElement),
    },
    { mapView, archives: data.archives.archives, overlays: data.layers.overlays },
  );

  const settings = new Settings(byId('settings', HTMLDialogElement), byId('settings-button', HTMLButtonElement), {
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
    // Escape in an open dialog (Settings) closes only the dialog.
    if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (sheet.open && !search.isOpen && !layers.isOpen) sheet.hide();
  });

  onLanguageChange(() => {
    sheet.render();
    search.refresh();
    layers.render();
    settings.render();
  });

  document.body.dataset.ready = 'true';
}

main().catch(showFatal);
