// The "Propose" forms for the common findings: a baptism or birth, a
// marriage, a death or burial, a new Name, and a correction. Every form ends
// with the Citation (the register entry, a document or a Family account) and
// its photos. The form lives in a Draft, so it can be written offline.

import { ApiError, getPerson, messageOf } from './api.js';
import { guarded, h, showError } from './dom.js';
import { draftPhotos, deletePhoto, savePhoto, newKey } from './drafts.js';
import { t } from './i18n.js';
import { personPicker, placePicker, sourcePicker } from './pickers.js';
import { documentFields } from './document-fields.js';
import { notesFields } from './notes-form.js';
import { CONFIDENCES, formProblems, KINDS, NAME_LANGUAGES, NAME_TYPES, nameKind, NEW_SOURCE_TYPES } from './proposal-build.js';

/** @typedef {import('./drafts.js').Draft} Draft */
/** @typedef {import('./proposal-build.js').PersonInput} PersonInput */
/** @typedef {import('./proposal-build.js').EventFields} EventFields */
/** @typedef {import('./proposal-build.js').CorrectionForm} CorrectionForm */
/** @typedef {import('./proposal-build.js').CorrectionTarget} CorrectionTarget */
/** @typedef {import('./types.js').PersonDetail} PersonDetail */

/** The kind chooser at the top of "Propose". */
export function kindChooser() {
  return h(
    'div',
    { class: 'kind-grid' },
    ...KINDS.map((kind) =>
      h(
        'a',
        { class: 'kind-card', href: `#work/propose/${kind}`, 'data-testid': `kind-${kind}` },
        h('strong', {}, t(`propose.kind.${kind}`)),
        h('span', { class: 'muted small' }, t(`propose.kindHint.${kind}`)),
      ),
    ),
  );
}

/**
 * @param {string} labelText
 * @param {HTMLElement} control
 */
const field = (labelText, control) => h('label', { class: 'field' }, h('span', {}, labelText), control);

/**
 * A text input bound to `obj[key]`.
 * @template {string} K
 * @param {{ [P in K]?: string }} obj
 * @param {K} key
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
 * A choice bound to `obj[key]`.
 * @template {string} K
 * @template {string} V
 * @param {{ [P in K]?: V }} obj
 * @param {K} key
 * @param {readonly V[]} values
 * @param {(v: V) => string} label
 * @param {Record<string, string>} [attrs]
 */
function select(obj, key, values, label, attrs = {}) {
  const el = h('select', attrs, ...values.map((v) => h('option', { value: v, selected: obj[key] === v }, label(v))));
  el.addEventListener('change', () => {
    const value = values.find((v) => v === el.value);
    if (value !== undefined) obj[key] = value;
  });
  return el;
}

/**
 * A list of Persons that can grow (godparents, witnesses).
 * @param {(PersonInput | null)[]} list
 * @param {string} labelKey
 * @param {string} testid
 */
