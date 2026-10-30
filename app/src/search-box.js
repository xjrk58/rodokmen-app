// Municipality search as a combobox: results appear as the reader types,
// each with its district; arrow keys move, Enter or a tap chooses.

import { h, required } from './dom.js';
import { t } from './i18n.js';

/** @typedef {import('./gazetteer.js').Gazetteer} Gazetteer */
/** @typedef {import('./types.js').Municipality} Municipality */

export class SearchBox {
  /**
   * @param {HTMLFormElement} form
   * @param {{ gazetteer: Gazetteer, onSelect: (m: Municipality) => void }} deps
   */
  constructor(form, deps) {
    this.deps = deps;
    this.input = required(form, '#search-input', HTMLInputElement);
    this.clear = required(form, '#search-clear', HTMLButtonElement);
    this.box = required(form, '#search-results-box', HTMLElement);
    this.list = required(form, '#search-results', HTMLUListElement);
    this.note = required(form, '#search-note', HTMLElement);
    /** @type {Municipality[]} */
    this.results = [];
    this.active = -1;

    this.input.addEventListener('input', () => this.update());
    this.input.addEventListener('focus', () => {
      if (this.input.value.trim()) this.update();
    });
    this.input.addEventListener('keydown', (event) => this.onKey(event));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.results.length) this.choose(this.active >= 0 ? this.active : 0);
    });
    this.clear.addEventListener('click', () => {
      this.input.value = '';
      this.update();
      this.input.focus();
    });
    // keep focus in the input until the choice is made
    this.list.addEventListener('mousedown', (event) => event.preventDefault());
    this.list.addEventListener('click', (event) => {
      const item = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('[data-index]'));
      if (item) this.choose(Number(item.dataset.index));
    });
  }

  get isOpen() {
    return !this.box.hidden;
  }

  update() {
    const query = this.input.value;
    this.clear.hidden = query === '';
    if (!query.trim()) {
      // An emptied box offers nothing: Enter must not open the previous query's first result.
      this.results = [];
      this.close();
      return;
    }
    const { results, total } = this.deps.gazetteer.search(query);
    this.results = results;
    this.active = -1;
    this.list.replaceChildren(
      ...results.map((m, i) =>
        h(
          'li',
          { id: `search-result-${i}`, role: 'option', 'aria-selected': 'false', 'data-index': String(i) },
          h('span', { class: 'name' }, m.name),
          h('span', { class: 'district' }, t('search.district', { district: m.district })),
        ),
      ),
    );
    this.note.textContent =
      total === 0 ? t('search.none', { query: query.trim() }) : total > results.length ? t('search.more', { count: total - results.length }) : '';
    this.box.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
    this.input.removeAttribute('aria-activedescendant');
  }

  /** Re-renders after a language change. */
  refresh() {
    if (this.isOpen) this.update();
  }

  close() {
    this.box.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
    this.active = -1;
  }

  /** @param {KeyboardEvent} event */
  onKey(event) {
    if (event.key === 'Escape') {
      this.close();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (!this.isOpen || !this.results.length) return;
    event.preventDefault();
    const n = this.results.length;
    this.active = event.key === 'ArrowDown' ? (this.active + 1) % n : (this.active - 1 + n) % n;
    for (const li of this.list.children) li.setAttribute('aria-selected', 'false');
    const li = this.list.children[this.active];
    li.setAttribute('aria-selected', 'true');
    li.scrollIntoView({ block: 'nearest' });
    this.input.setAttribute('aria-activedescendant', li.id);
  }

  /** @param {number} i */
  choose(i) {
    const m = this.results[i];
    if (!m) return;
    this.input.value = m.name;
    this.close();
    this.input.blur();
    this.deps.onSelect(m);
  }
}
