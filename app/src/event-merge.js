// Merging two Events that look like one, from the person page (family-view spec, "Merge duplicate
// Events from the person page"; review spec, "Merging duplicate Events"). The server offers each
// pair (PersonDetail.mergeableEvents) with the Event to keep suggested; an Editor sees "Same
// Event?" under the second of the two. Opened, it shows both Events side by side, with their
// Roles, date, Place or House, description and Citations, the suggested one chosen to stay, a note
// and "Merge". A refusal names the facts that differ, in the Member's language. The undo is in the
// history of the Person, as for every change.

import { ApiError, getEvent, mergeEvents } from './api.js';
import { t } from './i18n.js';
import { errorText, eventWhere } from './screen-parts.js';
import { html, useEffect, useState } from './ui.js';

/** @typedef {import('./types.js').EventDetail} EventDetail */

/** The facts a merge of Events can disagree on, as the API names them. */
const FACTS = ['type', 'date', 'place', 'roles', 'description', 'notes'];

/**
 * What went wrong with a merge, in the Member's language: the facts the two Events disagree on,
 * that one of them changed meanwhile, or the general error text.
 * @param {unknown} error
 */
export function mergeErrorText(error) {
  if (error instanceof ApiError && error.code === 'merge_conflict') {
    const facts = error.facts.filter((f) => FACTS.includes(f)).map((f) => t(`eventMerge.fact.${f}`));
    return t('eventMerge.refused', { facts: facts.join(', ') });
  }
  if (error instanceof ApiError && (error.code === 'conflict' || error.code === 'event_merged')) return t('eventMerge.changed');
  return errorText(error);
}

/**
 * One Event of the pair, as the panel shows it, with the choice to keep it.
 * @param {{ event: EventDetail, name: string, chosen: boolean, onChoose: () => void, testid: string }} props
 */
function Side({ event, name, chosen, onChoose, testid }) {
  return html`<div class=${`merge-side${chosen ? ' chosen' : ''}`} data-testid=${testid} data-event=${event.id}>
    <label class="merge-choice">
      <input type="radio" name=${name} checked=${chosen} onChange=${onChoose} data-testid=${`${testid}-keep`} />
      <span>${t('eventMerge.keep')}</span>
    </label>
    <p>
      <strong>${t(`eventType.${event.type}`)}${event.typeDetail ? ` (${event.typeDetail})` : ''}</strong>
    </p>
    <p class="small">${[event.date ?? t('eventMerge.noDate'), eventWhere(event) || t('eventMerge.noPlace')].join(' · ')}</p>
    ${event.description ? html`<p class="small muted">${event.description}</p>` : null}
    <ul class="plain-list small" aria-label=${t('eventMerge.roles')}>
      ${event.roles.map((r) => html`<li key=${r.id}>${r.person.displayName} · ${t(`role.${r.role}`)}${r.roleDetail ? `: ${r.roleDetail}` : ''}</li>`)}
    </ul>
    <p class="small muted" data-testid=${`${testid}-citations`}>${t('eventMerge.citations', { count: event.citations.length })}</p>
    <ul class="plain-list small">
      ${event.citations.map((c) => html`<li key=${c.id}>${c.sourceTitle}${c.page ? `, ${c.page}` : ''}</li>`)}
    </ul>
  </div>`;
}

/**
 * The offer for one pair: "Same Event?", then both Events side by side and the merge.
 * @param {{ pair: { keepId: string, mergeId: string }, onMerged: () => void }} props
 */
export function EventMergeOffer({ pair, onMerged }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState(/** @type {[EventDetail, EventDetail] | null} */ (null));
  const [keepFirst, setKeepFirst] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ text: '', error: false });
  // Bumped to read both Events again, after one of them changed meanwhile.
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    Promise.all([getEvent(pair.keepId, controller.signal), getEvent(pair.mergeId, controller.signal)]).then(
      (both) => !controller.signal.aborted && setEvents(both),
      (/** @type {unknown} */ error) => !controller.signal.aborted && setStatus({ text: errorText(error), error: true }),
    );
    return () => controller.abort();
  }, [open, pair.keepId, pair.mergeId, round]);

  const merge = async () => {
    if (!events) return;
    const [keep, gone] = keepFirst ? events : [events[1], events[0]];
    setBusy(true);
    setStatus({ text: '', error: false });
    try {
      await mergeEvents(keep.id, { mergeId: gone.id, keepBaseVersion: keep.version, mergeBaseVersion: gone.version, note: note.trim() || null });
      setStatus({ text: t('eventMerge.done'), error: false });
      onMerged();
    } catch (error) {
      setStatus({ text: mergeErrorText(error), error: true });
      // Show the two Events as they are now, so the Editor sees what changed before trying again.
      if (error instanceof ApiError && error.code === 'conflict') setRound((r) => r + 1);
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return html`<div class="event-merge-offer" data-testid="event-merge-offer">
      <button type="button" class="link-button" data-testid="event-merge-open" onClick=${() => setOpen(true)}>${t('eventMerge.open')}</button>
    </div>`;
  return html`<section class="card event-merge" data-testid="event-merge" aria-label=${t('eventMerge.title')}>
    <h3>${t('eventMerge.title')}</h3>
    <p class="muted small">${t('eventMerge.help')}</p>
    ${
      events
        ? html`<div class="merge-sides">
              <${Side} event=${events[0]} name=${`keep-${pair.mergeId}`} chosen=${keepFirst} onChoose=${() => setKeepFirst(true)} testid="event-merge-first" />
              <${Side}
                event=${events[1]}
                name=${`keep-${pair.mergeId}`}
                chosen=${!keepFirst}
                onChoose=${() => setKeepFirst(false)}
                testid="event-merge-second"
              />
            </div>
            <label class="field">
              <span>${t('eventMerge.note')}</span>
              <textarea
                rows="2"
                data-testid="event-merge-note"
                value=${note}
                onInput=${(/** @type {InputEvent} */ e) => setNote(/** @type {HTMLTextAreaElement} */ (e.currentTarget).value)}
              ></textarea>
            </label>
            <div class="actions">
              <button type="button" class="button primary" data-testid="event-merge-yes" disabled=${busy} onClick=${() => void merge()}>
                ${t('eventMerge.button')}
              </button>
              <button type="button" class="button" data-testid="event-merge-cancel" onClick=${() => setOpen(false)}>${t('eventMerge.cancel')}</button>
            </div>`
        : status.error
          ? null
          : html`<p class="muted">${t('work.loading')}</p>`
    }
    <p class=${`form-status${status.error ? ' error' : ''}`} role="status" data-testid="event-merge-status">${status.text}</p>
  </section>`;
}