function personList(list, labelKey, testid) {
  const box = h('div', { class: 'person-list' });
  const render = () => {
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

/** @param {EventFields} form */
function eventFields(form) {
  return [
    field(t('propose.date'), textInput(form, 'date', { placeholder: t('propose.datePlaceholder'), inputmode: 'numeric', 'data-testid': 'date' })),
    h('p', { class: 'muted small' }, t('propose.dateHelp')),
    placePicker({ value: form.place, testid: 'place', onChange: (v) => (form.place = v) }),
  ];
}

/**
 * The Names and Events of a Person that a correction can change.
 * @param {PersonDetail} person
 * @returns {CorrectionTarget[]}
 */
function correctionTargets(person) {
  return [
    ...person.names.map((n) => ({
      record: /** @type {const} */ ('name'),
      id: n.id,
      version: n.version,
      label: `${t('propose.correctName')}: ${n.asFound}`,
      current: { given: n.given, surname: n.surname, asFound: n.asFound },
    })),
    ...person.events.map(({ event: e }) => ({
      record: /** @type {const} */ ('event'),
      id: e.id,
      version: e.version,
      label: `${t(`eventType.${e.type}`)} ${e.date ?? ''}`.trim(),
      current: { date: e.date ?? '', description: e.description ?? '' },
    })),
  ];
}

/**
 * The correction form: pick a Person, then one of their Names or Events, then change its fields.
 * @param {CorrectionForm} form
 */
function correctionFields(form) {
  const targets = h('div', { class: 'targets', 'data-testid': 'targets' });
  /** @param {CorrectionTarget[]} options */
  const showTargets = (options) => {
    const editor = h('div', { class: 'correction-fields' });
    /** @param {CorrectionTarget} o */
    const pick = (o) => {
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
        const input = editor.querySelector(`[data-testid="fix-${key}"]`);
        if (input instanceof HTMLInputElement) input.value = value;
      }
    }
  };
  // Only the answer for the Person picked last is shown: the Member may change the Person while one loads.
  let loads = 0;
  const load = async () => {
    const mine = ++loads;
    if (form.person?.mode !== 'existing') {
      targets.replaceChildren();
      return;
    }
    let person;
    try {
      person = await getPerson(form.person.id);
    } catch (error) {
      if (mine === loads)
        targets.replaceChildren(h('p', { class: 'muted' }, error instanceof ApiError && error.offline ? t('picker.offline') : messageOf(error)));
      return;
    }
    if (mine === loads) showTargets(correctionTargets(person));
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
 * The photos of a Draft, with a button to add more.
 * @param {Draft} draft
 * @param {() => Promise<void>} ensureSaved stores the Draft before its first photo
 * @param {(error: unknown) => void} report shows a failure
 */
function photoFields(draft, ensureSaved, report) {
  const photos = h('div', { class: 'photos', 'data-testid': 'photos' });
  const renderPhotos = async () => {
    const list = (await draftPhotos(draft.id)).filter((p) => p.kind !== 'document');
    photos.replaceChildren(
      ...list.map((p) => {
        const remove = h('button', { type: 'button', class: 'icon-button small', 'aria-label': t('photos.remove') }, '×');
        remove.addEventListener(
          'click',
          guarded(report, async () => {
            await deletePhoto(p.id);
            await renderPhotos();
          }),
        );
        const url = URL.createObjectURL(p.blob);
        const img = h('img', { src: url, alt: p.name });
        // The thumbnail keeps its pixels; the blob URL would hold the photo in memory until the page closes.
        img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
        img.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
        return h('figure', { class: 'thumb' }, img, remove);
      }),
    );
  };
  const file = h('input', {
    type: 'file',
    accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif',
    capture: 'environment',
    multiple: true,
    'data-testid': 'photo-input',
    class: 'visually-hidden',
    id: 'photo-input',
  });
  file.addEventListener(
    'change',
    guarded(report, async () => {
      await ensureSaved();
      for (const f of file.files ?? []) await savePhoto({ id: newKey(), draftId: draft.id, blob: f, name: f.name, uploadId: null });
      file.value = '';
      await renderPhotos();
    }),
  );
  renderPhotos().catch(report);
  return [h('div', { class: 'photo-row' }, h('label', { class: 'button', for: 'photo-input' }, t('photos.add')), file), photos];
}

/**
 * The Citation: which Source, the page, the transcription, the confidence and the photos.
 * @param {Draft} draft
 * @param {() => Promise<void>} ensureSaved stores the Draft before its first photo
 * @param {(error: unknown) => void} report shows a failure
 */
function citationFields(draft, ensureSaved, report) {
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
        field(
          t('citation.sourceType'),
          select(c, 'sourceType', NEW_SOURCE_TYPES, (v) => t(`sourceType.${v}`), { 'data-testid': 'source-type' }),
        ),
        field(t('citation.title'), textInput(c, 'title', { placeholder: t('citation.titlePlaceholder'), 'data-testid': 'source-title' })),
        field(t('citation.repository'), textInput(c, 'repository', { 'data-testid': 'repository' })),
        field(t('citation.reference'), textInput(c, 'reference', { 'data-testid': 'reference' })),
        field(t('citation.page'), textInput(c, 'page', { 'data-testid': 'page' })),
      );
    }
  };
  const modes = h(
    'div',
    { class: 'segmented', role: 'radiogroup' },
    .../** @type {const} */ (['new', 'existing', 'account']).map((mode) => {
      const radio = h('input', { type: 'radio', name: 'source-mode', value: mode, checked: c.sourceMode === mode, 'data-testid': `source-mode-${mode}` });
      radio.addEventListener('change', () => {
        c.sourceMode = mode;
        renderSource();
      });
      return h('label', {}, radio, h('span', {}, t(`citation.mode.${mode}`)));
    }),
  );
  renderSource();

  const transcription = h('textarea', { rows: '4', 'data-testid': 'transcription' });
  transcription.value = c.transcription ?? '';
  transcription.addEventListener('input', () => {
    c.transcription = transcription.value;
  });

  return h(
    'section',
    { class: 'form-section' },
    h('h3', {}, t('citation.title.section')),
    h('p', { class: 'muted small' }, t('citation.why')),
    modes,
    box,
    field(t('citation.transcription'), transcription),
    field(
      t('citation.confidence'),
      select(c, 'confidence', CONFIDENCES, (v) => t(`confidence.${v}`), { 'data-testid': 'confidence' }),
    ),
    field(t('citation.readOn'), textInput(c, 'readOn', { type: 'date', 'data-testid': 'read-on' })),
    ...photoFields(draft, ensureSaved, report),
    ...documentFields(draft, ensureSaved, report),
  );
}

