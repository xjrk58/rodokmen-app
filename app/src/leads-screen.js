// Research leads in the app (research-leads spec): the Leads list, filtered by status, Place,
// archive and who is working on them; suggested leads, shown apart from the leads until a Member
// accepts or dismisses them; and the leads of a Person on their page and of a Place on its sheet
// ("Leads where people look"). A lead's own page and writing one are lead-screen.js. Leads need
// no review: they are plans, not facts.

import { acceptSuggestion, dismissSuggestion, listLeads, listSuggestions } from './api.js';
import { loadThrough } from './cache.js';
import { h } from './dom.js';
import { language, t } from './i18n.js';
import { DomSlot, StatusChip, whereText } from './lead-parts.js';
import { placePicker } from './pickers.js';
import { leadAddress } from './routes.js';
import { AsOf, ErrorLine, errorText, useCachedLoad, useDebounced } from './screen-parts.js';
import { html, useState } from './ui.js';

/** @typedef {import('./types.js').Me} Me */
/** @typedef {import('./types.js').LeadView} LeadView */
/** @typedef {import('./types.js').LeadSuggestion} LeadSuggestion */
/** @typedef {import('./types.js').LeadStatus} LeadStatus */
/** @typedef {import('./proposal-build.js').PlaceChoice} PlaceChoice */

/** @type {LeadStatus[]} */
const STATUSES = ['open', 'in_progress', 'found', 'not_found'];

/** @param {{ lead: LeadView }} props */
export function LeadItem({ lead }) {
  const where = whereText(lead);
  return html`<li class="card lead-item" data-testid="lead" data-id=${lead.id}>
    <header class="card-head">
      <a href=${leadAddress(lead.id)} data-testid="lead-question">${lead.question}</a>
      <${StatusChip} status=${lead.status} />
    </header>
    ${where ? html`<p class="small muted">${where}</p>` : null}
    ${
      lead.persons.length || lead.places.length
        ? html`<p class="small">${[...lead.persons.map((p) => p.displayName), ...lead.places.map((p) => p.name)].join(', ')}</p>`
        : null
    }
    ${lead.assignee ? html`<p class="small muted">${t('leads.assignee', { name: lead.assignee.displayName })}</p>` : null}
    ${lead.searches.length ? html`<p class="small muted" data-testid="lead-search-count">${t('leads.searchCount', { count: lead.searches.length })}</p>` : null}
  </li>`;
}

/**
 * One suggested lead, with Accept and Dismiss for a Member.
 * @param {{ suggestion: LeadSuggestion, me: Me, done: () => void }} props
 */
function SuggestionItem({ suggestion, me, done }) {
  const [status, setStatus] = useState({ text: '', error: false });
  const lang = language() === 'cs' ? 'cs' : 'en';
  /** @param {() => Promise<unknown>} action @param {string} [message] */
  const act = async (action, message) => {
    setStatus({ text: '', error: false });
    try {
      const out = await action();
      if (message) setStatus({ text: message, error: false });
      done();
      return out;
    } catch (error) {
      setStatus({ text: errorText(error), error: true });
      return null;
    }
  };
  return html`<li class="card suggestion" data-testid="suggestion" data-id=${suggestion.id} data-kind=${suggestion.kind}>
    <p data-testid="suggestion-question"><strong>${suggestion.question[lang]}</strong></p>
    <p class="small muted">${suggestion.reason[lang]}</p>
    ${suggestion.archive && !suggestion.source ? html`<p class="small">${t('leads.lookIn', { archive: suggestion.archive })}</p>` : null}
    ${
      me.permissions.decideSuggestions
        ? html`<div class="form-actions">
            <button
              type="button"
              class="link-button"
              data-testid="suggestion-dismiss"
              onClick=${() => void act(() => dismissSuggestion(suggestion.id), t('leads.dismissed'))}
            >
              ${t('leads.dismiss')}
            </button>
            <button
              type="button"
              class="button primary small"
              data-testid="suggestion-accept"
              onClick=${() =>
                void act(async () => {
                  const lead = await acceptSuggestion(suggestion.id);
                  location.hash = leadAddress(lead.id);
                })}
            >
              ${t('leads.accept')}
            </button>
          </div>`
        : null
    }
    <p class=${`form-status${status.error ? ' error' : ''}`} role="status">${status.text}</p>
  </li>`;
}

