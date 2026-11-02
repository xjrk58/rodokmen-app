// "Read a scan" (scan-reading spec): the Member adds photos or saved images of register pages,
// marks the entry on a page if they like, says what they know, and asks the server to read
// them. The server sends the display copy, or the marked crop, to Anthropic's API; this app
// talks only to our own server (ADR 0011). A pasted archive viewer address is never fetched:
// the Member is asked for the image itself, and the address is kept as the Citation's link.
//
// The Draft is stored as soon as the reading is asked for, so closing the app loses nothing:
// the check screen (reading-check.js) waits for the reading and then shows it.

import { messageOf, requestReading, uploadImage } from './api.js';
import { guarded, h, showError } from './dom.js';
import { newDraft, newKey, saveDraft, savePhoto } from './drafts.js';
import { t } from './i18n.js';
import { placePicker, sourcePicker } from './pickers.js';
import { today } from './proposal-build.js';
import { newReadingForm } from './reading-draft.js';

/** @typedef {import('./types.js').ReadingStatusView} ReadingStatusView */
/** @typedef {import('./types.js').ReadingCrop} ReadingCrop */
/** @typedef {import('./drafts.js').Draft} Draft */
/** @typedef {{ left: number, top: number, width: number, height: number }} Box */
/** @typedef {{ file: File, crop: Box | null }} Scan */

/** Most scans in one reading (CreateReadingBody in shared/src/schemas/reading.ts). */
export const MAX_SCANS = 5;

/**
 * Whether text is a web address rather than an image: what the Member pastes from an archive viewer.
 * @param {string} text
 */
export const isLink = (text) => /^[a-z][a-z0-9+.-]*:\/\//i.test(text.trim()) || /^www\./i.test(text.trim());

/** @param {number} v */
const share = (v) => Math.min(1, Math.max(0, v));

/** @param {string} v */
const orNull = (v) => v.trim() || null;

/**
 * The years the Member gave: both ends, or one year.
 * @param {string} from
 * @param {string} to
 */
