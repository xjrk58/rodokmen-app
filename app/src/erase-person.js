// Erasing a Living person (erasure spec, "Owner erases a Living person"): the Owner only, on the
// person page of someone Living. It first shows what goes (the Events only they took part in,
// their Names, Family links, images, leads and the history that becomes "erased record") and
// asks for their name before it erases; it cannot be undone. Afterwards it leaves the page.

import { erasePerson, erasurePreview } from './api.js';
import { t } from './i18n.js';
import { errorText } from './screen-parts.js';
import { html, useEffect, useState } from './ui.js';

/** @typedef {import('./types.js').ErasurePreview} ErasurePreview */

/**
 * The erase section of a person page: only for the Owner, and only when the Person is Living.
 * After the erasure it goes to the People list.
 * @param {{ me: import('./types.js').Me | null, person: import('./types.js').PersonDetail }} props
 */
export function EraseSection({ me, person }) {
  if (!me?.permissions.erase || !person.living) return null;
  return html`<${ErasePerson}
    personId=${person.id}
    onErased=${() => {
      location.hash = '#people';
    }}
  />`;
}

/**
 * @param {{ personId: string, onErased: () => void }} props
 */
function ErasePerson({ personId, onErased }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(/** @type {ErasurePreview | null} */ (null));
  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState({ text: '', error: false });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    erasurePreview(personId, controller.signal).then(
      (p) => !controller.signal.aborted && setPreview(p),
      (/** @type {unknown} */ error) => !controller.signal.aborted && setStatus({ text: errorText(error), error: true }),
    );
    return () => controller.abort();
  }, [open, personId]);

  const erase = async () => {
    setBusy(true);
    setStatus({ text: '', error: false });
    try {
      await erasePerson(personId, typed);
      setStatus({ text: t('erase.done'), error: false });
      onErased();
    } catch (error) {
      setStatus({ text: errorText(error), error: true });
    } finally {
      setBusy(false);
    }
  };

  const named = preview !== null && typed.trim().replace(/\s+/g, ' ').toLocaleLowerCase('cs') === preview.confirmWith.toLocaleLowerCase('cs');
  return html`<section class="card erase-person" data-testid="erase-person">
    <h2>${t('erase.title')}</h2>
    <p class="muted small">${t('erase.intro')}</p>
    ${open ? null : html`<button type="button" class="button" data-testid="erase-open" onClick=${() => setOpen(true)}>${t('erase.open')}</button>`}
    ${
      open && preview
        ? html`<div data-testid="erase-preview">
            <p>${t('erase.what', { name: preview.confirmWith })}</p>
            <ul class="plain-list small">
              <li>${t('erase.counts', { names: preview.names, roles: preview.roles, families: preview.familyLinks })}</li>
              <li>${t('erase.events', { count: preview.events.length })}</li>
              ${preview.events.map(
                (e) =>
                  html`<li key=${e.id} class="muted" data-testid="erase-event">
                    – ${t(`eventType.${e.type}`)}${e.date ? ` ${e.date}` : ''}${e.place ? `, ${e.place.name}` : ''}
                  </li>`,
              )}
              <li>${t('erase.evidence', { citations: preview.citations, images: preview.images })}</li>
              <li>${t('erase.leads', { deleted: preview.leads.deleted, unlinked: preview.leads.unlinked })}</li>
              <li>${t('erase.history', { count: preview.history, pending: preview.pending })}</li>
            </ul>
            <p class="prompt" role="note">${t('erase.final')}</p>
            <label class="field">
              <span>${t('erase.confirm', { name: preview.confirmWith })}</span>
              <input
                type="text"
                autocomplete="off"
                data-testid="erase-confirm"
                value=${typed}
                onInput=${(/** @type {InputEvent} */ e) => setTyped(/** @type {HTMLInputElement} */ (e.currentTarget).value)}
              />
            </label>
            <div class="actions">
              <button type="button" class="button danger" data-testid="erase-yes" disabled=${!named || busy} onClick=${() => void erase()}>
                ${t('erase.yes')}
              </button>
              <button
                type="button"
                class="button"
                data-testid="erase-cancel"
                onClick=${() => {
                  setOpen(false);
                  setTyped('');
                }}
              >
                ${t('erase.cancel')}
              </button>
            </div>
          </div>`
        : null
    }
    <p class=${`form-status${status.error ? ' error' : ''}`} role="status" data-testid="erase-status">${status.text}</p>
  </section>`;
}