/**
 * Suggested leads, for a Person or for everyone.
 * @param {{ me: Me, personId?: string | null }} props
 */
export function Suggestions({ me, personId = null }) {
  const loaded = useCachedLoad(`lead-suggestions:${personId ?? 'all'}`, (signal) => listSuggestions({ personId, limit: 20 }, signal), false);
  const items = loaded.data?.items ?? [];
  if (!items.length && !loaded.error) return null;
  return html`<section class="suggestions" data-testid="suggestions">
    <h2>${t('leads.suggested')}</h2>
    <p class="muted small">${t('leads.suggestedHint')}</p>
    <${ErrorLine} error=${loaded.error} />
    <ul class="lead-list">
      ${items.map((s) => html`<${SuggestionItem} key=${s.id} suggestion=${s} me=${me} done=${() => loaded.reload()} />`)}
    </ul>
  </section>`;
}

// ---------------------------------------------------------------- the Leads list

/**
 * The Leads list (research-leads spec, "Leads where people look"), with its filters and the suggested leads.
 * @param {{ me: Me, place: string | null, cache: boolean }} props
 */
export function LeadsScreen({ me, place, cache }) {
  const [status, setStatus] = useState('open,in_progress');
  const [archive, setArchive] = useState('');
  const [assignee, setAssignee] = useState('');
  const [placeFilter, setPlaceFilter] = useState(/** @type {PlaceChoice | null} */ (place ? { id: place, label: '' } : null));
  const [limit, setLimit] = useState(50);
  const settledArchive = useDebounced(archive.trim(), 300);
  const placeId = placeFilter?.id ?? null;
  const key = `leads:${status}:${placeId ?? ''}:${settledArchive}:${assignee}:${limit}`;
  const loaded = useCachedLoad(
    key,
    (signal) => listLeads({ status: status || null, placeId, archive: settledArchive || null, assigneeId: assignee || null, limit }, signal),
    cache,
  );
  const items = loaded.data?.items ?? [];
  const placeName = placeFilter?.label || items.flatMap((l) => l.places).find((p) => p.id === placeId)?.name || '';
  return html`<section class="screen-body leads-screen" data-testid="leads-screen">
    <header class="screen-head">
      <h1>${t('leads.title')}</h1>
      ${me.permissions.writeLeads ? html`<a class="button primary" href=${placeId ? `#leads/new/place/${placeId}` : '#leads/new'} data-testid="write-lead">${t('leads.write')}</a>` : null}
    </header>
    <form class="lead-filters" onSubmit=${(/** @type {Event} */ e) => e.preventDefault()}>
      <label class="field">
        <span>${t('leads.filter.status')}</span>
        <select
          data-testid="filter-status"
          value=${status}
          onChange=${(/** @type {Event} */ e) => setStatus(/** @type {HTMLSelectElement} */ (e.currentTarget).value)}
        >
          <option value="open,in_progress">${t('leads.filter.active')}</option>
          <option value="">${t('leads.filter.all')}</option>
          ${STATUSES.map((s) => html`<option value=${s}>${t(`leads.status.${s}`)}</option>`)}
        </select>
      </label>
      <label class="field">
        <span>${t('leads.filter.archive')}</span>
        <input
          type="search"
          data-testid="filter-archive"
          value=${archive}
          onInput=${(/** @type {Event} */ e) => setArchive(/** @type {HTMLInputElement} */ (e.currentTarget).value)}
        />
      </label>
      <label class="field">
        <span>${t('leads.filter.assignee')}</span>
        <select
          data-testid="filter-assignee"
          value=${assignee}
          onChange=${(/** @type {Event} */ e) => setAssignee(/** @type {HTMLSelectElement} */ (e.currentTarget).value)}
        >
          <option value="">${t('leads.filter.anyone')}</option>
          <option value=${me.id}>${t('leads.filter.me')}</option>
        </select>
      </label>
      ${
        placeFilter
          ? html`<p class="small" data-testid="filter-place">
              ${t('leads.filter.place', { place: placeName })}
              <button type="button" class="link-button" data-testid="filter-place-clear" onClick=${() => setPlaceFilter(null)}>
                ${t('leads.filter.clearPlace')}
              </button>
            </p>`
          : html`<${DomSlot} make=${() => placePicker({ value: null, testid: 'filter-place-picker', onChange: (v) => setPlaceFilter(v) })} />`
      }
    </form>
    <${AsOf} asOf=${loaded.asOf} />
    <${ErrorLine} error=${loaded.error} />
    <ul class="lead-list" data-testid="leads" aria-busy=${loaded.loading ? 'true' : 'false'}>
      ${items.map((l) => html`<${LeadItem} key=${l.id} lead=${l} />`)}
    </ul>
    ${!loaded.loading && !loaded.error && items.length === 0 ? html`<p class="empty" data-testid="no-leads">${t('leads.none')}</p>` : null}
    ${loaded.data && loaded.data.total > items.length ? html`<button type="button" class="button" onClick=${() => setLimit(limit + 50)}>${t('leads.more')}</button>` : null}
    <${Suggestions} me=${me} />
  </section>`;
}

