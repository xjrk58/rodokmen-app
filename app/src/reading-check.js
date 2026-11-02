// The check screen of a reading (scan-reading spec; add-scan-reading task 2.4): the scan beside
// the entries the server read, each with its transcription as the page shows it, its values
// marked "read by AI" until the Member changes or confirms them, what could not be read, and
// for each person the existing Persons they may be, linked with one tap, or a new Person.
// Nothing is submitted until the Member does; the Draft keeps every change on the device.

import { ApiError, getReading, messageOf, uploadUrl } from './api.js';
import { guarded, h, showError } from './dom.js';
import { draftPhotos } from './drafts.js';
import { language, t } from './i18n.js';
import { sourcePicker } from './pickers.js';
import { fillFromReading, isMarked, READING_CONFIDENCES, readingProblems } from './reading-draft.js';

/** @typedef {import('./drafts.js').Draft} Draft */
/** @typedef {import('./reading-draft.js').ReadingForm} ReadingForm */
/** @typedef {import('./reading-draft.js').EntryCheck} EntryCheck */
/** @typedef {import('./reading-draft.js').PersonCheck} PersonCheck */
/** @typedef {import('./reading-draft.js').Checked} Checked */

/** How often the screen asks whether the reading is done. */
export const POLL_MS = 2500;

/** The "read by AI" chip of a value still as the reader read it. */
const aiChip = () => h('span', { class: 'chip ai', 'data-testid': 'ai-mark', title: t('reading.aiMarkHelp') }, t('reading.aiMark'));

/**
 * A text input for a value the reader read, with its chip while it is still as read.
 * @param {Checked} checked
 * @param {() => boolean} confirmed
 * @param {string} testid
 * @param {() => void} changed
 */
function checkedInput(checked, confirmed, testid, changed) {
  const input = h('input', { type: 'text', value: checked.value, 'data-testid': testid });
  const chip = aiChip();
  const show = () => (chip.hidden = !isMarked(checked, confirmed()));
  input.addEventListener('input', () => {
    checked.value = input.value;
    show();
    changed();
  });
  show();
  return { input, chip, show };
}

/**
 * The match choices of one read person: the candidates, best first, and "New Person".
 * @param {PersonCheck} p
 * @param {() => void} changed
 */
function matchChoices(p, changed) {
  const box = h('div', { class: 'matches', 'data-testid': 'matches' });
  const render = () => {
    const chosen = p.choice;
    const options = p.candidates.map((c) => {
      const on = chosen?.mode === 'existing' && chosen.id === c.id;
      const b = h(
        'button',
        { type: 'button', class: `match${on ? ' chosen' : ''}`, 'aria-pressed': on ? 'true' : 'false', 'data-testid': 'match', 'data-id': c.id },
        h('strong', {}, c.label),
        h('span', { class: 'small muted' }, c.reasons.map((r) => t(`reading.reason.${r}`)).join(' · ')),
      );
      b.addEventListener('click', () => {
        p.choice = on ? null : { mode: 'existing', id: c.id, version: c.version, label: c.label };
        render();
        changed();
      });
      return b;
    });
    const isNew = chosen?.mode === 'new';
    const fresh = h(
      'button',
      { type: 'button', class: `match new${isNew ? ' chosen' : ''}`, 'aria-pressed': isNew ? 'true' : 'false', 'data-testid': 'match-new' },
      h('strong', {}, t('reading.newPerson')),
    );
    fresh.addEventListener('click', () => {
      p.choice = isNew ? null : { mode: 'new' };
      render();
      changed();
    });
    box.replaceChildren(
      ...(options.length ? options : [h('p', { class: 'small muted' }, t('reading.noCandidates'))]),
      fresh,
      ...(chosen === null ? [h('p', { class: 'small warning', 'data-testid': 'choose' }, t('reading.choose'))] : []),
    );
  };
  render();
  return box;
}

/**
 * @param {PersonCheck} p
 * @param {EntryCheck} e
 * @param {(() => void)[]} refresh
 * @param {() => void} changed
 */
