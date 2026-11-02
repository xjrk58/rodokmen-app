// The merge tool below the review queue: an Editor merges two Persons into one, at any time.

import { mergePersons, messageOf } from './api.js';
import { h } from './dom.js';
import { t } from './i18n.js';
import { personPicker } from './pickers.js';

/** @typedef {import('./proposal-build.js').PersonInput} PersonInput */

/** Merge two Persons into one (Editors, at any time). @param {() => void} onDone */
export function mergeTool(onDone) {
  /** @type {PersonInput | null} */
  let keep = null;
  /** @type {PersonInput | null} */
  let gone = null;
  const status = h('p', { class: 'form-status', role: 'status' });
  const button = h('button', { type: 'button', class: 'button', 'data-testid': 'merge' }, t('merge.button'));
  const merge = async () => {
    if (keep?.mode !== 'existing' || gone?.mode !== 'existing' || keep.id === gone.id) {
      status.textContent = t('merge.pickTwo');
      return;
    }
    button.disabled = true;
    try {
      await mergePersons(keep.id, { mergeId: gone.id, keepBaseVersion: keep.version, mergeBaseVersion: gone.version, note: null });
      status.textContent = t('merge.done');
      onDone();
    } catch (error) {
      status.textContent = messageOf(error);
    } finally {
      button.disabled = false;
    }
  };
  button.addEventListener('click', () => void merge());
  return h(
    'details',
    { class: 'card merge-tool' },
    h('summary', {}, t('merge.title')),
    h('p', { class: 'muted small' }, t('merge.help')),
    personPicker({ value: null, label: t('merge.keep'), testid: 'merge-keep', allowNew: false, onChange: (v) => (keep = v) }),
    personPicker({ value: null, label: t('merge.gone'), testid: 'merge-gone', allowNew: false, onChange: (v) => (gone = v) }),
    status,
    button,
  );
}
