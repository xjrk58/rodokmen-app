// The "Propose" forms for the common findings: a baptism or birth, a
// marriage, a death or burial, a new Name, and a correction. Every form ends
// with the Citation (the register entry, a document or a Family account) and
// its photos. The form lives in a Draft, so it can be written offline.

import { api } from './api.js';
import { h } from './dom.js';
import { draftPhotos, deletePhoto, savePhoto, newKey } from './drafts.js';
import { t } from './i18n.js';
import { personPicker, placePicker, sourcePicker } from './pickers.js';
import { formProblems, KINDS } from './proposal-build.js';

/** @typedef {import('./drafts.js').Draft} Draft */
/** @typedef {import('./proposal-build.js').ProposeKind} ProposeKind */

/** @param {ProposeKind} kind */
export function emptyForm(kind) {
  const citation = { sourceMode: 'new', sourceType: 'parish_register', title: '', repository: '', reference: '', page: '', transcription: '', confidence: 'normal', readOn: new Date().toISOString().slice(0, 10) };
  /** @type {Record<ProposeKind, Record<string, any>>} */
  const forms = {
    baptism: { eventType: 'baptism', date: '', place: null, child: { mode: 'new', given: '', surname: '', sex: 'unknown' }, father: null, mother: null, godparents: [] },
    marriage: { date: '', place: null, partner1: null, partner2: null, witnesses: [] },
    death: { eventType: 'death', date: '', place: null, person: null },
    name: { person: null, given: '', surname: '', type: 'latin', asFound: '' },
    correction: { person: null, target: null, set: {} },
  };
  return { ...forms[kind], citation, note: '' };
}

/** The kind chooser at the top of "Propose". */
export function kindChooser() {
  return h('div', { class: 'kind-grid' },
    ...KINDS.map((kind) => h('a', { class: 'kind-card', href: `#work/propose/${kind}`, 'data-testid': `kind-${kind}` },
      h('strong', {}, t(`propose.kind.${kind}`)), h('span', { class: 'muted small' }, t(`propose.kindHint.${kind}`)))));
}

/**
 * @param {string} labelText
 * @param {HTMLElement} control
 */
const field = (labelText, control) => h('label', { class: 'field' }, h('span', {}, labelText), control);

/**
 * A text input bound to `obj[key]`.
 * @param {Record<string, any>} obj
 * @param {string} key
 * @param {Record<string, string>} [attrs]
 */
function textInput(obj, key, attrs = {}) {
  const input = h('input', { type: 'text', value: obj[key] ?? '', ...attrs });
  input.addEventListener('input', () => {
    obj[key] = input.value;
  });
  return input;
}

/**
 * @param {Record<string, any>} obj
 * @param {string} key
 * @param {string[]} values
 * @param {(v: string) => string} label
 * @param {Record<string, string>} [attrs]
 */
function select(obj, key, values, label, attrs = {}) {
  const el = h('select', attrs, ...values.map((v) => h('option', { value: v, selected: obj[key] === v }, label(v))));
  el.addEventListener('change', () => {
    obj[key] = el.value;
  });
  return el;
}

/**
 * A list of Persons that can grow (godparents, witnesses).
 * @param {Record<string, any>} form
 * @param {string} key
 * @param {string} labelKey
 * @param {string} testid
 */
function personList(form, key, labelKey, testid) {
  const box = h('div', { class: 'person-list' });
  const render = () => {
    /** @type {any[]} */
    const list = form[key];
    const add = h('button', { type: 'button', class: 'button', 'data-testid': `${testid}-add` }, t(`${labelKey}.add`));
    add.addEventListener('click', () => {
      list.push(null);
      render();
    });
    box.replaceChildren(
      ...list.map((value, i) => personPicker({ value, label: `${t(labelKey)} ${i + 1}`, testid: `${testid}-${i}`, onChange: (v) => (list[i] = v) })),
      add,
    );
  };
  render();
  return box;
}

