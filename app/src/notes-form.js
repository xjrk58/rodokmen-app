// The "Notes and Labels" form (tree-model spec, "Research notes on records" and "Labels on
// Persons"): pick a Person, then change their research notes and Labels. No Citation: notes and
// Labels state no fact.

import { ApiError, getPerson, messageOf } from './api.js';
import { h } from './dom.js';
import { t } from './i18n.js';
import { personPicker } from './pickers.js';
import { foldLabel } from './proposal-build.js';

/** @typedef {import('./proposal-build.js').NotesForm} NotesForm */

/**
 * @param {string} labelText
 * @param {HTMLElement} control
 */
const field = (labelText, control) => h('label', { class: 'field' }, h('span', {}, labelText), control);

/**
 * The Labels of a notes form: each with a button to take it off, and a field to add one.
 * @param {NotesForm} form
 */
function labelEditor(form) {
  const box = h('div', { class: 'label-editor', 'data-testid': 'label-editor' });
  const render = () => {
    const input = h('input', { type: 'text', 'data-testid': 'label-input', placeholder: t('notes.labelPlaceholder'), 'aria-label': t('notes.addLabel') });
    const add = h('button', { type: 'button', class: 'button', 'data-testid': 'label-add' }, t('notes.addLabel'));
    const addLabel = () => {
      const label = input.value.trim();
      if (label && !form.labels.some((l) => foldLabel(l) === foldLabel(label))) form.labels.push(label);
      render();
    };
    add.addEventListener('click', addLabel);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addLabel();
      }
    });
    box.replaceChildren(
      h(
        'ul',
        { class: 'chips' },
        ...form.labels.map((label, i) => {
          const remove = h(
            'button',
            { type: 'button', class: 'icon-button small', 'aria-label': t('notes.removeLabel', { label }), 'data-testid': 'label-remove' },
            '×',
          );
          remove.addEventListener('click', () => {
            form.labels.splice(i, 1);
            render();
          });
          return h('li', { class: 'chip', 'data-testid': 'label-chip' }, h('span', {}, label), remove);
        }),
      ),
      h('div', { class: 'label-add-row' }, input, add),
    );
  };
  render();
  return box;
}

/**
 * Research notes and Labels of a Person: pick the Person, then change their notes and Labels.
 * The Person is loaded when picked, so that only what the Member changes is proposed.
 * @param {NotesForm} form
 */
export function notesFields(form) {
  const editor = h('div', { class: 'notes-fields', 'data-testid': 'notes-fields' });
  const show = () => {
    if (!form.base) {
      editor.replaceChildren();
      return;
    }
    const notes = h('textarea', { rows: '6', 'data-testid': 'notes-text', placeholder: t('notes.placeholder') });
    notes.value = form.notes;
    notes.addEventListener('input', () => (form.notes = notes.value));
    editor.replaceChildren(
      field(t('notes.notes'), notes),
      h('h3', {}, t('notes.labels')),
      h('p', { class: 'muted small' }, t('notes.labelsHelp')),
      labelEditor(form),
    );
  };
  let loads = 0;
  const load = async () => {
    const mine = ++loads;
    if (form.person?.mode !== 'existing') {
      form.base = null;
      return show();
    }
    if (form.base) return show();
    try {
      const person = await getPerson(form.person.id);
      if (mine !== loads) return;
      form.base = { version: person.version, notes: person.notes ?? '', labels: [...person.labels] };
      form.notes = person.notes ?? '';
      form.labels = [...person.labels];
      show();
    } catch (error) {
      if (mine === loads)
        editor.replaceChildren(h('p', { class: 'muted' }, error instanceof ApiError && error.offline ? t('picker.offline') : messageOf(error)));
    }
  };
  const picker = personPicker({
    value: form.person,
    label: t('propose.whichPerson'),
    testid: 'person',
    allowNew: false,
    onChange: (v) => {
      form.person = v;
      form.base = null;
      void load();
    },
  });
  void load();
  return [picker, editor];
}
