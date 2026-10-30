// Pickers for the Propose forms and the review tools: a Person (found in the
// Tree or new by name), a Place and a Source. Searching needs a connection;
// a new Person can always be typed in, also offline.

import { ApiError, searchPersons, searchPlaces, searchSources } from './api.js';
import { h } from './dom.js';
import { t } from './i18n.js';
import { SEXES } from './proposal-build.js';

/** @typedef {import('./proposal-build.js').PersonInput} PersonInput */
/** @typedef {import('./proposal-build.js').PlaceChoice} PlaceChoice */
/** @typedef {import('./proposal-build.js').SourceChoice} SourceChoice */
/** @typedef {import('./types.js').PersonSearchHit} PersonSearchHit */
/** @typedef {import('./types.js').PlaceSummary} PlaceSummary */
/** @typedef {import('./types.js').SourceSummary} SourceSummary */

const SEARCH_DELAY_MS = 250;

/**
 * @param {string} given
 * @param {string} surname
 * @param {string | null} birth
 */
function personText(given, surname, birth) {
  const name = `${given} ${surname}`.trim();
  return birth ? `${name} (* ${birth.slice(0, 4)})` : name;
}

/**
 * A search box with results, calling `search` as the Member types.
 * @template T
 * @param {{ placeholder: string, testid: string, search: (q: string) => Promise<T[]>, label: (item: T) => string, onPick: (item: T) => void }} o
 */
function searchBox(o) {
  const input = h('input', { type: 'search', placeholder: o.placeholder, 'data-testid': `${o.testid}-search`, autocomplete: 'off', enterkeyhint: 'search' });
  const list = h('ul', { class: 'picker-results', 'data-testid': `${o.testid}-results` });
  const note = h('p', { class: 'muted small', role: 'status' });
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) {
      list.replaceChildren();
      note.textContent = '';
      return;
    }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const items = await o.search(q);
        if (mine !== seq) return;
        note.textContent = items.length ? '' : t('picker.none');
        list.replaceChildren(...items.map((item) => h('li', {}, h('button', { type: 'button', class: 'picker-item' }, o.label(item)))));
        list.querySelectorAll('button').forEach((b, i) => b.addEventListener('click', () => o.onPick(items[i])));
      } catch (error) {
        if (mine !== seq) return;
        note.textContent = error instanceof ApiError && error.offline ? t('picker.offline') : t('picker.failed');
      }
    }, SEARCH_DELAY_MS);
  });
  return h('div', { class: 'picker-search' }, input, note, list);
}

/**
 * @param {{ value: PersonInput | null, onChange: (v: PersonInput | null) => void, label: string, testid: string, allowNew?: boolean }} o
 * @returns {HTMLElement}
 */
