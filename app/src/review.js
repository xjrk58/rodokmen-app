// The review queue (Editors), Proposal cards (also for authors), the merge
// tool, record history and undo. Phone-first: one card per Proposal, the
// changes as sentences, conflicts with a choice per field, and one tap to accept.

import { api } from './api.js';
import { h } from './dom.js';
import { language, t } from './i18n.js';
import { personPicker } from './pickers.js';

/** @typedef {any} ProposalView */

/** @param {string} iso */
export function formatDate(iso) {
  return new Intl.DateTimeFormat(language() === 'cs' ? 'cs-CZ' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** @param {unknown} v */
function show(v) {
  if (v === null || v === undefined || v === '') return t('review.empty');
  return String(v);
}

/** @param {{ id: string, displayName: string, isAgent: boolean }} author */
function authorLine(author) {
  return h('span', { class: 'author' }, author.displayName, author.isAgent ? h('span', { class: 'badge agent', 'data-testid': 'agent-badge' }, t('review.agent')) : null);
}

/** @param {any} c citation preview */
function citationBlock(c) {
  return h('div', { class: 'citation', 'data-testid': 'citation' },
    h('p', { class: 'citation-source-line' }, h('strong', {}, c.sourceTitle), c.page ? ` · ${t('citation.page')} ${c.page}` : '', c.confidence ? ` · ${t(`confidence.${c.confidence}`)}` : ''),
    c.transcription ? h('blockquote', {}, c.transcription) : null,
    c.images.length
      ? h('div', { class: 'photos' }, ...c.images.map((/** @type {any} */ i) => h('a', { href: i.fullUrl, target: '_blank', rel: 'noopener', class: 'thumb', title: t('review.fullSize') }, h('img', { src: i.url, alt: t(`imageKind.${i.kind}`), loading: 'lazy', 'data-testid': 'citation-image' }))))
      : null,
  );
}

/** @param {any} p ProposalView */
function statusChip(p) {
  return h('span', { class: `chip status-${p.status}`, 'data-testid': 'status' }, t(`status.${p.status}`));
}

/**
 * One Proposal. With `review`, the Editor can correct, choose per field, accept and reject.
 * @param {ProposalView} p
 * @param {{ review?: { onDone: () => void } }} [options]
 */
export function proposalCard(p, options = {}) {
  const lang = language();
  /** Per position: the Editor's choice for each conflicting field. @type {Map<number, Record<string, 'proposal' | 'current'>>} */
  const choices = new Map();
  /** Per position: corrected operation. @type {Map<number, any>} */
  const corrections = new Map();
  const editing = { on: false };

  const ops = h('ol', { class: 'changes', 'data-testid': 'changes' });
  const renderOps = () => {
    ops.replaceChildren(
      ...p.operations.map((/** @type {any} */ o) => {
        const li = h('li', { class: o.conflict ? 'conflict' : '' }, h('span', {}, o.summary[lang]));
        if (o.corrected && o.originalSummary) li.append(h('span', { class: 'muted small corrected' }, ` (${t('review.correctedFrom')}: ${o.originalSummary[lang]})`));
        if (o.current && !o.conflict) {
          li.append(h('div', { class: 'compare muted small' }, ...Object.entries(o.current).map(([f, v]) => h('div', {}, `${t(`field.${f}`)}: ${show(v)} → ${show(o.operation.set[f])}`))));
        }
        if (o.conflict && options.review) li.append(conflictBlock(o));
        else if (o.conflict) li.append(h('div', { class: 'muted small' }, t('review.conflictNote')));
        if (editing.on && options.review) li.append(correctionInputs(o));
        if (o.operation.op === 'addImage' && !p.citations.some((/** @type {any} */ c) => c.images.some((/** @type {any} */ i) => i.id === o.operation.uploadId))) {
          li.append(h('div', { class: 'photos' }, h('img', { class: 'thumb', src: `/api/uploads/${o.operation.uploadId}`, alt: '' })));
        }
        return li;
      }),
    );
  };

  /** @param {any} o operation view */
  const conflictBlock = (o) => {
    const c = o.conflict;
    const box = h('div', { class: 'conflict-box', 'data-testid': 'conflict' }, h('p', { class: 'small' }, t('review.conflict', { record: c.label[lang] })));
    const fields = c.fields.length ? c.fields : [];
    if (fields.length === 0) {
      const ack = h('input', { type: 'checkbox', 'data-testid': 'conflict-ack' });
      ack.addEventListener('change', () => (ack.checked ? choices.set(o.position, {}) : choices.delete(o.position)));
      box.append(h('label', { class: 'radio-row' }, ack, h('span', {}, t('review.conflictAck'))));
      return box;
    }
    for (const f of fields) {
      const name = `c-${p.id}-${o.position}-${f.field}`;
      const row = h('div', { class: 'choice' }, h('div', { class: 'small' }, t(`field.${f.field}`)));
      for (const [which, value] of /** @type {const} */ ([['proposal', f.proposed], ['current', f.current]])) {
        const radio = h('input', { type: 'radio', name, value: which, 'data-testid': `choose-${which}-${f.field}` });
        radio.addEventListener('change', () => {
          const picked = choices.get(o.position) ?? {};
          picked[f.field] = which;
          choices.set(o.position, picked);
        });
        row.append(h('label', { class: 'radio-row' }, radio, h('span', {}, `${t(`review.${which}`)}: ${show(value)}`)));
      }
      box.append(row);
    }
    return box;
  };

  /** Editable text fields of an operation, for corrections. @param {any} o */
  const correctionInputs = (o) => {
    const op = corrections.get(o.position) ?? structuredClone(o.operation);
    const box = h('div', { class: 'correction' });
    const editable = ['date', 'given', 'surname', 'asFound', 'page', 'transcription', 'title', 'typeDetail', 'description', 'roleDetail', 'caption'];
    /** @param {any} obj @param {string} key @param {string} label */
    const add = (obj, key, label) => {
      const input = h('input', { type: 'text', value: obj[key] ?? '', 'data-testid': `correct-${o.position}-${key}` });
      input.addEventListener('input', () => {
        obj[key] = input.value === '' && key !== 'given' && key !== 'surname' ? null : input.value;
        corrections.set(o.position, op);
      });
      box.append(h('label', { class: 'field small' }, h('span', {}, label), input));
    };
    for (const key of editable) if (typeof op[key] === 'string' || (key in op && op[key] === null)) add(op, key, t(`field.${key}`));
    if (op.name) for (const key of ['given', 'surname', 'asFound']) add(op.name, key, t(`field.${key}`));
    if (op.op === 'setField') for (const key of Object.keys(op.set)) if (typeof op.set[key] === 'string') add(op.set, key, t(`field.${key}`));
    return box.childElementCount ? box : h('span', {});
  };

  const card = h('article', { class: 'card proposal', 'data-testid': 'proposal', 'data-id': p.id },
    h('header', { class: 'card-head' }, authorLine(p.author), h('span', { class: 'muted small' }, formatDate(p.submittedAt)), statusChip(p)),
    p.note ? h('p', { class: 'proposal-note' }, p.note) : null,
    ops,
    ...p.citations.map(citationBlock),
    p.decisionNote ? h('p', { class: 'decision-note', 'data-testid': 'decision-note' }, h('strong', {}, `${t('review.editorNote')}${p.decidedBy ? ` (${p.decidedBy.displayName})` : ''}: `), p.decisionNote) : null,
  );
  renderOps();

  if (options.review && p.status === 'pending') {
    const note = h('textarea', { rows: '2', placeholder: t('review.notePlaceholder'), 'data-testid': 'review-note' });
    const status = h('p', { class: 'form-status', role: 'status' });
    const accept = h('button', { type: 'button', class: 'button primary', 'data-testid': 'accept' }, t('review.accept'));
    const reject = h('button', { type: 'button', class: 'button', 'data-testid': 'reject' }, t('review.reject'));
    const correct = h('button', { type: 'button', class: 'link-button', 'data-testid': 'correct' }, t('review.correct'));
    correct.addEventListener('click', () => {
      editing.on = !editing.on;
      renderOps();
    });
    /** @param {() => Promise<unknown>} fn */
    const act = async (fn) => {
      accept.disabled = reject.disabled = true;
      try {
        await fn();
        options.review?.onDone();
      } catch (error) {
        status.textContent = /** @type {Error} */ (error).message;
        status.classList.add('error');
        accept.disabled = reject.disabled = false;
      }
    };
    accept.addEventListener('click', () =>
      act(() =>
        api(`proposals/${p.id}/accept`, {
          method: 'POST',
          body: {
            note: note.value.trim() || null,
            corrections: [...corrections].map(([position, operation]) => ({ position, operation })),
            resolutions: [...choices].map(([position, fields]) => ({ position, fields })),
          },
        }),
      ),
    );
    reject.addEventListener('click', () => act(() => api(`proposals/${p.id}/reject`, { method: 'POST', body: { note: note.value.trim() || null } })));
    card.append(note, status, h('div', { class: 'form-actions' }, correct, reject, accept));
  }
  return card;
}

/**
 * The review queue: pending Proposals, oldest first.
 * @param {HTMLElement} root
 * @param {string | undefined} focusId
 */
export async function renderReview(root, focusId) {
  root.replaceChildren(h('p', { class: 'muted' }, t('work.loading')));
  const { items } = await api('review');
  const reload = () => void renderReview(root, undefined);
  root.replaceChildren(
    h('h2', {}, t('review.title')),
    h('p', { class: 'muted small', 'data-testid': 'queue-count' }, t('review.count', { count: items.length })),
    ...(items.length ? items.map((/** @type {any} */ p) => proposalCard(p, { review: { onDone: reload } })) : [h('p', { class: 'empty' }, t('review.none'))]),
    mergeTool(reload),
  );
  if (focusId) root.querySelector(`[data-id="${focusId}"]`)?.scrollIntoView({ block: 'start' });
}

/** Merge two Persons into one (Editors, at any time). @param {() => void} onDone */
function mergeTool(onDone) {
  /** @type {any} */
  let keep = null;
  /** @type {any} */
  let gone = null;
  const status = h('p', { class: 'form-status', role: 'status' });
  const button = h('button', { type: 'button', class: 'button', 'data-testid': 'merge' }, t('merge.button'));
  button.addEventListener('click', async () => {
    if (keep?.mode !== 'existing' || gone?.mode !== 'existing' || keep.id === gone.id) {
      status.textContent = t('merge.pickTwo');
      return;
    }
    try {
      await api(`persons/${keep.id}/merge`, { method: 'POST', body: { mergeId: gone.id, keepBaseVersion: keep.version, mergeBaseVersion: gone.version, note: null } });
      status.textContent = t('merge.done');
      onDone();
    } catch (error) {
      status.textContent = /** @type {Error} */ (error).message;
    }
  });
  return h('details', { class: 'card merge-tool' },
    h('summary', {}, t('merge.title')),
    h('p', { class: 'muted small' }, t('merge.help')),
    personPicker({ value: null, label: t('merge.keep'), testid: 'merge-keep', allowNew: false, onChange: (v) => (keep = v) }),
    personPicker({ value: null, label: t('merge.gone'), testid: 'merge-gone', allowNew: false, onChange: (v) => (gone = v) }),
    status,
    button,
  );
}

/**
 * The history of a Person, newest first, with undo for Editors.
 * @param {HTMLElement} root
 * @param {{ kind?: string, id?: string, canUndo: boolean }} o
 */
export async function renderHistory(root, o) {
  const picker = personPicker({
    value: null,
    label: t('history.which'),
    testid: 'history-person',
    allowNew: false,
    onChange: (v) => {
      if (v?.mode === 'existing') location.hash = `#work/history/person/${v.id}`;
    },
  });
  const list = h('div', { class: 'history', 'data-testid': 'history' });
  root.replaceChildren(h('h2', {}, t('history.title')), picker, list);
  if (!o.kind || !o.id) return;
  list.replaceChildren(h('p', { class: 'muted' }, t('work.loading')));
  const { items } = await api(`history/${o.kind}/${o.id}`);
  const lang = language();
  list.replaceChildren(
    ...(items.length
      ? items.map((/** @type {any} */ e) => {
          const undoBox = h('div', { class: 'undo-box' });
          const entry = h('article', { class: 'card history-entry', 'data-testid': 'history-entry' },
            h('header', { class: 'card-head' }, h('span', { class: 'chip' }, t(`kind.${e.kind}`)), h('span', { class: 'muted small' }, formatDate(e.acceptedAt))),
            h('p', { class: 'small' }, t('history.by', { author: e.author.displayName, editor: e.acceptedBy.displayName })),
            h('ol', { class: 'changes' }, ...e.summaries.map((/** @type {any} */ s) => h('li', {}, s[lang]))),
            ...e.corrections.map((/** @type {any} */ c) => h('p', { class: 'muted small' }, t('history.corrected', { editor: c.by.displayName, change: c.summary[lang] }))),
            e.citations.length ? h('p', { class: 'muted small' }, `${t('history.citations')}: ${e.citations.map((/** @type {any} */ c) => (c.page ? `${c.sourceTitle}, ${c.page}` : c.sourceTitle)).join('; ')}`) : null,
            e.decisionNote ? h('p', { class: 'small' }, `${t('review.editorNote')}: ${e.decisionNote}`) : null,
            e.undoneBy ? h('p', { class: 'chip status-rejected' }, t('history.undone')) : null,
            undoBox,
          );
          if (o.canUndo && !e.undoneBy) {
            const undo = h('button', { type: 'button', class: 'button', 'data-testid': 'undo' }, t('history.undo'));
            undo.addEventListener('click', () => void undoFlow(e.proposalId, undoBox, () => void renderHistory(root, o)));
            undoBox.append(undo);
          }
          return entry;
        })
      : [h('p', { class: 'empty' }, t('history.none'))]),
  );
}

/**
 * Undo, with a choice per field when records were edited again since.
 * @param {string} proposalId
 * @param {HTMLElement} box
 * @param {() => void} onDone
 */
async function undoFlow(proposalId, box, onDone) {
  const lang = language();
  const status = h('p', { class: 'form-status', role: 'status' });
  let preview;
  try {
    preview = await api(`proposals/${proposalId}/undo`);
  } catch (error) {
    box.replaceChildren(h('p', { class: 'form-status error' }, /** @type {Error} */ (error).message));
    return;
  }
  /** @type {Map<string, { table: string, id: string, keep?: boolean, fields: Record<string, string> }>} */
  const choices = new Map();
  const rows = preview.laterEdits.map((/** @type {any} */ e) => {
    const key = `${e.table}:${e.id}`;
    const choice = { table: e.table, id: e.id, fields: {} };
    choices.set(key, choice);
    const block = h('div', { class: 'conflict-box', 'data-testid': 'later-edit' }, h('p', { class: 'small' }, t('history.laterEdit', { record: e.label[lang] })));
    if (e.recordLevel) {
      for (const which of ['undo', 'keep']) {
        const radio = h('input', { type: 'radio', name: `u-${key}`, 'data-testid': `undo-record-${which}` });
        radio.addEventListener('change', () => (/** @type {any} */ (choice).keep = which === 'keep'));
        block.append(h('label', { class: 'radio-row' }, radio, h('span', {}, t(`history.record.${which}`))));
      }
    }
    for (const f of e.fields) {
      const row = h('div', { class: 'choice' }, h('div', { class: 'small' }, f.field));
      for (const [which, value] of [['undo', f.before], ['keep', f.current]]) {
        const radio = h('input', { type: 'radio', name: `u-${key}-${f.field}`, 'data-testid': `undo-${which}-${f.field}` });
        radio.addEventListener('change', () => (/** @type {any} */ (choice.fields)[f.field] = which));
        row.append(h('label', { class: 'radio-row' }, radio, h('span', {}, `${t(`history.choice.${which}`)}: ${show(value)}`)));
      }
      block.append(row);
    }
    return block;
  });
  const confirm = h('button', { type: 'button', class: 'button primary', 'data-testid': 'confirm-undo' }, t('history.confirmUndo'));
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      await api(`proposals/${proposalId}/undo`, { method: 'POST', body: { note: null, choices: [...choices.values()] } });
      onDone();
    } catch (error) {
      status.textContent = /** @type {Error} */ (error).message;
      status.classList.add('error');
      confirm.disabled = false;
    }
  });
  box.replaceChildren(h('p', { class: 'small' }, rows.length ? t('history.chooseLater') : t('history.undoNow')), ...rows, status, confirm);
}
