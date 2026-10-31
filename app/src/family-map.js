// The family on the map, for signed-in Members (family-map spec): a pin for every Place or House
// with Events of the Tree, grouped at low zoom; a year range from 1600 to 1950 with a play
// control that steps through the decades; a Person's life path; and "Family here" in the place
// sheet. Plain DOM and Leaflet, like the rest of the map (add-family-view design).

import * as L from '../vendor/leaflet/leaflet-src.esm.js';
import { getPerson, mapEvents, placeEvents } from './api.js';
import { loadThrough } from './cache.js';
import { h } from './dom.js';
import { t } from './i18n.js';
import { clusterPins, decades, familyHere, lifePath, pinsFromEvents, YEAR_MAX, YEAR_MIN } from './pins.js';
import { isShown } from './relation.js';
import { personAddress } from './routes.js';
import { errorText } from './screen-parts.js';

/** @typedef {import('./map.js').MapView} MapView */
/** @typedef {import('./place-sheet.js').PlaceSheet} PlaceSheet */
/** @typedef {import('./pins.js').Pin} Pin */
/** @typedef {import('./types.js').MapEvent} MapEvent */

const REFRESH_DELAY_MS = 300;
const PLAY_STEP_MS = 1200;

export class FamilyMap {
  /**
   * @param {{ mapView: MapView, sheet: PlaceSheet, cache: () => boolean }} deps
   */
  constructor(deps) {
    this.deps = deps;
    this.map = deps.mapView.map;
    this.pins = L.layerGroup();
    this.path = L.layerGroup();
    this.range = { from: YEAR_MIN, to: YEAR_MAX };
    /** @type {MapEvent[]} */
    this.events = [];
    this.on = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this.timer = undefined;
    /** @type {ReturnType<typeof setInterval> | undefined} */
    this.player = undefined;
    /** @type {AbortController | null} */
    this.loading = null;
    this.includeUnrelated = false;
    this.control = this.buildControl();
    this.lifeChip = h('div', { class: 'life-chip', hidden: true, 'data-testid': 'life-chip' });
    document.body.append(this.control, this.lifeChip);
    this.map.on('moveend', () => this.schedule());
    this.map.on('zoomend', () => this.draw());
  }

  /** Shows the family layer (signed in) or removes it. @param {boolean} on */
  enable(on) {
    this.on = on;
    this.control.hidden = !on;
    if (on) {
      this.pins.addTo(this.map);
      this.path.addTo(this.map);
      this.schedule(0);
    } else {
      this.stop();
      this.pins.remove();
      this.path.remove();
      this.events = [];
      this.pins.clearLayers();
      this.path.clearLayers();
      this.lifeChip.hidden = true;
    }
  }

  buildControl() {
    /** @param {'from' | 'to'} which */
    const slider = (which) => {
      const input = h('input', {
        type: 'range',
        min: String(YEAR_MIN),
        max: String(YEAR_MAX),
        step: '1',
        value: String(this.range[which]),
        'data-testid': `year-${which}`,
      });
      input.setAttribute('aria-label', t(`familyMap.${which}`));
      input.addEventListener('input', () => {
        this.stop();
        this.setRange(which === 'from' ? Number(input.value) : this.range.from, which === 'to' ? Number(input.value) : this.range.to);
      });
      return input;
    };
    this.fromInput = slider('from');
    this.toInput = slider('to');
    this.output = h('output', { 'data-testid': 'year-range', 'aria-live': 'polite' }, `${YEAR_MIN}–${YEAR_MAX}`);
    this.playButton = h('button', { type: 'button', class: 'round-button play', 'data-testid': 'year-play', 'aria-pressed': 'false' }, '▶');
    this.playButton.addEventListener('click', () => (this.player ? this.stop() : this.play()));
    this.translateControl();
    return h(
      'div',
      { class: 'year-filter', hidden: true, 'data-testid': 'year-filter' },
      this.playButton,
      h('div', { class: 'year-sliders' }, this.output, this.fromInput, this.toInput),
    );
  }

  translateControl() {
    this.fromInput?.setAttribute('aria-label', t('familyMap.from'));
    this.toInput?.setAttribute('aria-label', t('familyMap.to'));
    this.playButton?.setAttribute('aria-label', this.player ? t('familyMap.pause') : t('familyMap.play'));
  }

