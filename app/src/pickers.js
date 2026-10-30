// Pickers for the Propose forms and the review tools: a Person (found in the
// Tree or new by name), a Place and a Source. Searching needs a connection;
// a new Person can always be typed in, also offline.

import { api } from './api.js';
import { h } from './dom.js';
import { t } from './i18n.js';

/** @typedef {import('./proposal-build.js').PersonInput} PersonInput */

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
        note.textContent = /** @type {any} */ (error).offline ? t('picker.offline') : t('picker.failed');
      }
    }, SEARCH_DELAY_MS);
  });
  return h('div', { class: 'picker-search' }, input, note, list);
}

/**
 * @param {{ value: PersonInput | null, onChange: (v: PersonInput | null) => void, label: string, testid: string, allowNew?: boolean, newOnly?: boolean }} o
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
    } else if (value?.mode === 'new' || o.newOnly) {
      const v = value?.mode === 'new' ? value : { mode: /** @type {const} */ ('new'), given: '', surname: '', sex: /** @type {const} */ ('unknown') };
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
        ...['unknown', 'female', 'male'].map((s) => h('option', { value: s, selected: v.sex === s }, t(`sex.${s}`))));
      sex.addEventListener('change', () => {
        v.sex = /** @type {any} */ (sex.value);
        o.onChange({ ...v });
      });
      body = h('div', { class: 'new-person' }, field('given'), field('surname'), h('label', { class: 'field' }, h('span', {}, t('picker.sex')), sex),
        o.newOnly ? null : h('button', { type: 'button', class: 'link-button' }, t('picker.findInstead')));
      body.querySelector('.link-button')?.addEventListener('click', () => set(null));
    } else {
      const search = searchBox({
        placeholder: t('picker.searchPerson'),
        testid: o.testid,
        search: async (q) => (await api(`persons?q=${encodeURIComponent(q)}&limit=8`)).items,
        label: (/** @type {any} */ hit) => personText(hit.person.given, hit.person.surname, hit.person.birth),
        onPick: (/** @type {any} */ hit) => set({ mode: 'existing', id: hit.person.id, version: hit.person.version, label: personText(hit.person.given, hit.person.surname, hit.person.birth) }),
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
      search: async (q) => (await api(`places?q=${encodeURIComponent(q)}&limit=8`)).items,
      label: (/** @type {any} */ p) => p.municipality ? `${p.name} (${p.municipality.name})` : p.name,
      onPick: (/** @type {any} */ p) => {
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
      search: async (q) => (await api(`sources?q=${encodeURIComponent(q)}&limit=8`)).items,
      label: (/** @type {any} */ s) => s.title,
      onPick: (/** @type {any} */ s) => {
        const v = { id: s.id, label: s.title };
        o.onChange(v);
        render(v);
      },
    }));
  };
  render(o.value);
  return root;
}
