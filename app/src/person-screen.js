// The person page (family-view spec, "Person page"): all Names, the Events the Person took part
// in with their Role, Place or House and date, the Families as partner and as child, and each
// Citation with its confidence and images. It offers "Show in tree", the life path on the map,
// "Propose a change" and the record's history, and to the Owner marking a Family root. Its Research
// leads and suggested leads follow (research-leads spec, "Leads where people look"). It renders
// from the device first and refreshes when online, with "as of" when the copy shown is not fresh.

import { getCitation, getPerson, setFamilyRoot } from './api.js';
import { lifeYears } from './hourglass-layout.js';
import { has, t } from './i18n.js';
import { PersonLeads } from './leads-screen.js';
import { lifeAddress, personAddress, treeAddress } from './routes.js';
import { AsOf, ErrorLine, errorText, Marks, personMarks, PersonLine, useCachedLoad } from './screen-parts.js';
import { html, useState } from './ui.js';

/** @typedef {import('./types.js').PersonDetail} PersonDetail */
/** @typedef {import('./types.js').CitationSummary} CitationSummary */
/** @typedef {import('./types.js').CitationDetail} CitationDetail */
/** @typedef {import('./types.js').EventSummary} EventSummary */

/**
 * One Citation: the Source, page and confidence; tapped, its transcription and page images.
 * @param {{ citation: CitationSummary, cache: boolean }} props
 */
function Citation({ citation, cache }) {
  const [open, setOpen] = useState(false);
  const loaded = useCachedLoad(open ? `citation:${citation.id}` : null, (signal) => getCitation(citation.id, signal), cache);
  /** @type {CitationDetail | null} */
  const d = loaded.data;
  return html`<li class="citation-item" data-testid="citation">
    <button type="button" class="link-button citation-head" aria-expanded=${open ? 'true' : 'false'} onClick=${() => setOpen(!open)}>
      <span>${citation.sourceTitle}${citation.page ? `, ${/^\d/.test(citation.page) ? t('person.page', { page: citation.page }) : citation.page}` : ''}</span>
      <span class=${`chip confidence ${citation.confidence}`} data-testid="confidence"
        >${t('person.confidence', { confidence: t(`confidence.${citation.confidence}`) })}</span
      >
    </button>
    ${
      open
        ? html`<div class="citation-detail" data-testid="citation-detail">
            <${ErrorLine} error=${loaded.error} />
            ${d?.transcription ? html`<blockquote>${d.transcription}</blockquote>` : null}
            ${
              d && d.images.length
                ? html`<div class="photos">
                    ${d.images.map(
                      (img) =>
                        html`<a href=${img.url} target="_blank" rel="noopener noreferrer"
                          ><img class="thumb" src=${img.url} alt=${img.caption ?? t('person.pageImage')} loading="lazy"
                        /></a>`,
                    )}
                  </div>`
                : null
            }
            ${d && !d.images.length ? html`<p class="muted small">${t('person.noImages')}</p>` : null}
          </div>`
        : null
    }
  </li>`;
}

/** @param {{ citations: CitationSummary[], cache: boolean }} props */
function Citations({ citations, cache }) {
  if (!citations.length) return html`<p class="muted small">${t('person.noCitation')}</p>`;
  return html`<ul class="citations">
    ${citations.map((c) => html`<${Citation} key=${c.id} citation=${c} cache=${cache} />`)}
  </ul>`;
}

/** Where an Event happened: its Place, and the House with its number then. @param {EventSummary} e */
function where(e) {
  const place = e.place?.name ?? '';
  if (e.house?.number) return t('person.atHouse', { place, number: e.house.number });
  return place;
}

/** @param {{ person: PersonDetail, cache: boolean }} props */
function Events({ person, cache }) {
  if (!person.events.length) return html`<p class="muted">${t('person.noEvents')}</p>`;
  return html`<ol class="events">
    ${person.events.map(
      (e) =>
        html`<li class="card event" key=${e.roleId} data-testid="person-event" data-event=${e.event.id}>
          <header class="card-head">
            <strong>${t(`eventType.${e.event.type}`)}${e.event.typeDetail ? ` (${e.event.typeDetail})` : ''}</strong>
            <span class="chip" data-testid="role">${t(`role.${e.role}`)}${e.roleDetail ? `: ${e.roleDetail}` : ''}</span>
          </header>
          <p class="small">${[e.event.date, where(e.event)].filter(Boolean).join(' · ')}</p>
          ${e.event.description ? html`<p class="small muted">${e.event.description}</p>` : null}
          <${Citations} citations=${e.citations} cache=${cache} />
        </li>`,
    )}
  </ol>`;
}

/** The language of a Name in words, or its tag when the app has no name for it. @param {string} tag */
const languageLabel = (tag) => (has(`language.${tag}`) ? t(`language.${tag}`) : tag);

/** @param {{ person: PersonDetail, cache: boolean }} props */
function Names({ person, cache }) {
  return html`<ul class="names">
    ${person.names.map(
      (n) =>
        html`<li key=${n.id} data-testid="person-name">
          <span class="name-as-found">${n.asFound}</span>
          <span class="muted small" data-testid="name-kind">
            · ${t(`nameType.${n.type}`)}${n.language ? ` · ${languageLabel(n.language)}` : ''}${n.primary ? ` · ${t('person.primaryName')}` : ''}</span
          >
          ${n.citations.length ? html`<${Citations} citations=${n.citations} cache=${cache} />` : null}
        </li>`,
    )}
  </ul>`;
}

