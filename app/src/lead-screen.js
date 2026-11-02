// A Research lead's page (research-leads spec): what it asks and why, where to look, the Persons
// and Places it concerns, its search records and history; editing it, recording a search and
// closing it ("What was searched is recorded": not found only with a search); and "Start from this
// lead" into the Proposal forms, whose Proposal names the lead it answers ("Findings link back to
// leads"). Writing a new lead is here too.

import { addSearch, closeLead, createLead, getLead, updateLead } from './api.js';
import { t } from './i18n.js';
import { DomSlot, formFields, LeadFields, StatusChip, whereText, yearsText } from './lead-parts.js';
import { personPicker, placePicker, sourcePicker } from './pickers.js';
import { KINDS } from './proposal-build.js';
import { leadAddress, personAddress } from './routes.js';
import { errorText, formatTime, PersonLine } from './screen-parts.js';
import { html, useEffect, useRef, useState } from './ui.js';

/** @typedef {import('./types.js').Me} Me */
/** @typedef {import('./types.js').LeadView} LeadView */
/** @typedef {import('./types.js').LeadDetail} LeadDetail */
/** @typedef {import('./types.js').SearchRecordView} SearchRecordView */
/** @typedef {import('./lead-parts.js').LeadForm} LeadForm */
/** @typedef {import('./proposal-build.js').PersonInput} PersonInput */
/** @typedef {import('./proposal-build.js').PlaceChoice} PlaceChoice */
/** @typedef {import('./proposal-build.js').SourceChoice} SourceChoice */

/** @param {{ search: SearchRecordView }} props */
function SearchItem({ search }) {
  const where = [search.source?.title ?? search.archive ?? '', yearsText(search.years), search.pages ? t('leads.pagesOf', { pages: search.pages }) : '']
    .filter(Boolean)
    .join(' · ');
  return html`<li class="search-record" data-testid="search-record">
    <p>
      <strong>${where}</strong>
      <span class=${`chip ${search.found ? 'status-accepted' : 'status-rejected'}`} data-testid="search-result"
        >${search.found ? t('leads.searchFound') : t('leads.searchNotFound')}</span
      >
    </p>
    <p class="small muted">${t('leads.searchedBy', { who: search.searchedBy, when: search.searchedOn })}</p>
    ${search.note ? html`<p class="small">${search.note}</p>` : null}
  </li>`;
}

/**
 * The search form: what was searched, with "Record" and, to close at once, "Record and close as not found".
 * @param {{ lead: LeadDetail, done: (lead: LeadDetail) => void }} props
 */
function SearchForm({ lead, done }) {
  const [archive, setArchive] = useState(lead.source ? '' : (lead.archive ?? ''));
  const [useRegister, setUseRegister] = useState(lead.source !== null);
  const [from, setFrom] = useState(lead.years ? String(lead.years.from) : '');
  const [to, setTo] = useState(lead.years ? String(lead.years.to) : '');
  const [pages, setPages] = useState(lead.pages ?? '');
  const [found, setFound] = useState(false);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState({ text: '', error: false });
  const body = () => ({
    sourceId: useRegister && lead.source ? lead.source.id : null,
    archive: useRegister && lead.source ? null : archive.trim() || null,
    years: from && to ? { from: Number(from), to: Number(to) } : null,
    pages: pages.trim() || null,
    found,
    note: note.trim() || null,
  });
  /** @param {boolean} close */
  const send = async (close) => {
    setStatus({ text: '', error: false });
    try {
      done(close ? await closeLead(lead.id, { baseVersion: lead.version, status: 'not_found', search: body() }) : await addSearch(lead.id, body()));
      setNote('');
      setStatus({ text: t('leads.saved'), error: false });
    } catch (error) {
      setStatus({ text: errorText(error), error: true });
    }
  };
  /** @param {(v: string) => void} set */
  const input = (set) => (/** @type {Event} */ e) => set(/** @type {HTMLInputElement} */ (e.currentTarget).value);
  return html`<form class="form-section search-form" data-testid="search-form" onSubmit=${(/** @type {Event} */ e) => e.preventDefault()}>
    <h3>${t('leads.recordSearch')}</h3>
    ${
      lead.source
        ? html`<label class="switch-row"
            ><input
              type="checkbox"
              data-testid="search-use-register"
              checked=${useRegister}
              onChange=${(/** @type {Event} */ e) => setUseRegister(/** @type {HTMLInputElement} */ (e.currentTarget).checked)}
            /><span>${t('leads.searchRegister', { title: lead.source.title })}</span></label
          >`
        : null
    }
    ${
      !useRegister || !lead.source
        ? html`<label class="field"
            ><span>${t('leads.archive')}</span><input type="text" data-testid="search-archive" value=${archive} onInput=${input(setArchive)}
          /></label>`
        : null
    }
    <div class="field-row">
      <label class="field"><span>${t('leads.from')}</span><input type="number" data-testid="search-from" value=${from} onInput=${input(setFrom)} /></label>
      <label class="field"><span>${t('leads.to')}</span><input type="number" data-testid="search-to" value=${to} onInput=${input(setTo)} /></label>
      <label class="field"><span>${t('leads.pages')}</span><input type="text" data-testid="search-pages" value=${pages} onInput=${input(setPages)} /></label>
    </div>
    <label class="switch-row"
      ><input
        type="checkbox"
        data-testid="search-found"
        checked=${found}
        onChange=${(/** @type {Event} */ e) => setFound(/** @type {HTMLInputElement} */ (e.currentTarget).checked)}
      /><span>${t('leads.searchFoundBox')}</span></label
    >
    <label class="field"
      ><span>${t('leads.searchNote')}</span><textarea rows="2" data-testid="search-note" value=${note} onInput=${input(setNote)}></textarea>
    </label>
    <p class=${`form-status${status.error ? ' error' : ''}`} role="status" data-testid="search-status">${status.text}</p>
    <div class="form-actions">
      <button type="button" class="button" data-testid="search-close-not-found" onClick=${() => void send(true)}>${t('leads.closeNotFound')}</button>
      <button type="button" class="button primary" data-testid="search-add" onClick=${() => void send(false)}>${t('leads.addSearch')}</button>
    </div>
  </form>`;
}

