// The review queue (Editors), Proposal cards (also for authors), the merge
// tool, record history and undo. Phone-first: one card per Proposal, the
// changes as sentences, conflicts with a choice per field, and one tap to accept.

import { acceptProposal, getHistory, getProposal, mergePersons, messageOf, rejectProposal, reviewQueue, undoPreview, undoProposal, uploadUrl } from './api.js';
import { h } from './dom.js';
import { language, t } from './i18n.js';
import { personPicker } from './pickers.js';

/** @typedef {import('./types.js').ProposalView} ProposalView */
/** @typedef {import('./types.js').OperationView} OperationView */
/** @typedef {import('./types.js').ConflictView} ConflictView */
/** @typedef {import('./types.js').CitationPreview} CitationPreview */
/** @typedef {import('./types.js').AuthorRef} AuthorRef */
/** @typedef {import('./types.js').HistoryEntry} HistoryEntry */
/** @typedef {import('./types.js').LaterEdit} LaterEdit */
/** @typedef {import('./types.js').UndoBody} UndoBody */
/** @typedef {import('./proposal-build.js').PersonInput} PersonInput */
/** @typedef {import('./i18n.js').Language} Language */

/**
 * What an Editor decided on one card so far.
 * @typedef {object} CardState
 * @property {Map<number, Record<string, 'proposal' | 'current'>>} choices per position: the choice for each conflicting field
 * @property {Map<number, Record<string, unknown>>} corrections per position: the corrected operation
 * @property {boolean} editing whether the correction fields are shown
 */

/** Fields an Editor may correct in place. */
const EDITABLE = ['date', 'given', 'surname', 'asFound', 'page', 'transcription', 'title', 'typeDetail', 'description', 'roleDetail', 'caption'];
/** Text fields that are never null: emptied, they stay an empty text (and the server says what is missing). */
const NOT_NULL = new Set(['given', 'surname', 'asFound', 'transcription', 'title']);