/**
 * The fields of what was found, by kind.
 * @param {Draft} draft
 * @returns {HTMLElement[]}
 */
function findingFields(draft) {
  switch (draft.kind) {
    case 'baptism': {
      const form = draft.form;
      return [
        field(
          t('propose.eventType'),
          select(form, 'eventType', /** @type {const} */ (['baptism', 'birth']), (v) => t(`eventType.${v}`), { 'data-testid': 'event-type' }),
        ),
        ...eventFields(form),
        personPicker({ value: form.child, label: t('role.child'), testid: 'child', onChange: (v) => (form.child = v) }),
        personPicker({ value: form.father, label: t('role.father'), testid: 'father', onChange: (v) => (form.father = v) }),
        personPicker({ value: form.mother, label: t('role.mother'), testid: 'mother', onChange: (v) => (form.mother = v) }),
        personList(form.godparents, 'role.godparent', 'godparent'),
      ];
    }
    case 'marriage': {
      const form = draft.form;
      return [
        ...eventFields(form),
        personPicker({ value: form.partner1, label: `${t('role.partner')} 1`, testid: 'partner1', onChange: (v) => (form.partner1 = v) }),
        personPicker({ value: form.partner2, label: `${t('role.partner')} 2`, testid: 'partner2', onChange: (v) => (form.partner2 = v) }),
        personList(form.witnesses, 'role.witness', 'witness'),
      ];
    }
    case 'death': {
      const form = draft.form;
      return [
        field(
          t('propose.eventType'),
          select(form, 'eventType', /** @type {const} */ (['death', 'burial']), (v) => t(`eventType.${v}`), { 'data-testid': 'event-type' }),
        ),
        ...eventFields(form),
        personPicker({ value: form.person, label: t('role.deceased'), testid: 'person', onChange: (v) => (form.person = v) }),
      ];
    }
    case 'name': {
      const form = draft.form;
      // A Draft from before the language tags: shown in the new form, stored so on the next save.
      Object.assign(form, nameKind(form));
      form.language = form.language ?? '';
      return [
        personPicker({ value: form.person, label: t('propose.whichPerson'), testid: 'person', allowNew: false, onChange: (v) => (form.person = v) }),
        field(t('picker.given'), textInput(form, 'given', { 'data-testid': 'name-given' })),
        field(t('picker.surname'), textInput(form, 'surname', { 'data-testid': 'name-surname' })),
        field(t('field.asFound'), textInput(form, 'asFound', { 'data-testid': 'name-as-found' })),
        field(
          t('field.type'),
          select(form, 'type', NAME_TYPES, (v) => t(`nameType.${v}`), { 'data-testid': 'name-type' }),
        ),
        field(
          t('field.language'),
          select(form, 'language', NAME_LANGUAGES, (v) => t(`language.${v || 'none'}`), { 'data-testid': 'name-language' }),
        ),
      ];
    }
    case 'correction':
      return correctionFields(draft.form);
    case 'notes':
      return notesFields(draft.form);
  }
}