/** "Start from this lead": the Proposal forms, each starting from the lead's Persons, Place and register. @param {{ lead: LeadView }} props */
function StartFromLead({ lead }) {
  return html`<section class="form-section" data-testid="start-from-lead">
    <h3>${t('leads.start')}</h3>
    <p class="muted small">${t('leads.startHint')}</p>
    <div class="kind-grid">
      ${KINDS.map(
        (kind) =>
          html`<a class="kind-card" href=${`#work/lead/${lead.id}/${kind}`} data-testid=${`start-${kind}`}><strong>${t(`propose.kind.${kind}`)}</strong></a>`,
      )}
    </div>
  </section>`;
}

/** What a lead asks and why, where to look, whom and what it concerns, who wrote it and how it ended. @param {{ lead: LeadDetail }} props */
function LeadSummary({ lead }) {
  const where = whereText(lead);
  return html`<header class="lead-head">
      <h1 data-testid="lead-title">${lead.question}</h1>
      <${StatusChip} status=${lead.status} />
    </header>
    <p>${lead.reason}</p>
    ${where ? html`<p data-testid="lead-where"><strong>${t('leads.where')}</strong> ${where}</p>` : null}
    ${
      lead.persons.length
        ? html`<ul class="link-list" data-testid="lead-persons">
            ${lead.persons.map((p) => html`<li key=${p.id}><${PersonLine} person=${p} href=${personAddress(p.id)} /></li>`)}
          </ul>`
        : null
    }
    ${lead.places.length ? html`<p class="small" data-testid="lead-places">${lead.places.map((p) => p.name).join(', ')}</p>` : null}
    <p class="small muted">
      ${t('leads.author', { name: lead.author.displayName })}${lead.author.isAgent ? html` <span class="badge agent">${t('review.agent')}</span>` : null}
      ${lead.assignee ? html` · ${t('leads.assignee', { name: lead.assignee.displayName })}` : null}
    </p>
    ${lead.outcome ? html`<p data-testid="lead-outcome"><strong>${t('leads.outcome')}</strong> ${lead.outcome}</p>` : null}
    ${lead.foundBy ? html`<p class="small" data-testid="lead-found-by">${t('leads.foundBy')}</p>` : null}`;
}

/** @typedef {(action: () => Promise<LeadDetail>) => Promise<boolean>} Act */

/** @param {LeadDetail} lead @returns {LeadForm} */
const formOf = (lead) => ({
  question: lead.question,
  reason: lead.reason,
  archive: lead.archive ?? '',
  from: lead.years ? String(lead.years.from) : '',
  to: lead.years ? String(lead.years.to) : '',
  pages: lead.pages ?? '',
});