/** @param {{ person: PersonDetail }} props */
function Families({ person }) {
  const asChild = person.familiesAsChild.map(
    (f) =>
      html`<li key=${f.id} data-testid="family-as-child">
        ${t(f.linkType === 'birth' ? 'person.childOf' : `person.childOf.${f.linkType}`)}:
        ${f.partners.length ? f.partners.map((p, i) => html`${i ? ' & ' : ''}<${PersonLine} person=${p} href=${personAddress(p.id)} />`) : t('person.unknownParents')}
      </li>`,
  );
  const asPartner = person.familiesAsPartner.map(
    (f) =>
      html`<li key=${f.id} data-testid="family-as-partner">
        ${f.partner ? html`${t('person.with')} <${PersonLine} person=${f.partner} href=${personAddress(f.partner.id)} />` : t('person.unknownPartner')}
        ${
          f.children.length
            ? html`<ul class="children">
                ${f.children.map(
                  (c) =>
                    html`<li key=${c.linkId}>
                      <${PersonLine}
                        person=${c.person}
                        href=${personAddress(c.person.id)}
                      />${c.linkType !== 'birth' ? html` <span class="chip">${t(`linkType.${c.linkType}`)}</span>` : null}
                    </li>`,
                )}
              </ul>`
            : null
        }
      </li>`,
  );
  if (!asChild.length && !asPartner.length) return html`<p class="muted">${t('person.noFamilies')}</p>`;
  return html`<ul class="families">
    ${asChild}${asPartner}
  </ul>`;
}

/**
 * The Owner marks or unmarks the Person as a Family root (tree-model spec, "Family roots").
 * @param {{ person: PersonDetail, done: () => Promise<void> }} props
 */
function FamilyRootButton({ person, done }) {
  const [status, setStatus] = useState({ text: '', error: false });
  const toggle = async () => {
    setStatus({ text: '', error: false });
    try {
      await setFamilyRoot(person.id, !person.familyRoot);
      await done();
      setStatus({ text: person.familyRoot ? t('person.rootRemoved') : t('person.rootMarked'), error: false });
    } catch (error) {
      setStatus({ text: errorText(error), error: true });
    }
  };
  return html`<button
      type="button"
      class="button"
      data-testid="family-root-toggle"
      aria-pressed=${person.familyRoot ? 'true' : 'false'}
      onClick=${() => void toggle()}
    >
      ${person.familyRoot ? t('person.unmarkRoot') : t('person.markRoot')}
    </button>
    <p class=${`form-status${status.error ? ' error' : ''}`} role="status" data-testid="family-root-status">${status.text}</p>`;
}

/** @param {{ id: string, cache: boolean, me?: import('./types.js').Me | null, refreshMe?: () => Promise<void> }} props */
export function PersonScreen({ id, cache, me = null, refreshMe }) {
  const loaded = useCachedLoad(`person:${id}`, (signal) => getPerson(id, signal), cache);
  /** @type {PersonDetail | null} */
  const person = loaded.data?.id === id ? loaded.data : null;
  if (!person) {
    return html`<section class="screen-body" data-testid="person-screen">
      ${loaded.error ? html`<p class="form-status error" role="alert" data-testid="screen-error">${errorText(loaded.error)}</p>` : html`<p class="empty">${t('work.loading')}</p>`}
    </section>`;
  }
  const primary = person.names.find((n) => n.primary) ?? person.names[0];
  const name = primary ? `${primary.given} ${primary.surname}`.trim() : '';
  const birth = person.events.find((e) => e.role === 'child' && (e.event.type === 'birth' || e.event.type === 'baptism'))?.event.date ?? null;
  const death = person.events.find((e) => e.role === 'deceased')?.event.date ?? null;
  const marks = personMarks(person);
  return html`<section class="screen-body person-page" data-testid="person-screen" data-id=${person.id}>
    <header class="person-head">
      ${person.portraits[0] ? html`<img class="portrait" src=${person.portraits[0].url} alt="" />` : null}
      <div>
        <h1 data-testid="person-title">${name}</h1>
        <p class="muted">${lifeYears({ birth, death })} <${Marks} marks=${marks} /></p>
      </div>
    </header>
    <${AsOf} asOf=${loaded.asOf} />
    <${ErrorLine} error=${loaded.asOf ? null : loaded.error} />
    ${
      person.labels.length
        ? html`<ul class="chips" data-testid="person-labels" aria-label=${t('person.labels')}>
            ${person.labels.map((l) => html`<li class="chip" data-testid="person-label" key=${l}>${l}</li>`)}
          </ul>`
        : null
    }
    <nav class="person-actions">
      <a class="button primary" href=${treeAddress(person.id)} data-testid="show-in-tree">${t('people.showInTree')}</a>
      <a class="button" href=${lifeAddress(person.id)} data-testid="life-path">${t('person.lifePath')}</a>
      <a class="button" href=${`#work/propose/correction/${person.id}`} data-testid="propose-change">${t('person.propose')}</a>
      <a class="button" href=${`#work/history/person/${person.id}`} data-testid="history">${t('person.history')}</a>
      <a class="button" href=${`#work/propose/notes/${person.id}`} data-testid="edit-notes">${t('person.editNotes')}</a>
      ${
        me?.permissions.markFamilyRoots
          ? html`<${FamilyRootButton}
              person=${person}
              done=${async () => {
                loaded.reload();
                await refreshMe?.();
              }}
            />`
          : null
      }
    </nav>
    ${
      person.notes
        ? html`<h2>${t('person.notes')}</h2>
            <div class="research-notes" data-testid="person-notes">${person.notes}</div>`
        : null
    }
    <h2>${t('person.names')}</h2>
    <${Names} person=${person} cache=${cache} />
    <h2>${t('person.events')}</h2>
    <${Events} person=${person} cache=${cache} />
    <h2>${t('person.families')}</h2>
    <${Families} person=${person} />
    <${PersonLeads} personId=${person.id} me=${me} cache=${cache} />
  </section>`;
}
