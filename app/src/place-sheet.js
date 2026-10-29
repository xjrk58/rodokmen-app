// The place sheet: nearest Municipality and its district, the archive that
// holds the registers with "Open scans", the near-border hint, the Jewish
// registers link and the historical map links.

import { scansUrl } from './archive-lookup.js';
import { closeIcon, externalLink, h } from './dom.js';
import { formatKm, t } from './i18n.js';

/** @typedef {import('./archive-lookup.js').ArchiveIndex} ArchiveIndex */
/** @typedef {import('./gazetteer.js').Gazetteer} Gazetteer */
/** @typedef {import('./types.js').Municipality} Municipality */
/** @typedef {import('./types.js').ViewerLink} ViewerLink */

/**
 * @typedef {object} Place
 * @property {number} lat
 * @property {number} lon
 * @property {Municipality} [municipality] set when the place came from search
 */

/** Below this distance the tapped point counts as the Municipality itself. */
const SAME_PLACE_KM = 0.3;

/**
 * @param {number} lat
 * @param {number} lon
 */
function formatCoordinates(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

/**
 * @param {ViewerLink} viewer
 * @param {string} name
 */
function viewerUrl(viewer, name) {
  return viewer.url.replaceAll('{name}', encodeURIComponent(name));
}

export class PlaceSheet {
  /**
   * @param {HTMLElement} el
   * @param {{ index: ArchiveIndex, gazetteer: Gazetteer, viewers: ViewerLink[], onClose: () => void }} deps
   */
  constructor(el, deps) {
    this.el = el;
    this.deps = deps;
    /** @type {Place | null} */
    this.place = null;
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.hide();
    });
  }

  /** @param {Place} place */
  show(place) {
    this.place = place;
    this.render();
    this.el.hidden = false;
    this.el.scrollTop = 0;
    this.el.focus({ preventScroll: true });
  }

  hide() {
    this.place = null;
    this.el.hidden = true;
    this.el.replaceChildren();
    this.deps.onClose();
  }

  get open() {
    return this.place !== null;
  }

  render() {
    const place = this.place;
    if (!place) return;
    const { index, gazetteer } = this.deps;
    const answer = index.lookup(place.lat, place.lon);
    const close = h('button', { type: 'button', class: 'icon-button', 'aria-label': t('sheet.close'), title: t('sheet.close') }, closeIcon());
    close.addEventListener('click', () => this.hide());

    if (!answer) {
      this.el.replaceChildren(
        h('div', { class: 'sheet-head' },
          h('div', {}, h('h2', {}, formatCoordinates(place.lat, place.lon))),
          close),
        h('p', { class: 'outside', 'data-testid': 'outside' }, t('sheet.outside')),
      );
      return;
    }

    const nearest = place.municipality ? { municipality: place.municipality, km: 0 } : gazetteer.nearest(place.lat, place.lon);
    const municipality = nearest?.municipality;
    const showDistance = nearest && nearest.km >= SAME_PLACE_KM;

    const head = h('div', { class: 'sheet-head' },
      h('div', {},
        showDistance ? h('p', { class: 'eyebrow' }, t('sheet.nearest', { distance: formatKm(nearest.km) })) : null,
        h('h2', { 'data-testid': 'municipality' }, municipality?.name ?? formatCoordinates(place.lat, place.lon)),
        h('p', { class: 'meta' },
          municipality ? h('span', { 'data-testid': 'district' }, t('sheet.district', { district: municipality.district })) : null,
          municipality ? ' · ' : null,
          formatCoordinates(place.lat, place.lon))),
      close);

    const { archive } = answer;
    const registers = h('section', { class: 'registers', 'data-testid': 'registers' },
      h('h3', {}, t('sheet.registers')),
      h('p', { class: 'archive-name', 'data-testid': 'archive' },
        h('span', { class: 'swatch', style: `background:${archive.color}` }),
        h('span', {}, archive.name)),
      externalLink(scansUrl(archive, municipality?.name), t('sheet.openScans'), { class: 'button primary', 'data-testid': 'open-scans' }),
      h('p', { class: 'viewer-note' }, t('sheet.viewer', { portal: archive.portal.name, archive: archive.name })),
      ...answer.alsoCheck.map(({ archive: other, km }) =>
        h('div', { class: 'also-check', role: 'note', 'data-testid': 'also-check' },
          h('p', {}, t('sheet.alsoCheck', { archive: other.name, distance: formatKm(km) })),
          h('p', {}, t('sheet.alsoCheckWhy'), ' ', externalLink(scansUrl(other, municipality?.name), other.portal.name)))),
    );

    const jewish = index.jewishRegisters;
    const jewishSection = h('section', { 'data-testid': 'jewish' },
      h('h3', {}, t('sheet.jewish')),
      h('p', { class: 'secondary' },
        t('sheet.jewishText', { archive: jewish.name }), ' ',
        externalLink(scansUrl(jewish, municipality?.name), t('sheet.jewishLink', { portal: jewish.portal.name }), { 'data-testid': 'jewish-link' })),
    );

    const name = municipality?.name ?? '';
    const historical = h('section', { 'data-testid': 'historical' },
      h('h3', {}, t('sheet.historical')),
      h('ul', { class: 'link-list' },
        ...this.deps.viewers.map((viewer) =>
          h('li', {}, externalLink(viewerUrl(viewer, name), t(`viewer.${viewer.id}`, { name }), { 'data-viewer': viewer.id })))),
    );

    this.el.replaceChildren(head, registers, jewishSection, historical);
  }
}
