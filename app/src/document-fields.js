// PDF documents for the Source of a Citation (evidence-media spec, "Documents on Sources"), such as
// a family chronicle or a certificate: stored with the Draft like its photos, uploaded when it is
// submitted. Only PDF: a DOC or anything else is refused, with what to do instead.

import { guarded, h } from './dom.js';
import { deletePhoto, draftPhotos, newKey, savePhoto } from './drafts.js';
import { t } from './i18n.js';

/** @typedef {import('./drafts.js').Draft} Draft */

/** The largest document: 50 MB (shared/src/schemas/tree.ts, DOCUMENT_MAX_BYTES). */
export const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Why a file cannot be attached as a document, as an i18n key, or null when it can.
 * @param {{ type: string, name: string, size: number }} file
 */
export function documentProblem(file) {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return 'documents.notPdf';
  if (file.size > DOCUMENT_MAX_BYTES) return 'documents.tooLarge';
  return null;
}

/**
 * The documents of a Draft, with a button to add a PDF.
 * @param {Draft} draft
 * @param {() => Promise<void>} ensureSaved stores the Draft before its first document
 * @param {(error: unknown) => void} report shows a failure
 */
export function documentFields(draft, ensureSaved, report) {
  const list = h('ul', { class: 'documents', 'data-testid': 'documents' });
  const render = async () => {
    const docs = (await draftPhotos(draft.id)).filter((p) => p.kind === 'document');
    list.replaceChildren(
      ...docs.map((d) => {
        const remove = h('button', { type: 'button', class: 'icon-button small', 'aria-label': t('photos.remove') }, '×');
        remove.addEventListener(
          'click',
          guarded(report, async () => {
            await deletePhoto(d.id);
            await render();
          }),
        );
        return h('li', { 'data-testid': 'document' }, h('span', {}, d.name), remove);
      }),
    );
  };
  const file = h('input', {
    type: 'file',
    accept: 'application/pdf,.pdf',
    multiple: true,
    'data-testid': 'document-input',
    class: 'visually-hidden',
    id: 'document-input',
  });
  file.addEventListener(
    'change',
    guarded(report, async () => {
      const refused = [...(file.files ?? [])].map(documentProblem).find((p) => p !== null);
      const accepted = [...(file.files ?? [])].filter((f) => documentProblem(f) === null);
      file.value = '';
      if (accepted.length) await ensureSaved();
      for (const f of accepted) await savePhoto({ id: newKey(), draftId: draft.id, blob: f, name: f.name, uploadId: null, kind: 'document' });
      await render();
      if (refused) throw new Error(t(refused));
    }),
  );
  render().catch(report);
  return [h('div', { class: 'photo-row' }, h('label', { class: 'button', for: 'document-input' }, t('documents.add')), file), list];
}