function personRow(p, e, refresh, changed) {
  const confirmed = () => e.confirmed;
  const given = checkedInput(p.given, confirmed, 'person-given', changed);
  const surname = checkedInput(p.surname, confirmed, 'person-surname', changed);
  refresh.push(given.show, surname.show);
  const role = p.role === 'other' && p.roleDetail ? p.roleDetail : t(`role.${p.role}`);
  return h(
    'div',
    { class: 'read-person', 'data-testid': 'read-person', 'data-key': p.key, 'data-role': p.role },
    h(
      'div',
      { class: 'read-person-head' },
      h('strong', {}, role),
      h('span', { class: 'small muted', 'data-testid': 'as-written' }, `${p.asWritten} (${p.language})`),
    ),
    p.description ? h('p', { class: 'small muted' }, p.description) : null,
    h(
      'div',
      { class: 'name-row' },
      h('label', { class: 'field' }, h('span', {}, t('picker.given'), ' ', given.chip), given.input),
      h('label', { class: 'field' }, h('span', {}, t('picker.surname'), ' ', surname.chip), surname.input),
    ),
    matchChoices(p, changed),
  );
}

/**
 * One entry as read: its date, house, what could not be read, the transcription and its persons.
 * @param {EntryCheck} e
 * @param {number} index
 * @param {() => void} changed
 */
function entryCard(e, index, changed) {
  /** @type {(() => void)[]} */
  const refresh = [];
  const confirmed = () => e.confirmed;
  const date = checkedInput(e.date, confirmed, 'entry-date', changed);
  const house = checkedInput(e.house, confirmed, 'entry-house', changed);
  refresh.push(date.show, house.show);
  const persons = e.persons.map((p) => personRow(p, e, refresh, changed));
  const confirm = h('button', { type: 'button', class: 'button', 'data-testid': 'confirm-entry' });
  const skip = h('input', { type: 'checkbox', checked: e.skip, 'data-testid': 'skip-entry' });
  const card = h(
    'article',
    { class: 'card entry', 'data-testid': 'entry', 'data-index': String(index) },
    h(
      'header',
      { class: 'card-head' },
      h('strong', {}, `${index + 1}. ${t(`eventType.${e.type}`)}`),
      e.typeDetail ? h('span', { class: 'small' }, e.typeDetail) : null,
    ),
    ...e.illegible.map((x) =>
      h(
        'p',
        { class: 'warning small', 'data-testid': 'illegible' },
        t('reading.illegible', { field: t(`reading.field.${x.field.split('.').pop()}`), note: x.note }),
      ),
    ),
    h('blockquote', { class: 'transcription', 'data-testid': 'entry-transcription' }, e.transcription),
    h(
      'div',
      { class: 'name-row' },
      h('label', { class: 'field' }, h('span', {}, t('propose.date'), ' ', date.chip), date.input),
      h('label', { class: 'field' }, h('span', {}, t('reading.house'), ' ', house.chip), house.input),
    ),
    ...persons,
    h('label', { class: 'radio-row small' }, skip, h('span', {}, t('reading.skip'))),
    h('div', { class: 'form-actions' }, confirm),
  );
  const show = () => {
    confirm.textContent = e.confirmed ? t('reading.confirmed') : t('reading.confirm');
    confirm.classList.toggle('primary', !e.confirmed);
    card.classList.toggle('confirmed', e.confirmed);
    card.classList.toggle('skipped', e.skip);
    for (const r of refresh) r();
  };
  confirm.addEventListener('click', () => {
    e.confirmed = !e.confirmed;
    show();
    changed();
  });
  skip.addEventListener('change', () => {
    e.skip = skip.checked;
    show();
    changed();
  });
  show();
  return card;
}

/**
 * The scans beside the entries, with each page's transcription.
 * @param {Draft & { kind: 'reading' }} draft
 */