/**
 * Taking the lead on (or reopening a closed one), and editing it.
 * @param {{ lead: LeadDetail, me: Me, act: Act }} props
 */
function LeadActions({ lead, me, act }) {
  const [editing, setEditing] = useState(/** @type {LeadForm | null} */ (null));
  const closed = lead.status === 'found' || lead.status === 'not_found';
  const status = closed ? { status: /** @type {const} */ ('open') } : { status: /** @type {const} */ ('in_progress'), assigneeId: me.id };
  return html`<div class="form-actions lead-actions">
      <button
        type="button"
        class="button"
        data-testid=${closed ? 'lead-reopen' : 'lead-work-on-it'}
        onClick=${() => void act(() => updateLead(lead.id, { baseVersion: lead.version, ...status }))}
      >
        ${closed ? t('leads.reopen') : t('leads.workOnIt')}
      </button>
      <button type="button" class="button" data-testid="lead-edit" onClick=${() => setEditing(formOf(lead))}>${t('leads.edit')}</button>
    </div>
    ${
      editing
        ? html`<form class="form-section" data-testid="lead-edit-form" onSubmit=${(/** @type {Event} */ e) => e.preventDefault()}>
            <${LeadFields} value=${editing} onChange=${setEditing} />
            <div class="form-actions">
              <button type="button" class="link-button" onClick=${() => setEditing(null)}>${t('leads.cancel')}</button>
              <button
                type="button"
                class="button primary"
                data-testid="lead-save"
                onClick=${async () => {
                  if (await act(() => updateLead(lead.id, { baseVersion: lead.version, ...formFields(editing) }))) setEditing(null);
                }}
              >
                ${t('leads.save')}
              </button>
            </div>
          </form>`
        : null
    }`;
}

/** Closing a lead as found, with its outcome. @param {{ lead: LeadDetail, act: Act }} props */
function CloseFound({ lead, act }) {
  const [outcome, setOutcome] = useState('');
  return html`<section class="form-section" data-testid="close-found">
    <label class="field"
      ><span>${t('leads.outcome')}</span
      ><textarea
        rows="2"
        data-testid="lead-outcome-input"
        value=${outcome}
        onInput=${(/** @type {Event} */ e) => setOutcome(/** @type {HTMLTextAreaElement} */ (e.currentTarget).value)}
      ></textarea>
    </label>
    <button
      type="button"
      class="button"
      data-testid="lead-close-found"
      onClick=${() => void act(() => closeLead(lead.id, { baseVersion: lead.version, status: 'found', outcome: outcome.trim() || null }))}
    >
      ${t('leads.closeFound')}
    </button>
  </section>`;
}

/** The searches made, newest first. @param {{ lead: LeadDetail }} props */
function Searches({ lead }) {
  return html`<h2>${t('leads.searches')}</h2>
    ${
      lead.searches.length
        ? html`<ul class="search-records" data-testid="search-records">
            ${lead.searches.map((s) => html`<${SearchItem} key=${s.id} search=${s} />`)}
          </ul>`
        : html`<p class="muted small" data-testid="no-searches">${t('leads.noSearches')}</p>`
    }`;
}

/** @param {{ lead: LeadDetail }} props */
function LeadHistory({ lead }) {
  return html`<h2>${t('leads.history')}</h2>
    <ol class="lead-history" data-testid="lead-history">
      ${lead.history.map(
        (c, i) =>
          html`<li key=${i} class="small" data-kind=${c.kind}>${t(`leads.change.${c.kind}`, { name: c.author.displayName, time: formatTime(c.at) })}</li>`,
      )}
    </ol>`;
}

/**
 * A lead's page: what it asks and why, where to look, its searches and history, and what a Member or Agent can do with it.
 * @param {{ id: string, me: Me }} props
 */