export function personPicker(o) {
  const root = h('fieldset', { class: 'picker', 'data-testid': o.testid }, h('legend', {}, o.label));
  /** @param {PersonInput | null} value */
  const render = (value) => {
    const legend = /** @type {HTMLElement} */ (root.firstChild);
    /** @param {PersonInput | null} v */
    const set = (v) => {
      o.onChange(v);
      render(v);
    };
    let body;
    if (value?.mode === 'existing') {
      body = h('div', { class: 'picked' },
        h('span', { 'data-testid': `${o.testid}-picked` }, value.label),
        h('button', { type: 'button', class: 'link-button' }, t('picker.change')));
      body.querySelector('button')?.addEventListener('click', () => set(null));
    } else if (value?.mode === 'new') {
      const v = value;
      /** @param {'given' | 'surname'} key */
      const field = (key) => {
        const input = h('input', { type: 'text', value: v[key] ?? '', 'data-testid': `${o.testid}-${key}`, autocapitalize: 'words' });
        input.addEventListener('input', () => {
          v[key] = input.value;
          o.onChange({ ...v });
        });
        return h('label', { class: 'field' }, h('span', {}, t(`picker.${key}`)), input);
      };
      const sex = h('select', { 'data-testid': `${o.testid}-sex` },
        ...SEXES.map((s) => h('option', { value: s, selected: v.sex === s }, t(`sex.${s}`))));
      sex.addEventListener('change', () => {
        v.sex = SEXES.find((s) => s === sex.value) ?? 'unknown';
        o.onChange({ ...v });
      });
      body = h('div', { class: 'new-person' }, field('given'), field('surname'), h('label', { class: 'field' }, h('span', {}, t('picker.sex')), sex),
        h('button', { type: 'button', class: 'link-button' }, t('picker.findInstead')));
      body.querySelector('.link-button')?.addEventListener('click', () => set(null));
    } else {
      /** @type {HTMLElement} */
      const search = searchBox({
        placeholder: t('picker.searchPerson'),
        testid: o.testid,
        search: async (q) => (await searchPersons(q)).items,
        /** @param {PersonSearchHit} hit */
        label: (hit) => personText(hit.person.given, hit.person.surname, hit.person.birth),
        /** @param {PersonSearchHit} hit */
        onPick: (hit) => set({ mode: 'existing', id: hit.person.id, version: hit.person.version, label: personText(hit.person.given, hit.person.surname, hit.person.birth) }),
      });
      const add = o.allowNew === false ? null : h('button', { type: 'button', class: 'link-button', 'data-testid': `${o.testid}-new` }, t('picker.newPerson'));
      add?.addEventListener('click', () => set({ mode: 'new', given: '', surname: '', sex: 'unknown' }));
      body = h('div', {}, search, add);
    }
    root.replaceChildren(legend, body);
  };
  render(o.value);
  return root;
}

/**
 * @param {{ value: { id: string, label: string } | null, onChange: (v: { id: string, label: string } | null) => void, testid: string }} o
 */
export function placePicker(o) {
  const root = h('fieldset', { class: 'picker', 'data-testid': o.testid }, h('legend', {}, t('propose.place')));
  /** @param {{ id: string, label: string } | null} value */
  const render = (value) => {
    const legend = /** @type {HTMLElement} */ (root.firstChild);
    if (value) {
      const body = h('div', { class: 'picked' }, h('span', { 'data-testid': `${o.testid}-picked` }, value.label), h('button', { type: 'button', class: 'link-button' }, t('picker.change')));
      body.querySelector('button')?.addEventListener('click', () => {
        o.onChange(null);
        render(null);
      });
      root.replaceChildren(legend, body);
      return;
    }
    root.replaceChildren(legend, searchBox({
      placeholder: t('picker.searchPlace'),
      testid: o.testid,
      search: async (q) => (await searchPlaces(q)).items,
      /** @param {PlaceSummary} p */
      label: (p) => (p.municipality ? `${p.name} (${p.municipality.name})` : p.name),
      /** @param {PlaceSummary} p */
      onPick: (p) => {
        const v = { id: p.id, label: p.name };
        o.onChange(v);
        render(v);
      },
    }));
  };
  render(o.value);
  return root;
}

/**
 * @param {{ value: { id: string, label: string } | null, onChange: (v: { id: string, label: string } | null) => void, testid: string }} o
 */
export function sourcePicker(o) {
  const root = h('div', { class: 'picker', 'data-testid': o.testid });
  /** @param {{ id: string, label: string } | null} value */
  const render = (value) => {
    if (value) {
      const body = h('div', { class: 'picked' }, h('span', { 'data-testid': `${o.testid}-picked` }, value.label), h('button', { type: 'button', class: 'link-button' }, t('picker.change')));
      body.querySelector('button')?.addEventListener('click', () => {
        o.onChange(null);
        render(null);
      });
      root.replaceChildren(body);
      return;
    }
    root.replaceChildren(searchBox({
      placeholder: t('picker.searchSource'),
      testid: o.testid,
      search: async (q) => (await searchSources(q)).items,
      /** @param {SourceSummary} s */
      label: (s) => s.title,
      /** @param {SourceSummary} s */
      onPick: (s) => {
        const v = { id: s.id, label: s.title };
        o.onChange(v);
        render(v);
      },
    }));
  };
  render(o.value);
  return root;
}