/** Typing is stored this long after the Member stops, and at once when the form is left. */
const AUTOSAVE_MS = 500;

/**
 * Renders the form of a Draft. The Draft is stored as the Member types (see
 * `flush`); a Draft with a pending submit is shown locked, for sending again only.
 * @param {Draft} draft
 * @param {{ save: () => Promise<void>, submit: () => Promise<void> }} actions
 * @returns {{ element: HTMLFormElement, flush: () => void }} flush stores unsaved typing now
 */
export function proposeForm(draft, actions) {
  const form = draft.form;
  const note = h('textarea', { rows: '2', 'data-testid': 'note', placeholder: t('propose.notePlaceholder') });
  note.value = form.note ?? '';
  note.addEventListener('input', () => {
    form.note = note.value;
  });

  const status = h('p', { class: 'form-status', role: 'status', 'data-testid': 'form-status' });
  const report = showError(status);
  const notice = h('p', { class: 'warning small', 'data-testid': 'pending-notice', hidden: true }, t('drafts.pending'));
  const saveButton = h('button', { type: 'button', class: 'button', 'data-testid': 'save-draft' }, t('propose.saveDraft'));
  const submitButton = h('button', { type: 'button', class: 'button primary', 'data-testid': 'submit' }, t('propose.submit'));
  const element = h(
    'form',
    { class: 'propose-form', 'data-kind': draft.kind, 'data-testid': 'propose-form', novalidate: true },
    h('h2', {}, t(`propose.kind.${draft.kind}`)),
    draft.lead ? h('p', { class: 'note small', 'data-testid': 'answers-lead' }, t('propose.answersLead', { question: draft.lead.question })) : null,
    notice,
    h('section', { class: 'form-section' }, ...findingFields(draft)),
    // Notes and Labels state no fact, so they need no Citation (tree-model spec, "Research notes on records").
    draft.kind === 'notes' ? null : citationFields(draft, actions.save, report),
    h('section', { class: 'form-section' }, field(t('propose.note'), note)),
    status,
    h('div', { class: 'form-actions' }, saveButton, submitButton),
  );

  let snapshot = JSON.stringify(form);
  let done = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const flush = () => {
    clearTimeout(timer);
    if (done || draft.pending || JSON.stringify(form) === snapshot) return;
    snapshot = JSON.stringify(form);
    actions.save().catch(report);
  };
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(flush, AUTOSAVE_MS);
  };
  for (const type of ['input', 'change', 'click']) element.addEventListener(type, soon);

  const lock = () => {
    notice.hidden = false;
    for (const control of element.querySelectorAll('input, select, textarea, button')) {
      if (control !== submitButton && 'disabled' in control) control.disabled = true;
    }
  };
  if (draft.pending) lock();

  saveButton.addEventListener(
    'click',
    guarded(report, async () => {
      clearTimeout(timer);
      snapshot = JSON.stringify(form);
      await actions.save();
      status.classList.remove('error');
      status.textContent = t('propose.saved');
    }),
  );
  const submit = async () => {
    const problems = formProblems(draft);
    if (problems.length) {
      status.textContent = problems.map((p) => t(p)).join(' ');
      status.classList.add('error');
      return;
    }
    status.classList.remove('error');
    submitButton.disabled = true;
    clearTimeout(timer);
    snapshot = JSON.stringify(form);
    try {
      await actions.submit();
      done = true;
    } catch (error) {
      report(error);
      if (draft.pending) lock();
    } finally {
      submitButton.disabled = false;
    }
  };
  submitButton.addEventListener('click', () => void submit());
  return { element, flush };
}