export function LeadScreen({ id, me }) {
  const [lead, setLead] = useState(/** @type {LeadDetail | null} */ (null));
  const [error, setError] = useState(/** @type {unknown} */ (null));
  const [status, setStatus] = useState({ text: '', error: false });
  useEffect(() => {
    const controller = new AbortController();
    getLead(id, controller.signal).then(setLead, (e) => {
      if (!controller.signal.aborted) setError(e);
    });
    return () => controller.abort();
  }, [id]);
  if (!lead) {
    return html`<section class="screen-body" data-testid="lead-screen">
      ${error ? html`<p class="form-status error" role="alert" data-testid="screen-error">${errorText(error)}</p>` : html`<p class="empty">${t('work.loading')}</p>`}
    </section>`;
  }
  /** @type {Act} */
  const act = async (action) => {
    setStatus({ text: '', error: false });
    try {
      setLead(await action());
      setStatus({ text: t('leads.saved'), error: false });
      return true;
    } catch (e) {
      setStatus({ text: errorText(e), error: true });
      return false;
    }
  };
  const writable = me.permissions.writeLeads;
  const open = lead.status === 'open' || lead.status === 'in_progress';
  return html`<section class="screen-body lead-page" data-testid="lead-screen" data-id=${lead.id}>
    <${LeadSummary} lead=${lead} />
    <p class=${`form-status${status.error ? ' error' : ''}`} role="status" data-testid="lead-status-line">${status.text}</p>
    ${writable ? html`<${LeadActions} lead=${lead} me=${me} act=${act} />` : null}
    ${writable && open ? html`<${CloseFound} key=${lead.version} lead=${lead} act=${act} />` : null}
    <${Searches} lead=${lead} />
    ${writable && open ? html`<${SearchForm} key=${lead.version} lead=${lead} done=${setLead} />` : null}
    ${me.permissions.propose && open ? html`<${StartFromLead} lead=${lead} />` : null}
    <${LeadHistory} lead=${lead} />
  </section>`;
}

// ---------------------------------------------------------------- writing a lead

/**
 * Writing a lead, perhaps starting from a Person (their page) or a Place (its sheet).
 * @param {{ me: Me, person: string | null, place: string | null }} props
 */
export function NewLeadScreen({ me, person, place }) {
  const [form, setForm] = useState(/** @type {LeadForm} */ ({ question: '', reason: '', archive: '', from: '', to: '', pages: '' }));
  const persons = useRef(/** @type {(PersonInput | null)[]} */ ([null]));
  const places = useRef(/** @type {(PlaceChoice | null)[]} */ ([null]));
  const source = useRef(/** @type {SourceChoice | null} */ (null));
  const [status, setStatus] = useState({ text: '', error: false });
  if (!me.permissions.writeLeads) return html`<section class="screen-body"><p class="empty">${t('family.notFound')}</p></section>`;
  const submit = async () => {
    const fields = formFields(form);
    if (!fields.question || !fields.reason) {
      setStatus({ text: t('leads.needQuestion'), error: true });
      return;
    }
    setStatus({ text: '', error: false });
    try {
      const personIds = [person, ...persons.current.map((p) => (p?.mode === 'existing' ? p.id : null))].filter((x) => x !== null);
      const placeIds = [place, ...places.current.map((p) => p?.id ?? null)].filter((x) => x !== null);
      const lead = await createLead({ ...fields, sourceId: source.current?.id ?? null, personIds: [...new Set(personIds)], placeIds: [...new Set(placeIds)] });
      location.hash = leadAddress(lead.id);
    } catch (error) {
      setStatus({ text: errorText(error), error: true });
    }
  };
  return html`<section class="screen-body" data-testid="new-lead-screen">
    <h1>${t('leads.write')}</h1>
    <p class="muted small">${t('leads.writeHint')}</p>
    <form class="propose-form" data-testid="new-lead-form" onSubmit=${(/** @type {Event} */ e) => e.preventDefault()}>
      <section class="form-section"><${LeadFields} value=${form} onChange=${setForm} /></section>
      <section class="form-section">
        <h3>${t('leads.register')}</h3>
        <${DomSlot} make=${() => sourcePicker({ value: null, testid: 'lead-source', onChange: (v) => (source.current = v) })} />
        ${
          person
            ? html`<p class="small" data-testid="lead-for-person">${t('leads.forPerson')}</p>`
            : html`<${DomSlot}
                make=${() =>
                  personPicker({ value: null, label: t('leads.persons'), testid: 'lead-person', allowNew: false, onChange: (v) => (persons.current[0] = v) })}
              />`
        }
        ${
          place
            ? html`<p class="small" data-testid="lead-for-place">${t('leads.forPlace')}</p>`
            : html`<${DomSlot} make=${() => placePicker({ value: null, testid: 'lead-place', onChange: (v) => (places.current[0] = v) })} />`
        }
      </section>
      <p class=${`form-status${status.error ? ' error' : ''}`} role="status" data-testid="new-lead-status">${status.text}</p>
      <div class="form-actions">
        <button type="button" class="button primary" data-testid="new-lead-submit" onClick=${() => void submit()}>${t('leads.writeSubmit')}</button>
      </div>
    </form>
  </section>`;
}
