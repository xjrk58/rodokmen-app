// Import batches in the review queue (review spec, "Batch view in the review queue", "Accept a
// whole Import batch"): each batch is one entry with its author, size and progress. Opened, its
// Proposals show in batch order, twenty at a time, or as a random sample of twenty pending ones
// for spot-checking; the Owner may accept the whole batch after a confirmation that states how
// many Proposals and changes it covers.

import { acceptBatch, batchProposals, getBatch, listBatches, messageOf } from './api.js';
import { h } from './dom.js';
import { t } from './i18n.js';
import { authorLine, proposalCard } from './review.js';

/** @typedef {import('./types.js').BatchView} BatchView */
/** @typedef {import('./types.js').Me} Me */
/** @typedef {import('./types.js').AcceptBatchResult} AcceptBatchResult */

const PAGE = 20;
export const SAMPLE = 20;

/** The progress of a batch as one line. @param {BatchView} b */
function progress(b) {
  return h('p', { class: 'small batch-progress', 'data-testid': 'batch-progress' }, t('batch.progress', b.counts));
}

/** A batch as one entry of the review queue. @param {BatchView} b */
function batchEntry(b) {
  return h(
    'article',
    { class: 'card batch', 'data-testid': 'batch', 'data-id': b.id },
    h('header', { class: 'card-head' }, h('strong', {}, b.name), h('span', { class: 'chip' }, t('batch.size', { count: b.counts.total }))),
    h('p', { class: 'small' }, t('batch.by'), ' ', authorLine(b.author)),
    progress(b),
    h('a', { class: 'button', href: `#work/review/batch/${b.id}`, 'data-testid': 'open-batch' }, t('batch.open')),
  );
}

/**
 * The Import batches with Proposals still to decide, for the top of the review queue. The element
 * is returned at once and filled when the list arrives.
 * @param {AbortSignal} signal
 */
export function batchEntries(signal) {
  const box = h('section', { class: 'batches', 'data-testid': 'batches' });
  listBatches(signal)
    .then(({ items }) => {
      if (signal.aborted) return;
      const open = items.filter((b) => b.counts.pending + b.counts.blocked > 0);
      box.replaceChildren(...(open.length ? [h('h3', {}, t('batch.title')), ...open.map(batchEntry)] : []));
    })
    .catch((/** @type {unknown} */ e) => {
      if (!signal.aborted) box.replaceChildren(h('p', { class: 'form-status error' }, messageOf(e)));
    });
  return box;
}

/**
 * The result of accepting a whole batch: how many were accepted, and which stay pending and why.
 * @param {AcceptBatchResult} r
 */
function resultBlock(r) {
  return h(
    'div',
    { class: 'note batch-result', 'data-testid': 'batch-result', role: 'status' },
    h('p', {}, t('batch.result', { accepted: r.accepted.length, failed: r.failed.length, blocked: r.blocked.length })),
    ...r.failed.map((f) => h('p', { class: 'small', 'data-testid': 'batch-failed' }, t('batch.failed', { number: f.position + 1, message: f.message }))),
    ...r.blocked.map((b) => h('p', { class: 'small', 'data-testid': 'batch-blocked' }, t('batch.blockedLine', { number: b.position + 1 }))),
  );
}

/**
 * The Owner's "Accept batch": a confirmation stating how many Proposals and changes, then the result.
 * @param {BatchView} b
 * @param {() => void} onDone
 */