function yearsOf(from, to) {
  if (!from && !to) return null;
  const a = Number(from || to);
  const b = Number(to || from);
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

/**
 * Marks the part of a page to read by dragging over it; a tap without a drag clears the mark.
 * @param {Scan} scan
 */
function cropper(scan) {
  const url = URL.createObjectURL(scan.file);
  const img = h('img', { src: url, alt: scan.file.name, draggable: 'false' });
  const box = h('div', { class: 'crop-box', hidden: scan.crop === null, 'data-testid': 'crop-box' });
  const frame = h('div', { class: 'crop-frame', 'data-testid': 'crop-frame' }, img, box);
  const show = () => {
    box.hidden = scan.crop === null;
    if (!scan.crop) return;
    box.style.left = `${scan.crop.left * 100}%`;
    box.style.top = `${scan.crop.top * 100}%`;
    box.style.width = `${scan.crop.width * 100}%`;
    box.style.height = `${scan.crop.height * 100}%`;
  };
  /** @type {{ x: number, y: number } | null} */
  let start = null;
  /** @param {PointerEvent} e */
  const at = (e) => {
    const r = img.getBoundingClientRect();
    return { x: share((e.clientX - r.left) / r.width), y: share((e.clientY - r.top) / r.height) };
  };
  frame.addEventListener('pointerdown', (e) => {
    start = at(e);
    frame.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  frame.addEventListener('pointermove', (e) => {
    if (!start) return;
    const p = at(e);
    const crop = { left: Math.min(start.x, p.x), top: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) };
    scan.crop = crop.width > 0.02 && crop.height > 0.02 ? crop : null;
    show();
  });
  frame.addEventListener('pointerup', () => (start = null));
  img.addEventListener('load', show, { once: true });
  show();
  return frame;
}

/**
 * The scans of the reading, each with a way to mark the part to read.
 * @param {Scan[]} scans
 * @param {(error: unknown) => void} report
 */
function scanFields(scans, report) {
  const list = h('div', { class: 'scans', 'data-testid': 'scans' });
  const render = () => {
    list.replaceChildren(
      ...scans.map((scan, i) => {
        const remove = h('button', { type: 'button', class: 'link-button', 'data-testid': 'scan-remove' }, t('photos.remove'));
        remove.addEventListener('click', () => {
          scans.splice(i, 1);
          render();
        });
        const clear = h('button', { type: 'button', class: 'link-button', 'data-testid': 'crop-clear' }, t('reading.cropClear'));
        clear.addEventListener('click', () => {
          scan.crop = null;
          render();
        });
        return h(
          'figure',
          { class: 'scan', 'data-testid': 'scan' },
          cropper(scan),
          h('figcaption', { class: 'small muted' }, t('reading.cropHelp'), ' ', clear, ' · ', remove),
        );
      }),
    );
  };
  const file = h('input', {
    type: 'file',
    accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif',
    capture: 'environment',
    multiple: true,
    'data-testid': 'scan-input',
    class: 'visually-hidden',
    id: 'scan-input',
  });
  file.addEventListener(
    'change',
    guarded(report, async () => {
      for (const f of file.files ?? []) if (scans.length < MAX_SCANS) scans.push({ file: f, crop: null });
      file.value = '';
      render();
    }),
  );
  render();
  return [h('div', { class: 'photo-row' }, h('label', { class: 'button', for: 'scan-input' }, t('reading.addScan')), file), list];
}

/** @param {string} labelText @param {HTMLElement} control */
const field = (labelText, control) => h('label', { class: 'field' }, h('span', {}, labelText), control);

/**
 * The start screen of a reading.
 * @param {ReadingStatusView} status what is left of the Member's readings today
 * @param {(draft: Draft) => void} opened called with the stored Draft once the reading is asked for
 * @returns {HTMLElement}
 */
export function readStart(status, opened) {
  /** @type {Scan[]} */
  const scans = [];
  /** @type {{ id: string, label: string, type?: import('./types.js').SourceType } | null} */
  let source = null;
  /** @type {{ id: string, label: string } | null} */
  let place = null;
  const status_ = h('p', { class: 'form-status', role: 'status', 'data-testid': 'read-status' });
  const report = showError(status_);
  const title = h('input', { type: 'text', 'data-testid': 'read-title', placeholder: t('citation.titlePlaceholder') });
  const page = h('input', { type: 'text', 'data-testid': 'read-page' });
  const from = h('input', { type: 'number', inputmode: 'numeric', min: '1000', max: '2100', 'data-testid': 'read-from' });
  const to = h('input', { type: 'number', inputmode: 'numeric', min: '1000', max: '2100', 'data-testid': 'read-to' });
  const link = h('input', { type: 'url', inputmode: 'url', 'data-testid': 'read-link', placeholder: 'https://' });
  const note = h('textarea', { rows: '2', 'data-testid': 'read-note' });
  const linkNote = h('p', { class: 'small muted', 'data-testid': 'link-note', hidden: true }, t('reading.linkKept'));
  link.addEventListener('input', () => (linkNote.hidden = !isLink(link.value)));
  const read = h('button', { type: 'button', class: 'button primary', 'data-testid': 'read', disabled: status.remaining <= 0 }, t('reading.read'));

  const start = async () => {
    status_.classList.remove('error');
    if (scans.length === 0) {
      // A pasted viewer address is no image: say what to do, and keep the address for the Citation.
      status_.textContent = isLink(link.value) || isLink(title.value) ? t('reading.portalLink') : t('reading.needScan');
      status_.classList.add('error');
      return;
    }
    read.disabled = true;
    try {
      status_.textContent = t('reading.uploading');
      /** @type {string[]} */
      const uploadIds = [];
      for (const scan of scans) uploadIds.push(await uploadImage(scan.file));
      const years = yearsOf(from.value, to.value);
      const linkValue = isLink(link.value) ? link.value.trim() : null;
      /** @type {ReadingCrop[]} */
      const crops = scans.flatMap((s, i) => (s.crop ? [{ uploadId: /** @type {string} */ (uploadIds[i]), ...s.crop }] : []));
      status_.textContent = t('reading.asking');
      const reading = await requestReading({
        uploadIds,
        crops,
        context: {
          sourceId: source?.id ?? null,
          sourceTitle: source ? null : orNull(title.value),
          page: orNull(page.value),
          placeId: place?.id ?? null,
          years,
          note: orNull(note.value),
          link: linkValue,
        },
      });
      /** @type {'existing' | 'new'} */
      const sourceMode = source ? 'existing' : 'new';
      const citation = {
        sourceMode,
        source,
        sourceType: /** @type {const} */ ('parish_register'),
        title: title.value.trim(),
        repository: '',
        reference: '',
        page: page.value.trim(),
        transcription: '',
        confidence: /** @type {const} */ ('normal'),
        readOn: today(),
      };
      const draft = newDraft({ kind: 'reading', form: newReadingForm(reading.id, { place, citation, link: linkValue, note: note.value.trim() }) });
      await saveDraft(draft);
      for (const [i, scan] of scans.entries())
        await savePhoto({ id: newKey(), draftId: draft.id, blob: scan.file, name: scan.file.name, uploadId: uploadIds[i] ?? null, order: i });
      opened(draft);
    } catch (error) {
      report(new Error(messageOf(error)));
      read.disabled = status.remaining <= 0;
    }
  };
  read.addEventListener('click', () => void start());

  return h(
    'form',
    { class: 'propose-form read-start', 'data-testid': 'read-start', novalidate: true },
    h('h2', {}, t('reading.startTitle')),
    h('p', { class: 'muted small' }, t('reading.startIntro')),
    h('p', { class: 'note small', 'data-testid': 'read-left' }, t('reading.left', { remaining: status.remaining, limit: status.dailyLimit })),
    h('section', { class: 'form-section' }, ...scanFields(scans, report)),
    h(
      'section',
      { class: 'form-section' },
      h('h3', {}, t('reading.whatYouKnow')),
      sourcePicker({ value: source, testid: 'read-source', onChange: (v) => (source = v) }),
      field(t('reading.orTitle'), title),
      field(t('citation.page'), page),
      placePicker({ value: place, testid: 'read-place', onChange: (v) => (place = v) }),
      h('div', { class: 'year-row' }, field(t('reading.fromYear'), from), field(t('reading.toYear'), to)),
      field(t('reading.link'), link),
      linkNote,
      field(t('propose.note'), note),
    ),
    status_,
    h('div', { class: 'form-actions' }, read),
  );
}