/**
 * @param {Record<string, any>} form
 */
function eventFields(form) {
  return [
    field(t('propose.date'), textInput(form, 'date', { placeholder: t('propose.datePlaceholder'), inputmode: 'numeric', 'data-testid': 'date' })),
    h('p', { class: 'muted small' }, t('propose.dateHelp')),
    placePicker({ value: form.place, testid: 'place', onChange: (v) => (form.place = v) }),
  ];
}

/**
 * The correction form: pick a Person, then one of their Names or Events, then change its fields.
 * @param {Record<string, any>} form
 */
function correctionFields(form) {
  const targets = h('div', { class: 'targets', 'data-testid': 'targets' });
  const load = async () => {
    if (form.person?.mode !== 'existing') {
      targets.replaceChildren();
      return;
    }
    let person;
    try {
      person = await api(`persons/${form.person.id}`);
    } catch {
      targets.replaceChildren(h('p', { class: 'muted' }, t('picker.offline')));
      return;
    }
    /** @type {Array<{ record: 'name' | 'event', id: string, version: number, label: string, current: Record<string, string> }>} */
    const options = [
      ...person.names.map((/** @type {any} */ n) => ({ record: 'name', id: n.id, version: n.version, label: `${t('propose.correctName')}: ${n.asFound}`, current: { given: n.given, surname: n.surname, asFound: n.asFound } })),
      ...person.events.map((/** @type {any} */ e) => ({ record: 'event', id: e.event.id, version: e.event.version, label: `${t(`eventType.${e.event.type}`)} ${e.event.date ?? ''}`.trim(), current: { date: e.event.date ?? '', description: e.event.description ?? '' } })),
    ];
    const editor = h('div', { class: 'correction-fields' });
    const pick = (/** @type {typeof options[number]} */ o) => {
      form.target = { record: o.record, id: o.id, version: o.version, label: o.label, current: o.current };
      form.set = {};
      editor.replaceChildren(
        ...Object.entries(o.current).map(([key, value]) => {
          const input = h('input', { type: 'text', value, 'data-testid': `fix-${key}` });
          input.addEventListener('input', () => {
            if (input.value === value) delete form.set[key];
            else form.set[key] = input.value;
          });
          return field(t(`field.${key}`), input);
        }),
      );
    };
    targets.replaceChildren(
      h('p', { class: 'muted small' }, t('propose.correctWhich')),
      ...options.map((o) => {
        const radio = h('input', { type: 'radio', name: 'target', checked: form.target?.id === o.id });
        radio.addEventListener('change', () => pick(o));
        return h('label', { class: 'radio-row' }, radio, h('span', {}, o.label));
      }),
      editor,
    );
    const chosen = options.find((o) => o.id === form.target?.id);
    if (chosen) {
      const kept = form.set;
      pick(chosen);
      form.set = kept;
      for (const [key, value] of Object.entries(kept)) {
        const input = /** @type {HTMLInputElement | null} */ (editor.querySelector(`[data-testid="fix-${key}"]`));
        if (input) input.value = String(value);
      }
    }
  };
  const picker = personPicker({
    value: form.person,
    label: t('propose.whichPerson'),
    testid: 'person',
    allowNew: false,
    onChange: (v) => {
      form.person = v;
      form.target = null;
      form.set = {};
      void load();
    },
  });
  void load();
  return [picker, targets];
}

/**
 * The Citation: which Source, the page, the transcription, the confidence and the photos.
 * @param {Draft} draft
 * @param {() => Promise<void>} ensureSaved stores the Draft before its first photo
 */
