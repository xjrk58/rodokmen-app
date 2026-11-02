// Pieces the Research lead screens share (leads-screen.js, lead-screen.js): the status chip,
// where to look on one line, the fields of a lead, a DOM picker inside a Preact screen, and a
// lead's Persons, Place and register as the Proposal forms take them.

import { t } from './i18n.js';
import { personText } from './pickers.js';
import { html, useEffect, useRef } from './ui.js';

/** @typedef {import('./types.js').LeadView} LeadView */
/** @typedef {import('./types.js').LeadStatus} LeadStatus */
/** @typedef {import('./proposal-build.js').PersonInput} PersonInput */
/** @typedef {import('./proposal-build.js').PlaceChoice} PlaceChoice */
/** @typedef {import('./proposal-build.js').SourceChoice} SourceChoice */

/** @param {{ status: LeadStatus }} props */
export const StatusChip = ({ status }) =>
  html`<span class=${`chip lead-status ${status}`} data-testid="lead-status" data-status=${status}>${t(`leads.status.${status}`)}</span>`;

/** @param {{ from: number, to: number } | null} years */
export const yearsText = (years) => (years ? (years.from === years.to ? String(years.from) : `${years.from}–${years.to}`) : '');

/** Where to look, on one line: register or archive, years, pages. @param {Pick<LeadView, 'source' | 'archive' | 'years' | 'pages'>} l */
export function whereText(l) {
  return [l.source?.title ?? l.archive ?? '', yearsText(l.years), l.pages ? t('leads.pagesOf', { pages: l.pages }) : ''].filter(Boolean).join(' · ');
}

/**
 * A DOM control (the record pickers of src/pickers.js) inside a Preact screen, made once.
 * @param {{ make: () => HTMLElement }} props
 */
export function DomSlot({ make }) {
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    el.replaceChildren(make());
    return () => el.replaceChildren();
    // Made once: the control keeps its own state and reports it through its callbacks.
  }, []);
  return html`<div ref=${ref}></div>`;
}

/**
 * The fields of a lead to write or edit: question, reason and where to look.
 * @param {{ value: LeadForm, onChange: (v: LeadForm) => void }} props
 */
export function LeadFields({ value, onChange }) {
  /** @param {keyof LeadForm} key */
  const bind = (key) => (/** @type {Event} */ e) => onChange({ ...value, [key]: /** @type {HTMLInputElement} */ (e.currentTarget).value });
  return html`
    <label class="field"
      ><span>${t('leads.question')}</span><input type="text" data-testid="lead-question-input" value=${value.question} onInput=${bind('question')}
    /></label>
    <label class="field"
      ><span>${t('leads.reason')}</span><textarea rows="3" data-testid="lead-reason-input" value=${value.reason} onInput=${bind('reason')}></textarea>
    </label>
    <label class="field"
      ><span>${t('leads.archive')}</span><input type="text" data-testid="lead-archive-input" value=${value.archive} onInput=${bind('archive')}
    /></label>
    <div class="field-row">
      <label class="field"
        ><span>${t('leads.from')}</span><input type="number" data-testid="lead-from-input" value=${value.from} onInput=${bind('from')}
      /></label>
      <label class="field"><span>${t('leads.to')}</span><input type="number" data-testid="lead-to-input" value=${value.to} onInput=${bind('to')} /></label>
      <label class="field"
        ><span>${t('leads.pages')}</span><input type="text" data-testid="lead-pages-input" value=${value.pages} onInput=${bind('pages')}
      /></label>
    </div>
  `;
}

/** @typedef {{ question: string, reason: string, archive: string, from: string, to: string, pages: string }} LeadForm */

/** @param {LeadForm} f */
export const formFields = (f) => ({
  question: f.question.trim(),
  reason: f.reason.trim(),
  archive: f.archive.trim() || null,
  years: f.from && f.to ? { from: Number(f.from), to: Number(f.to) } : null,
  pages: f.pages.trim() || null,
});

/**
 * A lead's Persons, Place and register as the Proposal forms take them, for "Start from this lead".
 * @param {LeadView} lead
 */
export function leadStart(lead) {
  /** @type {PersonInput[]} */
  const persons = lead.persons.map((p) => ({ mode: 'existing', id: p.id, version: p.version, label: personText(p.given, p.surname, p.birth) }));
  /** @type {PlaceChoice | null} */
  const place = lead.places[0] ? { id: lead.places[0].id, label: lead.places[0].name } : null;
  /** @type {SourceChoice | null} */
  const source = lead.source ? { id: lead.source.id, label: lead.source.title } : null;
  return { persons, place, source };
}
