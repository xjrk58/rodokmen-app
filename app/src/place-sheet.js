// The place sheet: nearest Municipality and its district, the archive that
// holds the registers with "Open scans", the near-border hint, the Jewish
// registers link and the historical map links.

import { scansUrl } from './archive-lookup.js';
import { closeIcon, externalLink, h } from './dom.js';
import { formatKm, t } from './i18n.js';
import { withName } from './text.js';

/** @typedef {import('./archive-lookup.js').ArchiveIndex} ArchiveIndex */
/** @typedef {import('./gazetteer.js').Gazetteer} Gazetteer */
/** @typedef {import('./types.js').Municipality} Municipality */
/** @typedef {import('./types.js').ViewerLink} ViewerLink */

/**
 * A point on the map the sheet is about: tapped, a Municipality chosen in search, or a family
 * pin, which is a Place (or House) of the Tree and gets "Family here" (add-family-view).
 * @typedef {object} MapPoint
 * @property {number} lat
 * @property {number} lon
 * @property {Municipality} [municipality] set when the point came from search
 * @property {{ placeId: string, name: string }} [family] set when the point is a family pin
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

export class PlaceSheet {
  /**
   * @param {HTMLElement} el
   * @param {{ index: ArchiveIndex, gazetteer: Gazetteer, viewers: ViewerLink[], onClose: () => void, familyHere?: (family: { placeId: string }) => HTMLElement }} deps
   */
  constructor(el, deps) {
    this.el = el;
    this.deps = deps;
    /** @type {MapPoint | null} */
    this.point = null;
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.hide();
    });
  }

  /** @param {MapPoint} point */
  show(point) {
    this.point = point;
    this.render();
    this.el.hidden = false;
    this.el.scrollTop = 0;
    this.el.focus({ preventScroll: true });
  }

  hide() {
    this.point = null;
    this.el.hidden = true;
    this.el.replaceChildren();
    this.deps.onClose();
  }

  get open() {
    return this.point !== null;
  }

  /**
   * The sheet's title: the family pin's Place, or the nearest Municipality, with its district.
   * @param {MapPoint} point
   * @param {{ municipality: Municipality, km: number } | null} nearest
   */
  title(point, nearest) {
    const municipality = nearest?.municipality;
    const showDistance = nearest && nearest.km >= SAME_PLACE_KM;
    return h(
      'div',
      {},
      point.family ? h('h2', { 'data-testid': 'place-name' }, point.family.name) : null,
      showDistance ? h('p', { class: 'eyebrow' }, t('sheet.nearest', { distance: formatKm(nearest.km) })) : null,
      point.family
        ? h('p', { 'data-testid': 'municipality' }, municipality?.name ?? '')
        : h('h2', { 'data-testid': 'municipality' }, municipality?.name ?? formatCoordinates(point.lat, point.lon)),
      h(
        'p',
        { class: 'meta' },
        municipality ? h('span', { 'data-testid': 'district' }, t('sheet.district', { district: municipality.district })) : null,
        municipality ? ' · ' : null,
        formatCoordinates(point.lat, point.lon),
      ),
    );
  }

  render() {
    const point = this.point;
    if (!point) return;
    const { index, gazetteer } = this.deps;
    const nearest = point.municipality ? { municipality: point.municipality, km: 0 } : gazetteer.nearest(point.lat, point.lon);
    const municipality = nearest?.municipality;
    const answer = index.lookup(point.lat, point.lon, municipality);
    const close = h('button', { type: 'button', class: 'icon-button', 'aria-label': t('sheet.close'), title: t('sheet.close') }, closeIcon());
    close.addEventListener('click', () => this.hide());

    const family = point.family && this.deps.familyHere ? this.deps.familyHere(point.family) : null;
    if (!answer) {
      this.el.replaceChildren(
        h(
          'div',
          { class: 'sheet-head' },
          h('div', {}, h('h2', { 'data-testid': 'place-name' }, point.family?.name ?? formatCoordinates(point.lat, point.lon))),
          close,
        ),
        ...(family ? [family] : []),
        h('p', { class: 'outside', 'data-testid': 'outside' }, family ? t('sheet.outsideFamily') : t('sheet.outside')),
      );
      return;
    }

    const head = h('div', { class: 'sheet-head' }, this.title(point, nearest), close);

    const { archive } = answer;
    const registers = h(
      'section',
      { class: 'registers', 'data-testid': 'registers' },
      h('h3', {}, t('sheet.registers')),
      h(
        'p',
        { class: 'archive-name', 'data-testid': 'archive' },
        h('span', { class: 'swatch', style: `background:${archive.color}` }),
        h('span', {}, archive.name),
      ),
      externalLink(scansUrl(archive, municipality?.name), t('sheet.openScans'), { class: 'button primary', 'data-testid': 'open-scans' }),
      h('p', { class: 'viewer-note' }, t('sheet.viewer', { portal: archive.portal.name, archive: archive.name })),
      ...answer.alsoCheck.map(({ archive: other, km, reason, district, olderDistrict }) =>
        h(
          'div',
          { class: 'also-check', role: 'note', 'data-testid': 'also-check', 'data-reason': reason },
          h(
            'p',
            {},
            reason === 'district'
              ? t('sheet.alsoCheckDistrict', { archive: other.name, district: district ?? '' })
              : t('sheet.alsoCheck', { archive: other.name, distance: formatKm(km) }),
          ),
          h(
            'p',
            {},
            reason === 'district' ? t('sheet.alsoCheckDistrictWhy', { olderDistrict: olderDistrict ?? '' }) : t('sheet.alsoCheckWhy'),
            ' ',
            externalLink(scansUrl(other, municipality?.name), other.portal.name),
          ),
        ),
      ),
    );

    const jewish = index.jewishRegisters;
    const jewishSection = h(
      'section',
      { 'data-testid': 'jewish' },
      h('h3', {}, t('sheet.jewish')),
      h(
        'p',
        { class: 'secondary' },
        t('sheet.jewishText', { archive: jewish.name }),
        ' ',
        externalLink(scansUrl(jewish, municipality?.name), t('sheet.jewishLink', { portal: jewish.portal.name }), { 'data-testid': 'jewish-link' }),
      ),
    );

    const name = municipality?.name ?? '';
    const historical = h(
      'section',
      { 'data-testid': 'historical' },
      h('h3', {}, t('sheet.historical')),
      h(
        'ul',
        { class: 'link-list' },
        ...this.deps.viewers.map((viewer) =>
          h('li', {}, externalLink(withName(viewer.url, name), t(`viewer.${viewer.id}`, { name }), { 'data-viewer': viewer.id })),
        ),
      ),
    );

    this.el.replaceChildren(head, ...(family ? [family] : []), registers, jewishSection, historical);
  }
}