function citationFields(draft, ensureSaved) {
  const c = draft.form.citation;
  const box = h('div', { class: 'citation-source' });
  const renderSource = () => {
    if (c.sourceMode === 'existing') {
      box.replaceChildren(sourcePicker({ value: c.source ?? null, testid: 'source', onChange: (v) => (c.source = v) }));
    } else if (c.sourceMode === 'account') {
      box.replaceChildren(
        field(t('citation.givenBy'), textInput(c, 'givenBy', { 'data-testid': 'given-by' })),
        field(t('citation.givenOn'), textInput(c, 'givenOn', { placeholder: '2026-05', 'data-testid': 'given-on' })),
        field(t('citation.accountTitle'), textInput(c, 'title', { 'data-testid': 'source-title' })),
      );
    } else {
      box.replaceChildren(
        field(t('citation.sourceType'), select(c, 'sourceType', ['parish_register', 'census', 'land_book', 'other'], (v) => t(`sourceType.${v}`), { 'data-testid': 'source-type' })),
        field(t('citation.title'), textInput(c, 'title', { placeholder: t('citation.titlePlaceholder'), 'data-testid': 'source-title' })),
        field(t('citation.repository'), textInput(c, 'repository', { 'data-testid': 'repository' })),
        field(t('citation.reference'), textInput(c, 'reference', { 'data-testid': 'reference' })),
        field(t('citation.page'), textInput(c, 'page', { 'data-testid': 'page' })),
      );
    }
  };
  const modes = h('div', { class: 'segmented', role: 'radiogroup' },
    ...['new', 'existing', 'account'].map((mode) => {
      const radio = h('input', { type: 'radio', name: 'source-mode', value: mode, checked: c.sourceMode === mode, 'data-testid': `source-mode-${mode}` });
      radio.addEventListener('change', () => {
        c.sourceMode = mode;
        renderSource();
      });
      return h('label', {}, radio, h('span', {}, t(`citation.mode.${mode}`)));
    }));
  renderSource();

  const transcription = h('textarea', { rows: '4', 'data-testid': 'transcription' });
  transcription.value = c.transcription ?? '';
  transcription.addEventListener('input', () => {
    c.transcription = transcription.value;
  });

  const photos = h('div', { class: 'photos', 'data-testid': 'photos' });
  const renderPhotos = async () => {
    const list = await draftPhotos(draft.id);
    photos.replaceChildren(
      ...list.map((p) => {
        const remove = h('button', { type: 'button', class: 'icon-button small', 'aria-label': t('photos.remove') }, '×');
        remove.addEventListener('click', async () => {
          await deletePhoto(p.id);
          void renderPhotos();
        });
        return h('figure', { class: 'thumb' }, h('img', { src: URL.createObjectURL(p.blob), alt: p.name }), remove);
      }),
    );
  };
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif', capture: 'environment', multiple: true, 'data-testid': 'photo-input', class: 'visually-hidden', id: 'photo-input' });
  file.addEventListener('change', async () => {
    await ensureSaved();
    for (const f of file.files ?? []) await savePhoto({ id: newKey(), draftId: draft.id, blob: f, name: f.name, uploadId: null });
    file.value = '';
    void renderPhotos();
  });
  void renderPhotos();

  return h('section', { class: 'form-section' },
    h('h3', {}, t('citation.title.section')),
    h('p', { class: 'muted small' }, t('citation.why')),
    modes,
    box,
    field(t('citation.transcription'), transcription),
    field(t('citation.confidence'), select(c, 'confidence', ['very_low', 'low', 'normal', 'high', 'very_high'], (v) => t(`confidence.${v}`), { 'data-testid': 'confidence' })),
    field(t('citation.readOn'), textInput(c, 'readOn', { type: 'date', 'data-testid': 'read-on' })),
    h('div', { class: 'photo-row' }, h('label', { class: 'button', for: 'photo-input' }, t('photos.add')), file),
    photos,
  );
}

/**
 * Renders the form of a Draft.
 * @param {Draft} draft
 * @param {{ save: () => Promise<void>, submit: () => Promise<void> }} actions
 */
