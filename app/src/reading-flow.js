// The work panel's side of scan reading (scan-reading spec): "Read a scan" while the Owner has
// switched it on, the check screen of a reading Draft, and the Families a reading's Proposal
// links children to. The screens themselves are reading-start.js and reading-check.js.

import { readingStatus } from './api.js';
import { deleteDraft, saveDraft } from './drafts.js';
import { t } from './i18n.js';
import { readingCheck } from './reading-check.js';
import { readStart } from './reading-start.js';

/** @typedef {import('./drafts.js').Draft} Draft */
/** @typedef {import('./proposal-build.js').PersonInput} PersonInput */
/** @typedef {import('./work.js').WorkPanel} WorkPanel */

/**
 * For each entry of a reading whose parents are both in the Tree, their Family (by entry, from 1).
 * @param {import('./reading-draft.js').ReadingForm} form
 * @param {(a: PersonInput, b: PersonInput) => Promise<{ id: string, version: number } | null>} familyOf
 */
export async function readingFamilies(form, familyOf) {
  /** @type {Map<number, { id: string, version: number } | null>} */
  const families = new Map();
  for (const [i, e] of form.entries.entries()) {
    const parent = (/** @type {string} */ role) => e.persons.find((p) => p.role === role)?.choice;
    const [father, mother] = [parent('father'), parent('mother')];
    if (e.skip || father?.mode !== 'existing' || mother?.mode !== 'existing') continue;
    families.set(i + 1, await familyOf(father, mother));
  }
  return families;
}

/**
 * "Read a scan": while scan reading is off, the forms by hand instead.
 * @param {WorkPanel} panel
 * @param {AbortSignal} signal
 */
export async function renderRead(panel, signal) {
  if (!panel.me) {
    panel.els.body.replaceChildren(panel.signInPrompt());
    return;
  }
  const status = await readingStatus(signal);
  if (signal.aborted) return;
  if (!status) {
    location.hash = '#work/propose';
    return;
  }
  panel.els.body.replaceChildren(
    readStart(status, (draft) => {
      void panel.refreshBadge();
      location.hash = `#work/draft/${draft.id}`;
    }),
  );
}

/**
 * The check screen of a reading Draft; it waits for the reading first when the server is still at it.
 * @param {WorkPanel} panel
 * @param {Draft & { kind: 'reading' }} draft
 */
export function showReading(panel, draft) {
  const signal = panel.screen?.signal ?? new AbortController().signal;
  const save = async () => {
    await saveDraft(draft);
    void panel.refreshBadge();
  };
  const { element, flush } = readingCheck(
    draft,
    {
      save,
      submit: async () => {
        await save();
        if (!navigator.onLine) throw new Error(t('drafts.offlineKept'));
        const p = await panel.submitWithMessages(draft);
        location.hash = `#work/mine/${p.id}`;
      },
      remove: async () => {
        if (!confirm(t('drafts.confirmDelete'))) return;
        await deleteDraft(draft.id);
        void panel.refreshBadge();
        location.hash = '#work/drafts';
      },
      rerender: () => {
        if (!signal.aborted) showReading(panel, draft);
      },
    },
    signal,
  );
  panel.flushForm = flush;
  panel.els.body.replaceChildren(element);
}