function scanPane(draft) {
  const pane = h('aside', { class: 'scan-pane', 'data-testid': 'scan-pane' });
  void draftPhotos(draft.id).then((photos) =>
    pane.replaceChildren(
      ...photos.map((photo, i) => {
        const src = photo.uploadId ? uploadUrl(photo.uploadId) : URL.createObjectURL(photo.blob);
        const text = draft.form.pages.find((p) => p.page === i)?.transcription ?? '';
        return h(
          'figure',
          { class: 'scan-page' },
          h(
            'a',
            { href: photo.uploadId ? `${src}?full=true` : src, target: '_blank', rel: 'noopener' },
            h('img', { src, alt: t('reading.scanAlt', { n: i + 1 }), 'data-testid': 'scan-image' }),
          ),
          text
            ? h(
                'details',
                {},
                h('summary', { class: 'small' }, t('reading.pageTranscription')),
                h('pre', { class: 'transcription', 'data-testid': 'page-transcription' }, text),
              )
            : null,
        );
      }),
    ),
  );
  return pane;
}

/**
 * Suggested Research leads, each to dismiss; accepting them as leads comes with add-research-leads (#16).
 * @param {ReadingForm} form
 * @param {() => void} changed
 */
function leadsSection(form, changed) {
  const section = h('section', { class: 'form-section', 'data-testid': 'leads' });
  const render = () => {
    const shown = form.leads.filter((l) => !form.dismissed.includes(l.key));
    const lang = language();
    section.replaceChildren(
      h('h3', {}, t('reading.leads')),
      h('p', { class: 'small muted' }, t('reading.leadsHelp')),
      ...shown.map((l) => {
        const dismiss = h('button', { type: 'button', class: 'link-button', 'data-testid': 'lead-dismiss' }, t('reading.dismiss'));
        dismiss.addEventListener('click', () => {
          form.dismissed.push(l.key);
          render();
          changed();
        });
        return h(
          'div',
          { class: 'lead', 'data-testid': 'lead', 'data-kind': l.kind },
          h('strong', {}, l.question[lang]),
          h('p', { class: 'small muted' }, l.reason[lang], l.sourceTitle ? ` ${t('reading.leadSource', { source: l.sourceTitle })}` : ''),
          dismiss,
        );
      }),
    );
  };
  render();
  return section;
}

/**
 * The Citation of the reading's pages: the register, the page and a confidence of at most normal.
 * @param {ReadingForm} form
 */
function citationSection(form) {
  const c = form.citation;
  const title = h('input', { type: 'text', value: c.title ?? '', 'data-testid': 'source-title' });
  title.addEventListener('input', () => (c.title = title.value));
  const page = h('input', { type: 'text', value: c.page ?? '', 'data-testid': 'page' });
  page.addEventListener('input', () => (c.page = page.value));
  const confidence = h(
    'select',
    { 'data-testid': 'confidence' },
    ...READING_CONFIDENCES.map((v) => h('option', { value: v, selected: (c.confidence ?? 'normal') === v }, t(`confidence.${v}`))),
  );
  confidence.addEventListener('change', () => (c.confidence = READING_CONFIDENCES.find((v) => v === confidence.value) ?? 'normal'));
  return h(
    'section',
    { class: 'form-section' },
    h('h3', {}, t('citation.title.section')),
    h('p', { class: 'muted small' }, t('reading.citationHelp')),
    sourcePicker({
      value: c.source ?? null,
      testid: 'source',
      onChange: (v) => {
        c.source = v;
        c.sourceMode = v ? 'existing' : 'new';
      },
    }),
    h('label', { class: 'field' }, h('span', {}, t('reading.orTitle')), title),
    h('label', { class: 'field' }, h('span', {}, t('citation.page')), page),
    h('label', { class: 'field' }, h('span', {}, t('citation.confidence')), confidence),
  );
}

/**
 * Waits for the server's reading of a new Draft, then fills it in; a failure is shown with the way back to the forms.
 * @param {Draft & { kind: 'reading' }} draft
 * @param {{ save: () => Promise<void>, rerender: () => void }} actions
 * @param {HTMLElement} status
 * @param {AbortSignal} signal
 */