function acceptBox(b, onDone) {
  const box = h('div', { class: 'batch-accept' });
  const pending = b.counts.pending + b.counts.blocked;
  const start = h('button', { type: 'button', class: 'button primary', 'data-testid': 'accept-batch' }, t('batch.accept'));
  start.addEventListener('click', () => {
    const confirm = h('button', { type: 'button', class: 'button primary', 'data-testid': 'confirm-accept-batch' }, t('batch.confirmButton'));
    const cancel = h('button', { type: 'button', class: 'button' }, t('batch.cancel'));
    const status = h('p', { class: 'form-status', role: 'status' });
    cancel.addEventListener('click', () => box.replaceChildren(start));
    confirm.addEventListener('click', () => {
      confirm.disabled = cancel.disabled = true;
      status.textContent = t('batch.accepting');
      acceptBatch(b.id, { proposals: pending, note: null })
        .then((r) => {
          box.replaceChildren(resultBlock(r));
          onDone();
        })
        .catch((/** @type {unknown} */ e) => {
          status.textContent = messageOf(e);
          status.classList.add('error');
          confirm.disabled = cancel.disabled = false;
        });
    });
    box.replaceChildren(
      h('p', { class: 'warning', 'data-testid': 'batch-confirm' }, t('batch.confirm', { proposals: pending, changes: b.pendingChanges })),
      h('div', { class: 'form-actions' }, cancel, confirm),
      status,
    );
  });
  box.append(start);
  return box;
}

/**
 * One Import batch: its progress, its Proposals in batch order or a sample, and for the Owner
 * "Accept batch".
 * @param {HTMLElement} root
 * @param {string} id
 * @param {Me} me
 * @param {AbortSignal} signal
 */
export async function renderBatch(root, id, me, signal) {
  root.replaceChildren(h('p', { class: 'muted' }, t('work.loading')));
  const batch = await getBatch(id, signal);
  if (signal.aborted) return;
  const list = h('div', { class: 'batch-proposals', 'data-testid': 'batch-proposals' });
  const header = h('div', {}, progress(batch));
  const reload = () => {
    getBatch(id, signal)
      .then((b) => header.replaceChildren(progress(b)))
      .catch(() => undefined);
  };
  /** @param {{ sample: number } | { offset: number, limit: number }} q */
  const show = async (q) => {
    list.replaceChildren(h('p', { class: 'muted' }, t('work.loading')));
    const { items } = await batchProposals(id, q, signal);
    if (signal.aborted) return;
    const nav = [];
    if (!('sample' in q)) {
      const prev = h('button', { type: 'button', class: 'button', 'data-testid': 'batch-prev', disabled: q.offset === 0 }, t('batch.prev'));
      const next = h('button', { type: 'button', class: 'button', 'data-testid': 'batch-next', disabled: items.length < PAGE }, t('batch.next'));
      prev.addEventListener('click', () => void show({ offset: Math.max(0, q.offset - PAGE), limit: PAGE }));
      next.addEventListener('click', () => void show({ offset: q.offset + PAGE, limit: PAGE }));
      nav.push(h('div', { class: 'form-actions' }, prev, next));
    }
    const heading = 'sample' in q ? t('batch.sampleOf', { count: items.length }) : t('batch.inOrder', { from: q.offset + 1, to: q.offset + items.length });
    list.replaceChildren(
      h('p', { class: 'muted small', 'data-testid': 'batch-shown' }, heading),
      ...(items.length ? items.map((p) => proposalCard(p, { review: { onDone: reload } })) : [h('p', { class: 'empty' }, t('review.none'))]),
      ...nav,
    );
  };
  const inOrder = h('button', { type: 'button', class: 'button', 'data-testid': 'batch-in-order' }, t('batch.inOrderButton'));
  const sample = h('button', { type: 'button', class: 'button', 'data-testid': 'batch-sample' }, t('batch.sample', { count: SAMPLE }));
  inOrder.addEventListener('click', () => void show({ offset: 0, limit: PAGE }));
  sample.addEventListener('click', () => void show({ sample: SAMPLE }));
  root.replaceChildren(
    h('p', {}, h('a', { href: '#work/review', 'data-testid': 'back-to-queue' }, t('batch.back'))),
    h('h2', { 'data-testid': 'batch-title' }, batch.name),
    h('p', { class: 'small' }, t('batch.by'), ' ', authorLine(batch.author)),
    header,
    me.permissions.acceptBatch
      ? acceptBox(batch, () => {
          reload();
          void show({ offset: 0, limit: PAGE });
        })
      : '',
    h('div', { class: 'form-actions' }, inOrder, sample),
    list,
  );
  await show({ offset: 0, limit: PAGE });
}