/** @param {string} iso */
export function formatDate(iso) {
  return new Intl.DateTimeFormat(language() === 'cs' ? 'cs-CZ' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** @param {unknown} v */
function show(v) {
  if (v === null || v === undefined || v === '') return t('review.empty');
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** @param {AuthorRef} author */
function authorLine(author) {
  return h(
    'span',
    { class: 'author' },
    author.displayName,
    author.isAgent ? h('span', { class: 'badge agent', 'data-testid': 'agent-badge' }, t('review.agent')) : null,
  );
}

/**
 * "By {author} · accepted by {editor}" in the reader's language, with the author's name (and
 * the Agent badge) as in the review queue.
 * @param {AuthorRef} author
 * @param {AuthorRef | null} editor
 * @param {string} testid
 */
function historyByline(author, editor, testid) {
  const mark = '\u0001';
  const [before = '', after = ''] = t('history.by', { author: mark, editor: editor?.displayName ?? '?' }).split(mark);
  return h('p', { class: 'small', 'data-testid': testid }, before, authorLine(author), after);
}

/** @param {CitationPreview} c */
function citationBlock(c) {
  return h(
    'div',
    { class: 'citation', 'data-testid': 'citation' },
    h(
      'p',
      { class: 'citation-source-line' },
      h('strong', {}, c.sourceTitle),
      c.page ? ` · ${t('citation.page')} ${c.page}` : '',
      c.confidence ? ` · ${t(`confidence.${c.confidence}`)}` : '',
    ),
    c.transcription ? h('blockquote', {}, c.transcription) : null,
    c.images.length
      ? h(
          'div',
          { class: 'photos' },
          ...c.images.map((i) =>
            h(
              'a',
              { href: i.fullUrl, target: '_blank', rel: 'noopener', class: 'thumb', title: t('review.fullSize') },
              h('img', { src: i.url, alt: t(`imageKind.${i.kind}`), loading: 'lazy', 'data-testid': 'citation-image' }),
            ),
          ),
        )
      : null,
  );
}

/** @param {ProposalView} p */
function statusChip(p) {
  return h('span', { class: `chip status-${p.status}`, 'data-testid': 'status' }, t(`status.${p.status}`));
}

/**
 * The Editor's choice per field of an operation based on an older version of its record.
 * @param {ProposalView} p
 * @param {OperationView} o
 * @param {ConflictView} c
 * @param {CardState} state
 * @param {Language} lang
 */
function conflictBlock(p, o, c, state, lang) {
  const box = h('div', { class: 'conflict-box', 'data-testid': 'conflict' }, h('p', { class: 'small' }, t('review.conflict', { record: c.label[lang] })));
  if (c.fields.length === 0) {
    const ack = h('input', { type: 'checkbox', 'data-testid': 'conflict-ack' });
    ack.checked = state.choices.has(o.position);
    ack.addEventListener('change', () => (ack.checked ? state.choices.set(o.position, {}) : state.choices.delete(o.position)));
    box.append(h('label', { class: 'radio-row' }, ack, h('span', {}, t('review.conflictAck'))));
    return box;
  }
  for (const f of c.fields) {
    const name = `c-${p.id}-${o.position}-${f.field}`;
    const row = h('div', { class: 'choice' }, h('div', { class: 'small' }, t(`field.${f.field}`)));
    for (const [which, value] of /** @type {const} */ ([
      ['proposal', f.proposed],
      ['current', f.current],
    ])) {
      // Drawn again when the corrections open or close: show the choice already made.
      const radio = h('input', {
        type: 'radio',
        name,
        value: which,
        checked: state.choices.get(o.position)?.[f.field] === which,
        'data-testid': `choose-${which}-${f.field}`,
      });
      radio.addEventListener('change', () => {
        const picked = state.choices.get(o.position) ?? {};
        picked[f.field] = which;
        state.choices.set(o.position, picked);
      });
      row.append(h('label', { class: 'radio-row' }, radio, h('span', {}, `${t(`review.${which}`)}: ${show(value)}`)));
    }
    box.append(row);
  }
  return box;
}

/**
 * Editable text fields of an operation, for corrections.
 * @param {OperationView} o
 * @param {CardState} state
 */
function correctionInputs(o, state) {
  /** @type {Record<string, unknown>} */
  const op = state.corrections.get(o.position) ?? structuredClone(o.operation);
  const box = h('div', { class: 'correction' });
  /** @param {Record<string, unknown>} obj @param {string} key */
  const add = (obj, key) => {
    const current = obj[key];
    const input = h('input', { type: 'text', value: typeof current === 'string' ? current : '', 'data-testid': `correct-${o.position}-${key}` });
    input.addEventListener('input', () => {
      obj[key] = input.value === '' && !NOT_NULL.has(key) ? null : input.value;
      state.corrections.set(o.position, op);
    });
    box.append(h('label', { class: 'field small' }, h('span', {}, t(`field.${key}`)), input));
  };
  for (const key of EDITABLE) if (typeof op[key] === 'string' || (key in op && op[key] === null)) add(op, key);
  const { name, set } = op;
  if (isRecord(name)) for (const key of ['given', 'surname', 'asFound']) add(name, key);
  if (op.op === 'setField' && isRecord(set)) for (const key of Object.keys(set)) if (typeof set[key] === 'string') add(set, key);
  return box.childElementCount ? box : h('span', {});
}

/**
 * One change of a Proposal as a list item: its sentence, the values it replaces, a conflict and corrections.
 * @param {ProposalView} p
 * @param {OperationView} o
 * @param {CardState} state
 * @param {boolean} review
 */
function changeItem(p, o, state, review) {
  const lang = language();
  const li = h('li', { class: o.conflict ? 'conflict' : '' }, h('span', {}, o.summary[lang]));
  if (o.corrected && o.originalSummary) li.append(h('span', { class: 'muted small corrected' }, ` (${t('review.correctedFrom')}: ${o.originalSummary[lang]})`));
  const set = o.operation.op === 'setField' ? o.operation.set : {};
  if (o.current && !o.conflict) {
    li.append(
      h(
        'div',
        { class: 'compare muted small' },
        ...Object.entries(o.current).map(([f, v]) => h('div', {}, `${t(`field.${f}`)}: ${show(v)} → ${show(set[f])}`)),
      ),
    );
  }
  if (o.conflict && review) li.append(conflictBlock(p, o, o.conflict, state, lang));
  else if (o.conflict) li.append(h('div', { class: 'muted small' }, t('review.conflictNote')));
  if (state.editing && review) li.append(correctionInputs(o, state));
  const image = o.operation.op === 'addImage' ? o.operation.uploadId : null;
  if (image && !p.citations.some((c) => c.images.some((i) => i.id === image))) {
    li.append(h('div', { class: 'photos' }, h('img', { class: 'thumb', src: uploadUrl(image), alt: '' })));
  }
  return li;
}

/**
 * Note, Correct, Reject and Accept for a pending Proposal.
 * @param {ProposalView} p
 * @param {CardState} state
 * @param {() => void} renderChanges
 * @param {() => void} onDone
 */
function reviewActions(p, state, renderChanges, onDone) {
  const note = h('textarea', { rows: '2', placeholder: t('review.notePlaceholder'), 'data-testid': 'review-note' });
  const status = h('p', { class: 'form-status', role: 'status' });
  const accept = h('button', { type: 'button', class: 'button primary', 'data-testid': 'accept' }, t('review.accept'));
  const reject = h('button', { type: 'button', class: 'button', 'data-testid': 'reject' }, t('review.reject'));
  const correct = h('button', { type: 'button', class: 'link-button', 'data-testid': 'correct' }, t('review.correct'));
  correct.addEventListener('click', () => {
    state.editing = !state.editing;
    // Closing the corrections drops them: what is not shown is not sent.
    if (!state.editing) state.corrections.clear();
    renderChanges();
  });
  /** @param {() => Promise<unknown>} fn */
  const act = async (fn) => {
    accept.disabled = reject.disabled = true;
    try {
      await fn();
      onDone();
    } catch (error) {
      status.textContent = messageOf(error);
      status.classList.add('error');
      accept.disabled = reject.disabled = false;
    }
  };
  accept.addEventListener(
    'click',
    () =>
      void act(() =>
        acceptProposal(p.id, {
          note: note.value.trim() || null,
          corrections: [...state.corrections].map(([position, operation]) => ({ position, operation })),
          resolutions: [...state.choices].map(([position, fields]) => ({ position, fields })),
        }),
      ),
  );
  reject.addEventListener('click', () => void act(() => rejectProposal(p.id, { note: note.value.trim() || null })));
  return [note, status, h('div', { class: 'form-actions' }, correct, reject, accept)];
}

/**
 * One Proposal. With `review`, the Editor can correct, choose per field, accept and reject.
 * @param {ProposalView} p
 * @param {{ review?: { onDone: () => void } }} [options]
 */
export function proposalCard(p, options = {}) {
  /** @type {CardState} */
  const state = { choices: new Map(), corrections: new Map(), editing: false };
  const ops = h('ol', { class: 'changes', 'data-testid': 'changes' });
  const renderChanges = () => ops.replaceChildren(...p.operations.map((o) => changeItem(p, o, state, Boolean(options.review))));
  const card = h(
    'article',
    { class: 'card proposal', 'data-testid': 'proposal', 'data-id': p.id },
    h('header', { class: 'card-head' }, authorLine(p.author), h('span', { class: 'muted small' }, formatDate(p.submittedAt)), statusChip(p)),
    p.note ? h('p', { class: 'proposal-note' }, p.note) : null,
    ops,
    ...p.citations.map(citationBlock),
    p.decisionNote
      ? h(
          'p',
          { class: 'decision-note', 'data-testid': 'decision-note' },
          h('strong', {}, `${t('review.editorNote')}${p.decidedBy ? ` (${p.decidedBy.displayName})` : ''}: `),
          p.decisionNote,
        )
      : null,
  );
  renderChanges();
  if (options.review && p.status === 'pending') card.append(...reviewActions(p, state, renderChanges, options.review.onDone));
  return card;
}

/**
 * The review queue: pending Proposals, oldest first.
 * @param {HTMLElement} root
 * @param {string | undefined} focusId
 * @param {AbortSignal} signal aborted when the Member leaves the screen; nothing is drawn after that
 */
export async function renderReview(root, focusId, signal) {
  root.replaceChildren(h('p', { class: 'muted' }, t('work.loading')));
  const { items, total } = await reviewQueue(signal);
  if (signal.aborted) return;
  const reload = () => {
    renderReview(root, undefined, signal).catch((/** @type {unknown} */ e) => {
      if (!signal.aborted) root.replaceChildren(h('p', { class: 'form-status error' }, messageOf(e)));
    });
  };
  root.replaceChildren(
    h('h2', {}, t('review.title')),
    h('p', { class: 'muted small', 'data-testid': 'queue-count' }, t('review.count', { count: total ?? items.length })),
    ...(items.length ? items.map((p) => proposalCard(p, { review: { onDone: reload } })) : [h('p', { class: 'empty' }, t('review.none'))]),
    mergeTool(reload),
  );
  if (focusId) root.querySelector(`[data-id="${focusId}"]`)?.scrollIntoView({ block: 'start' });
}

/** Merge two Persons into one (Editors, at any time). @param {() => void} onDone */
function mergeTool(onDone) {
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

/**
 * One entry of a record's history, with undo for Editors.
 * @param {HistoryEntry} e
 * @param {boolean} canUndo
 * @param {() => void} onUndone
 */
function historyEntry(e, canUndo, onUndone) {
  const lang = language();
  const undoBox = h('div', { class: 'undo-box' });
  const entry = h(
    'article',
    { class: 'card history-entry', 'data-testid': 'history-entry' },
    h('header', { class: 'card-head' }, h('span', { class: 'chip' }, t(`kind.${e.kind}`)), h('span', { class: 'muted small' }, formatDate(e.acceptedAt))),
    historyByline(e.author, e.acceptedBy, 'history-by'),
    h('ol', { class: 'changes' }, ...e.summaries.map((s) => h('li', {}, s[lang]))),
    ...e.corrections.map((c) => h('p', { class: 'muted small' }, t('history.corrected', { editor: c.by.displayName, change: c.summary[lang] }))),
    e.citations.length
      ? h(
          'p',
          { class: 'muted small' },
          `${t('history.citations')}: ${e.citations.map((c) => (c.page ? `${c.sourceTitle}, ${c.page}` : c.sourceTitle)).join('; ')}`,
        )
      : null,
    e.decisionNote ? h('p', { class: 'small' }, `${t('review.editorNote')}: ${e.decisionNote}`) : null,
    e.undoneBy ? h('p', { class: 'chip status-rejected' }, t('history.undone')) : null,
    undoBox,
  );
  if (canUndo && !e.undoneBy) {
    const undo = h('button', { type: 'button', class: 'button', 'data-testid': 'undo' }, t('history.undo'));
    undo.addEventListener('click', () => void undoFlow(e.proposalId, undoBox, onUndone));
    undoBox.append(undo);
  }
  return entry;
}

/**
 * The history of a Person, newest first, with undo for Editors.
 * @param {HTMLElement} root
 * @param {{ kind?: string, id?: string, canUndo: boolean }} o
 * @param {AbortSignal} signal aborted when the Member leaves the screen
 */
export async function renderHistory(root, o, signal) {
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
  const { items } = await getHistory(o.kind, o.id, signal);
  if (signal.aborted) return;
  const again = () => {
    renderHistory(root, o, signal).catch((/** @type {unknown} */ e) => {
      if (!signal.aborted) list.replaceChildren(h('p', { class: 'form-status error' }, messageOf(e)));
    });
  };
  list.replaceChildren(...(items.length ? items.map((e) => historyEntry(e, o.canUndo, again)) : [h('p', { class: 'empty' }, t('history.none'))]));
}

/**
 * A logged column (`as_found`) by its field label in the reader's language (`field.asFound`), or as it is when there is none.
 * @param {string} column
 */
function columnLabel(column) {
  const key = `field.${column.replace(/_([a-z])/g, (_, /** @type {string} */ c) => c.toUpperCase())}`;
  const label = t(key);
  return label === key ? column : label;
}

/**
 * The choices for one record edited again after the Proposal.
 * @param {LaterEdit} e
 * @param {UndoBody['choices'][number]} choice
 * @param {Language} lang
 */
function laterEditBlock(e, choice, lang) {
  const key = `${e.table}:${e.id}`;
  const block = h('div', { class: 'conflict-box', 'data-testid': 'later-edit' }, h('p', { class: 'small' }, t('history.laterEdit', { record: e.label[lang] })));
  if (e.recordLevel) {
    for (const which of /** @type {const} */ (['undo', 'keep'])) {
      const radio = h('input', { type: 'radio', name: `u-${key}`, 'data-testid': `undo-record-${which}` });
      radio.addEventListener('change', () => (choice.keep = which === 'keep'));
      block.append(h('label', { class: 'radio-row' }, radio, h('span', {}, t(`history.record.${which}`))));
    }
  }
  for (const f of e.fields) {
    const row = h('div', { class: 'choice' }, h('div', { class: 'small', 'data-testid': 'later-field' }, columnLabel(f.field)));
    for (const [which, value] of /** @type {const} */ ([
      ['undo', f.before],
      ['keep', f.current],
    ])) {
      const radio = h('input', { type: 'radio', name: `u-${key}-${f.field}`, 'data-testid': `undo-${which}-${f.field}` });
      radio.addEventListener('change', () => (choice.fields[f.field] = which));
      row.append(h('label', { class: 'radio-row' }, radio, h('span', {}, `${t(`history.choice.${which}`)}: ${show(value)}`)));
    }
    block.append(row);
  }
  return block;
}

/** A Proposal id in `blockedBy`, rather than the note for records that are not in the log. @param {string} ref */
const isProposalId = (ref) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ref);

/**
 * A later Proposal that builds on the records of the one being undone: when it was accepted, by
 * whom, what it changed, and its own Undo, so the Editor can undo it first from here.
 * @param {ProposalView} p
 * @param {() => void} onDone
 */
function blockerItem(p, onDone) {
  const lang = language();
  const box = h('div', { class: 'undo-box' });
  const undo = h('button', { type: 'button', class: 'button', 'data-testid': 'undo-blocker-undo' }, t('history.undoFirst'));
  undo.addEventListener('click', () => void undoFlow(p.id, box, onDone));
  box.append(undo);
  return h(
    'li',
    { class: 'undo-blocker', 'data-testid': 'undo-blocker', 'data-id': p.id },
    h(
      'div',
      { class: 'card-head' },
      h('span', { class: 'chip' }, t(`kind.${p.kind}`)),
      h('span', { class: 'muted small' }, formatDate(p.decidedAt ?? p.submittedAt)),
    ),
    historyByline(p.author, p.decidedBy, 'undo-blocker-by'),
    h('ol', { class: 'changes' }, ...p.operations.map((o) => h('li', {}, o.summary[lang]))),
    box,
  );
}

/**
 * Undo, with a choice per field when records were edited again since. While later Proposals
 * build on its records, the undo is refused and they are listed, newest first, to undo first.
 * @param {string} proposalId
 * @param {HTMLElement} box
 * @param {() => void} onDone
 */
async function undoFlow(proposalId, box, onDone) {
  const lang = language();
  const status = h('p', { class: 'form-status', role: 'status' });
  let preview;
  /** @type {ProposalView[]} */
  let blockers;
  try {
    preview = await undoPreview(proposalId);
    blockers = await Promise.all(preview.blockedBy.filter(isProposalId).map((id) => getProposal(id)));
  } catch (error) {
    box.replaceChildren(h('p', { class: 'form-status error' }, messageOf(error)));
    return;
  }
  if (preview.blockedBy.length) {
    box.replaceChildren(
      h(
        'p',
        { class: 'form-status error', 'data-testid': 'undo-blocked' },
        blockers.length ? t('history.blocked', { count: blockers.length }) : t('history.blockedUnlogged'),
      ),
      ...(blockers.length ? [h('ol', { class: 'undo-blockers' }, ...blockers.map((p) => blockerItem(p, onDone)))] : []),
    );
    return;
  }
  /** @type {UndoBody['choices']} */
  const choices = [];
  const rows = preview.laterEdits.map((e) => {
    /** @type {UndoBody['choices'][number]} */
    const choice = { table: e.table, id: e.id, fields: {} };
    choices.push(choice);
    return laterEditBlock(e, choice, lang);
  });
  const confirm = h('button', { type: 'button', class: 'button primary', 'data-testid': 'confirm-undo' }, t('history.confirmUndo'));
  const undo = async () => {
    confirm.disabled = true;
    try {
      await undoProposal(proposalId, { note: null, choices });
      onDone();
    } catch (error) {
      status.textContent = messageOf(error);
      status.classList.add('error');
      confirm.disabled = false;
    }
  };
  confirm.addEventListener('click', () => void undo());
  box.replaceChildren(h('p', { class: 'small' }, rows.length ? t('history.chooseLater') : t('history.undoNow')), ...rows, status, confirm);
}