async function waitForReading(draft, actions, status, signal) {
  while (!signal.aborted && draft.form.state === 'reading') {
    try {
      fillFromReading(await getReading(draft.form.readingId, signal), draft.form);
    } catch (error) {
      if (signal.aborted) return;
      status.textContent = error instanceof ApiError && error.offline ? t('reading.waitingOffline') : messageOf(error);
    }
    if (draft.form.state !== 'reading') {
      await actions.save();
      actions.rerender();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/**
 * The check screen of a reading Draft.
 * @param {Draft & { kind: 'reading' }} draft
 * @param {{ save: () => Promise<void>, submit: () => Promise<void>, remove: () => Promise<void>, rerender: () => void }} actions
 * @param {AbortSignal} signal
 * @returns {{ element: HTMLElement, flush: () => void }}
 */
export function readingCheck(draft, actions, signal) {
  const form = draft.form;
  const status = h('p', { class: 'form-status', role: 'status', 'data-testid': 'form-status' });
  const report = showError(status);
  if (form.state !== 'done') {
    const remove = h('button', { type: 'button', class: 'button', 'data-testid': 'delete-draft' }, t('drafts.delete'));
    remove.addEventListener('click', guarded(report, actions.remove));
    const element = h(
      'section',
      { class: 'reading-wait', 'data-testid': 'reading-wait', 'data-state': form.state },
      h('h2', {}, t('reading.checkTitle')),
      form.state === 'failed'
        ? h('p', { class: 'form-status error', 'data-testid': 'reading-failed' }, t('reading.failed', { why: form.error ?? '' }))
        : h('p', { class: 'muted', 'data-testid': 'reading-running' }, t('reading.running')),
      status,
      h('div', { class: 'form-actions' }, h('a', { class: 'button', href: '#work/propose' }, t('reading.byHand')), remove),
    );
    if (form.state === 'reading') void waitForReading(draft, actions, status, signal);
    return { element, flush: () => undefined };
  }

  let dirty = false;
  const changed = () => (dirty = true);
  const note = h('textarea', { rows: '2', 'data-testid': 'note' });
  note.value = form.note ?? '';
  note.addEventListener('input', () => {
    form.note = note.value;
    changed();
  });
  const saveButton = h('button', { type: 'button', class: 'button', 'data-testid': 'save-draft' }, t('propose.saveDraft'));
  const submitButton = h('button', { type: 'button', class: 'button primary', 'data-testid': 'submit' }, t('propose.submit'));
  const element = h(
    'form',
    { class: 'propose-form reading-check', 'data-kind': 'reading', 'data-testid': 'reading-check', novalidate: true },
    h('h2', {}, t('reading.checkTitle')),
    h('p', { class: 'muted small' }, t('reading.checkIntro', { model: form.model ?? '?' })),
    h(
      'div',
      { class: 'reading-layout' },
      scanPane(draft),
      h(
        'div',
        { class: 'entries-pane' },
        ...form.entries.map((e, i) => entryCard(e, i, changed)),
        leadsSection(form, changed),
        citationSection(form),
        h('section', { class: 'form-section' }, h('label', { class: 'field' }, h('span', {}, t('propose.note')), note)),
        status,
        h('div', { class: 'form-actions' }, saveButton, submitButton),
      ),
    ),
  );
  const flush = () => {
    if (!dirty || draft.pending) return;
    dirty = false;
    actions.save().catch(report);
  };
  element.addEventListener('change', flush);
  element.addEventListener('click', () => setTimeout(flush, 0));
  saveButton.addEventListener(
    'click',
    guarded(report, async () => {
      dirty = false;
      await actions.save();
      status.classList.remove('error');
      status.textContent = t('propose.saved');
    }),
  );
  submitButton.addEventListener('click', () => {
    const problems = readingProblems(form);
    if (problems.length) {
      status.textContent = problems.map((p) => t(p)).join(' ');
      status.classList.add('error');
      return;
    }
    status.classList.remove('error');
    submitButton.disabled = true;
    actions
      .submit()
      .catch(report)
      .finally(() => (submitButton.disabled = false));
  });
  return { element, flush };
}