// ---------------------------------------------------------------- on a person page and a place sheet

/**
 * The leads of a Person, and the leads suggested for them, on their page.
 * @param {{ personId: string, me: Me | null, cache: boolean }} props
 */
export function PersonLeads({ personId, me, cache }) {
  const loaded = useCachedLoad(`leads:person:${personId}`, (signal) => listLeads({ personId, limit: 50 }, signal), cache);
  const items = loaded.data?.items ?? [];
  return html`<section class="person-leads" data-testid="person-leads">
    <h2>${t('leads.title')}</h2>
    <${ErrorLine} error=${loaded.error} />
    ${
      items.length
        ? html`<ul class="lead-list">
            ${items.map((l) => html`<${LeadItem} key=${l.id} lead=${l} />`)}
          </ul>`
        : null
    }
    ${!loaded.loading && !loaded.error && !items.length ? html`<p class="muted small" data-testid="no-person-leads">${t('leads.noneHere')}</p>` : null}
    ${me?.permissions.writeLeads ? html`<a class="button" href=${`#leads/new/person/${personId}`} data-testid="person-write-lead">${t('leads.write')}</a>` : null}
    ${me ? html`<${Suggestions} me=${me} personId=${personId} />` : null}
  </section>`;
}

/**
 * The leads of a Place on its sheet (research-leads spec, scenario "Village sheet"): each with
 * its question and status, and links to write one and to all of them. Plain DOM, as the sheet is.
 * @param {string} placeId
 * @param {{ cache: boolean, writeLeads: boolean }} o
 * @returns {HTMLElement}
 */
export function placeLeads(placeId, o) {
  const list = h('div', {}, h('p', { class: 'muted small' }, t('work.loading')));
  const section = h(
    'section',
    { class: 'place-leads', 'data-testid': 'place-leads' },
    h('h3', {}, t('leads.title')),
    list,
    h(
      'p',
      { class: 'small' },
      h('a', { href: `#leads/place/${placeId}`, 'data-testid': 'place-leads-all' }, t('leads.allHere')),
      ...(o.writeLeads ? [' · ', h('a', { href: `#leads/new/place/${placeId}`, 'data-testid': 'place-write-lead' }, t('leads.writeHere'))] : []),
    ),
  );
  loadThrough(
    `leads:place:${placeId}`,
    () => listLeads({ placeId, status: 'open,in_progress', limit: 20 }),
    (data) => {
      list.replaceChildren(
        data.items.length
          ? h(
              'ul',
              { class: 'link-list' },
              ...data.items.map((l) =>
                h(
                  'li',
                  { 'data-testid': 'place-lead', 'data-id': l.id },
                  h('a', { href: leadAddress(l.id) }, l.question),
                  ' ',
                  h('span', { class: `chip lead-status ${l.status}`, 'data-testid': 'lead-status', 'data-status': l.status }, t(`leads.status.${l.status}`)),
                ),
              ),
            )
          : h('p', { class: 'muted small' }, t('leads.noneHere')),
      );
    },
    { cache: o.cache },
  ).catch((error) => list.replaceChildren(h('p', { class: 'form-status error' }, errorText(error))));
  return section;
}