export function proposeForm(draft, actions) {
  const kind = /** @type {ProposeKind} */ (draft.kind);
  const form = draft.form;
  /** @type {(HTMLElement | null)[]} */
  let what = [];
  if (kind === 'baptism') {
    what = [
      field(t('propose.eventType'), select(form, 'eventType', ['baptism', 'birth'], (v) => t(`eventType.${v}`), { 'data-testid': 'event-type' })),
      ...eventFields(form),
      personPicker({ value: form.child, label: t('role.child'), testid: 'child', onChange: (v) => (form.child = v) }),
      personPicker({ value: form.father, label: t('role.father'), testid: 'father', onChange: (v) => (form.father = v) }),
      personPicker({ value: form.mother, label: t('role.mother'), testid: 'mother', onChange: (v) => (form.mother = v) }),
      personList(form, 'godparents', 'role.godparent', 'godparent'),
    ];
  } else if (kind === 'marriage') {
    what = [
      ...eventFields(form),
      personPicker({ value: form.partner1, label: `${t('role.partner')} 1`, testid: 'partner1', onChange: (v) => (form.partner1 = v) }),
      personPicker({ value: form.partner2, label: `${t('role.partner')} 2`, testid: 'partner2', onChange: (v) => (form.partner2 = v) }),
      personList(form, 'witnesses', 'role.witness', 'witness'),
    ];
  } else if (kind === 'death') {
    what = [
      field(t('propose.eventType'), select(form, 'eventType', ['death', 'burial'], (v) => t(`eventType.${v}`), { 'data-testid': 'event-type' })),
      ...eventFields(form),
      personPicker({ value: form.person, label: t('role.deceased'), testid: 'person', onChange: (v) => (form.person = v) }),
    ];
  } else if (kind === 'name') {
    what = [
      personPicker({ value: form.person, label: t('propose.whichPerson'), testid: 'person', allowNew: false, onChange: (v) => (form.person = v) }),
      field(t('picker.given'), textInput(form, 'given', { 'data-testid': 'name-given' })),
      field(t('picker.surname'), textInput(form, 'surname', { 'data-testid': 'name-surname' })),
      field(t('field.asFound'), textInput(form, 'asFound', { 'data-testid': 'name-as-found' })),
      field(t('field.type'), select(form, 'type', ['latin', 'german', 'married', 'nickname', 'birth', 'other'], (v) => t(`nameType.${v}`), { 'data-testid': 'name-type' })),
    ];
  } else {
    what = correctionFields(form);
  }

  const note = h('textarea', { rows: '2', 'data-testid': 'note', placeholder: t('propose.notePlaceholder') });
  note.value = form.note ?? '';
  note.addEventListener('input', () => {
    form.note = note.value;
  });

  const status = h('p', { class: 'form-status', role: 'status', 'data-testid': 'form-status' });
  const saveButton = h('button', { type: 'button', class: 'button', 'data-testid': 'save-draft' }, t('propose.saveDraft'));
  const submitButton = h('button', { type: 'button', class: 'button primary', 'data-testid': 'submit' }, t('propose.submit'));
  saveButton.addEventListener('click', async () => {
    await actions.save();
    status.textContent = t('propose.saved');
  });
  submitButton.addEventListener('click', async () => {
    const problems = formProblems(kind, form);
    if (problems.length) {
      status.textContent = problems.map((p) => t(p)).join(' ');
      status.classList.add('error');
      return;
    }
    status.classList.remove('error');
    submitButton.disabled = true;
    try {
      await actions.submit();
    } catch (error) {
      status.textContent = /** @type {Error} */ (error).message;
      status.classList.add('error');
    } finally {
      submitButton.disabled = false;
    }
  });

  return h('form', { class: 'propose-form', 'data-kind': kind, 'data-testid': 'propose-form', novalidate: true },
    h('h2', {}, t(`propose.kind.${kind}`)),
    h('section', { class: 'form-section' }, ...what),
    citationFields(draft, actions.save),
    h('section', { class: 'form-section' }, field(t('propose.note'), note)),
    status,
    h('div', { class: 'form-actions' }, saveButton, submitButton),
  );
}
