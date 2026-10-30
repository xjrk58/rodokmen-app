// The map layers panel (archive regions, historical overlays with opacity)
// and the archive legend shown on the map while the regions layer is on.

import * as L from '../vendor/leaflet/leaflet-src.esm.js';
import { h, icon } from './dom.js';
import { t } from './i18n.js';

/** @typedef {import('./map.js').MapView} MapView */
/** @typedef {import('./types.js').Archive} Archive */
/** @typedef {import('./types.js').OverlayConfig} OverlayConfig */

const REGIONS_KEY = 'rodokmen.archiveRegions';

/**
 * @param {string} key
 * @returns {string | null}
 */
function stored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {string} value
 */
function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked
  }
}

class Legend extends L.Control {
  /** @param {Archive[]} archives */
  constructor(archives) {
    super({ position: 'bottomleft' });
    this.archives = archives;
    this.collapsed = window.matchMedia('(max-width: 480px) and (max-height: 700px)').matches;
    this.el = h('div', { class: 'legend', 'data-testid': 'legend' });
    L.DomEvent.disableClickPropagation(this.el);
    L.DomEvent.disableScrollPropagation(this.el);
  }

  onAdd() {
    this.render();
    return this.el;
  }

  render() {
    const head = h(
      'button',
      { type: 'button', class: 'legend-head', 'aria-expanded': String(!this.collapsed), title: t('legend.toggle') },
      h('span', {}, t('legend.title')),
      icon('m6 9 6 6 6-6'),
    );
    head.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.render();
    });
    this.el.dataset.collapsed = String(this.collapsed);
    this.el.replaceChildren(
      head,
      h(
        'ul',
        {},
        ...this.archives.map((a) => h('li', { 'data-archive': a.id }, h('span', { class: 'swatch', style: `background:${a.color}` }), h('span', {}, a.name))),
      ),
    );
  }
}

export class LayersPanel {
  /**
   * @param {{ panel: HTMLElement, button: HTMLButtonElement, close: HTMLButtonElement, regionsToggle: HTMLInputElement, overlayList: HTMLElement }} els
   * @param {{ mapView: MapView, archives: Archive[], overlays: OverlayConfig[] }} deps
   */
  constructor(els, deps) {
    this.els = els;
    this.deps = deps;
    this.legend = new Legend(deps.archives);
    /** @type {Map<string, { on: boolean, opacity: number }>} */
    this.overlayState = new Map(deps.overlays.filter((o) => o.enabled).map((o) => [o.id, { on: false, opacity: o.opacity }]));

    els.button.addEventListener('click', () => (this.isOpen ? this.closePanel() : this.openPanel()));
    els.close.addEventListener('click', () => this.closePanel());
    els.panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closePanel();
    });
    els.regionsToggle.addEventListener('change', () => this.setRegions(els.regionsToggle.checked));
    this.setRegions(stored(REGIONS_KEY) === 'on');
    this.render();
  }

  get isOpen() {
    return !this.els.panel.hidden;
  }

  openPanel() {
    this.els.panel.hidden = false;
    this.els.button.setAttribute('aria-expanded', 'true');
    this.els.regionsToggle.focus({ preventScroll: true });
  }

  closePanel() {
    this.els.panel.hidden = true;
    this.els.button.setAttribute('aria-expanded', 'false');
  }

  /** @param {boolean} on */
  setRegions(on) {
    this.els.regionsToggle.checked = on;
    this.deps.mapView.showRegions(on);
    if (on) this.legend.addTo(this.deps.mapView.map);
    else this.legend.remove();
    store(REGIONS_KEY, on ? 'on' : 'off');
  }

  render() {
    this.legend.render();
    const items = this.deps.overlays
      .filter((o) => o.enabled)
      .map((overlay) => {
        const state = /** @type {{ on: boolean, opacity: number }} */ (this.overlayState.get(overlay.id));
        const name = t(`overlay.${overlay.id}`);
        const toggle = h('input', { type: 'checkbox', 'data-overlay': overlay.id, checked: state.on });
        toggle.addEventListener('change', () => {
          state.on = toggle.checked;
          this.deps.mapView.showOverlay(overlay.id, state.on);
          slider.disabled = !state.on;
        });
        const slider = h('input', {
          type: 'range',
          min: '0',
          max: '100',
          step: '5',
          value: String(Math.round(state.opacity * 100)),
          'aria-label': t('layers.opacity', { layer: name }),
          'data-opacity': overlay.id,
          disabled: !state.on,
        });
        slider.addEventListener('input', () => {
          state.opacity = Number(slider.value) / 100;
          this.deps.mapView.setOverlayOpacity(overlay.id, state.opacity);
        });
        return h('div', { class: 'overlay-item' }, h('label', { class: 'switch-row' }, toggle, h('span', {}, name)), slider);
      });
    this.els.overlayList.replaceChildren(...(items.length ? items : [h('p', { class: 'muted' }, t('layers.none'))]));
  }
}