  /** @param {number} from @param {number} to */
  setRange(from, to) {
    const [a, b] = from <= to ? [from, to] : [to, from];
    this.range = { from: a, to: b };
    if (this.fromInput && this.toInput && this.output) {
      this.fromInput.value = String(a);
      this.toInput.value = String(b);
      this.output.textContent = `${a}–${b}`;
    }
    this.schedule();
  }

  /** Steps through the decades from the start of the range shown. */
  play() {
    const steps = decades(this.range.from === YEAR_MIN && this.range.to === YEAR_MAX ? YEAR_MIN : this.range.from, YEAR_MAX);
    let i = 0;
    const step = () => {
      const s = steps[i++];
      if (!s) return this.stop();
      this.setRange(s[0], s[1]);
    };
    step();
    this.player = setInterval(step, PLAY_STEP_MS);
    this.playButton?.setAttribute('aria-pressed', 'true');
    if (this.playButton) this.playButton.textContent = '❚❚';
    this.translateControl();
  }

  stop() {
    clearInterval(this.player);
    this.player = undefined;
    this.playButton?.setAttribute('aria-pressed', 'false');
    if (this.playButton) this.playButton.textContent = '▶';
    this.translateControl();
  }

  /** Loads the pins for the map area and year range soon; quick changes share one request. */
  schedule(delay = REFRESH_DELAY_MS) {
    if (!this.on) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), delay);
  }

  async refresh() {
    this.loading?.abort();
    const controller = new AbortController();
    this.loading = controller;
    const b = this.map.getBounds();
    /** @type {[number, number, number, number]} */
    const bbox = [Math.max(-180, b.getWest()), Math.max(-85, b.getSouth()), Math.min(180, b.getEast()), Math.min(85, b.getNorth())];
    try {
      const result = await mapEvents({ bbox, ...this.range }, controller.signal);
      if (controller.signal.aborted) return;
      this.events = result.events;
      this.draw();
    } catch (error) {
      if (!controller.signal.aborted) console.warn('Family pins not loaded.', error);
    }
  }

  draw() {
    this.pins.clearLayers();
    if (!this.on) return;
    const pins = pinsFromEvents(this.events, (p) => isShown(p, this.includeUnrelated));
    const zoom = this.map.getZoom();
    for (const cluster of clusterPins(pins, (lat, lon) => this.map.project([lat, lon], zoom))) {
      if (cluster.pins.length === 1) this.pins.addLayer(this.pinMarker(cluster.pins[0]));
      else this.pins.addLayer(this.clusterMarker(cluster));
    }
  }

  /** @param {Pin} pin */
  pinMarker(pin) {
    const marker = L.marker([pin.lat, pin.lon], {
      icon: L.divIcon({ className: 'family-pin', html: `<span>${pin.personIds.length}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
      title: t('familyMap.pin', { name: pin.name, count: pin.personIds.length }),
      alt: t('familyMap.pin', { name: pin.name, count: pin.personIds.length }),
      keyboard: true,
    });
    marker.on('click', () => {
      this.deps.mapView.setMarker(pin.lat, pin.lon);
      this.deps.sheet.show({ lat: pin.lat, lon: pin.lon, family: { placeId: pin.placeId, name: pin.name } });
    });
    marker.on('add', () => marker.getElement()?.setAttribute('data-testid', 'family-pin'));
    return marker;
  }

  /** @param {import('./pins.js').Cluster} cluster */
  clusterMarker(cluster) {
    const marker = L.marker([cluster.lat, cluster.lon], {
      icon: L.divIcon({ className: 'family-cluster', html: `<span>${cluster.count}</span>`, iconSize: [40, 40], iconAnchor: [20, 20] }),
      title: t('familyMap.cluster', { places: cluster.pins.length, count: cluster.count }),
      alt: t('familyMap.cluster', { places: cluster.pins.length, count: cluster.count }),
      keyboard: true,
    });
    marker.on('click', () => {
      const bounds = L.latLngBounds(cluster.pins.map((p) => L.latLng(p.lat, p.lon)));
      this.map.fitBounds(bounds.pad(0.3), { maxZoom: Math.max(this.map.getZoom() + 2, 12) });
    });
    marker.on('add', () => marker.getElement()?.setAttribute('data-testid', 'family-cluster'));
    return marker;
  }

  /**
   * Draws a Person's life path: their Events in date order joined by a line, each point labelled with its years.
   * @param {string | null} personId null clears it
   */
  async showLife(personId) {
    this.path.clearLayers();
    this.lifeChip.hidden = true;
    if (!personId || !this.on) return;
    /** @type {import('./types.js').PersonDetail | null} */
    let person = null;
    await loadThrough(
      `person:${personId}`,
      () => getPerson(personId),
      (p) => (person = p),
      { cache: this.deps.cache() },
    ).catch((error) => {
      this.lifeChip.replaceChildren(h('span', {}, errorText(error)));
      this.lifeChip.hidden = false;
    });
    if (!person) return;
    /** @type {import('./types.js').PersonDetail} */
    const p = person;
    const points = lifePath(p.events);
    const name = p.names.find((n) => n.primary);
    const label = name ? `${name.given} ${name.surname}`.trim() : '';
    const close = h('button', { type: 'button', class: 'icon-button', 'aria-label': t('familyMap.closeLife') }, '✕');
    close.addEventListener('click', () => (location.hash = '#map'));
    this.lifeChip.replaceChildren(h('a', { href: personAddress(p.id) }, t('familyMap.lifeOf', { name: label })), close);
    this.lifeChip.hidden = false;
    if (points.length === 0) {
      this.lifeChip.prepend(h('span', { class: 'muted small' }, `${t('familyMap.noPlaces')} `));
      return;
    }
    const latlngs = points.map((pt) => L.latLng(pt.lat, pt.lon));
    this.path.addLayer(L.polyline(latlngs, { color: '#b5541c', weight: 3, opacity: 0.85, className: 'life-line' }));
    points.forEach((pt, i) => {
      const dot = L.circleMarker(latlngs[i], { radius: 7, color: '#fffdf8', weight: 2, fillColor: '#b5541c', fillOpacity: 1, className: 'life-point' });
      dot.bindTooltip(`${i + 1}. ${pt.placeName} ${pt.years.join(', ')}`, { permanent: true, direction: 'top', className: 'life-label', offset: [0, -6] });
      this.path.addLayer(dot);
    });
    this.map.fitBounds(L.latLngBounds(latlngs).pad(0.4), { maxZoom: 12 });
  }

  /**
   * The "Family here" section of the place sheet: the Events at a Place and its Houses, by Person.
   * @param {{ placeId: string }} family
   * @returns {HTMLElement}
   */
  familyHere(family) {
    const list = h('div', { class: 'family-here-list' }, h('p', { class: 'muted small' }, t('work.loading')));
    const section = h('section', { class: 'family-here', 'data-testid': 'family-here' }, h('h3', {}, t('familyMap.here')), list);
    loadThrough(
      `place-events:${family.placeId}`,
      () => placeEvents(family.placeId),
      (data) => {
        const persons = familyHere(data.events, (p) => isShown(p, this.includeUnrelated));
        list.replaceChildren(
          persons.length
            ? h(
                'ul',
                { class: 'link-list here-persons' },
                ...persons.map((entry) =>
                  h(
                    'li',
                    { 'data-testid': 'here-person' },
                    h('a', { href: personAddress(entry.person.id) }, entry.person.displayName),
                    h(
                      'span',
                      { class: 'small muted' },
                      ` ${entry.events.map((e) => `${t(`eventType.${e.type}`)}${e.role === 'child' || e.role === 'deceased' || e.role === 'partner' ? '' : ` (${t(`role.${e.role}`)})`}${e.year ? ` ${e.year}` : ''}`).join(', ')}`,
                    ),
                  ),
                ),
              )
            : h('p', { class: 'muted small' }, t('familyMap.nobodyHere')),
          ...(data.truncated ? [h('p', { class: 'muted small' }, t('familyMap.truncated'))] : []),
        );
      },
      { cache: this.deps.cache() },
    ).catch((error) => list.replaceChildren(h('p', { class: 'form-status error' }, errorText(error))));
    return section;
  }
}
