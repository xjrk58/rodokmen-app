// Working on the Tree: Propose, Drafts, my Proposals, the review queue
// (Editors) and history. A full-screen panel over the map, opened by
// "#work/…" addresses so links from emails land on the right screen:
//   #work/propose[/kind]  #work/draft/<id>  #work/drafts
//   #work/mine[/<id>]     #work/review[/<id>]  #work/history[/person/<id>]

import { api, ApiError, uploadImage } from './api.js';
import { h } from './dom.js';
import { deleteDraft, draftPhotos, getDraft, isStale, listDrafts, newDraft, QUOTA_WARNING, requestPersistence, saveDraft, savePhoto, storageEstimate } from './drafts.js';
import { onLanguageChange, t } from './i18n.js';
import { emptyForm, kindChooser, proposeForm } from './propose-form.js';
import { buildOperations, draftTitle, KINDS, OPERATIONS_VERSION } from './proposal-build.js';
import { formatDate, proposalCard, renderHistory, renderReview } from './review.js';

/** @typedef {import('./drafts.js').Draft} Draft */

/**
 * @typedef {object} Me
 * @property {string} id
 * @property {string} displayName
 * @property {{ review: boolean }} permissions
 */

/** @param {number} bytes */
const mb = (bytes) => `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`;

/**
 * The existing Family of two Persons in the Tree, if there is one.
 * @param {any} a
 * @param {any} b
 * @returns {Promise<{ id: string, version: number } | null>}
 */
async function familyOf(a, b) {
  if (a?.mode !== 'existing' || b?.mode !== 'existing') return null;
  const person = await api(`persons/${a.id}`);
  const f = person.familiesAsPartner.find((/** @type {any} */ x) => x.partner?.id === b.id);
  return f ? { id: f.id, version: f.version } : null;
}

/**
 * Submits a Draft: photos first (each to its own presigned link), then the
 * Proposal with the Draft's idempotency key, so an interrupted submit can be
 * retried without a second Proposal. The Draft is deleted only on success.
 * @param {Draft} draft
 */
export async function submitDraft(draft) {
  const uploadIds = [];
  for (const photo of await draftPhotos(draft.id)) {
    if (!photo.uploadId) {
      photo.uploadId = await uploadImage(photo.blob);
      await savePhoto(photo);
    }
    uploadIds.push(photo.uploadId);
  }
  const f = draft.form;
  const family = draft.kind === 'baptism' ? await familyOf(f.father, f.mother) : draft.kind === 'marriage' ? await familyOf(f.partner1, f.partner2) : null;
  const operations = buildOperations(/** @type {any} */ (draft.kind), f, { uploadIds, family });
  const proposal = await api('proposals', { method: 'POST', body: { formatVersion: OPERATIONS_VERSION, idempotencyKey: draft.idempotencyKey, note: f.note?.trim() || null, operations } });
  await deleteDraft(draft.id);
  return proposal;
}

export class WorkPanel {
  /**
   * @param {{ panel: HTMLElement, body: HTMLElement, nav: HTMLElement, close: HTMLButtonElement, button: HTMLButtonElement, badge: HTMLElement, toast: HTMLElement }} els
   */
  constructor(els) {
    this.els = els;
    /** @type {Me | null | undefined} undefined: not known yet or offline; null: signed out */
    this.me = undefined;
    /** @type {Draft | null} the Draft open in the form */
    this.current = null;
    els.button.addEventListener('click', () => {
      location.hash = '#work/propose';
    });
    els.close.addEventListener('click', () => this.close());
    window.addEventListener('hashchange', () => void this.route());
    window.addEventListener('online', () => void this.refreshBadge());
    onLanguageChange(() => {
      if (this.isOpen) void this.route();
    });
    void requestPersistence();
    void this.refreshBadge();
    void this.route();
  }

  get isOpen() {
    return !this.els.panel.hidden;
  }

  close() {
    this.els.panel.hidden = true;
    history.pushState(null, '', location.pathname + location.search);
    window.dispatchEvent(new Event('work-closed'));
  }

  /** Signed-in Member, or null; undefined when the server cannot be reached. */
  async loadMe() {
    try {
      this.me = await api('me');
    } catch (error) {
      this.me = error instanceof ApiError && (error.status === 401 || error.status === 404) ? null : undefined;
    }
    return this.me;
  }

  /** The number of Drafts on the button, and an offer to submit them when online. */
  async refreshBadge() {
    let drafts = [];
    try {
      drafts = await listDrafts();
    } catch {
      return;
    }
    this.els.badge.textContent = String(drafts.length);
    this.els.badge.hidden = drafts.length === 0;
    const toast = this.els.toast;
    if (drafts.length > 0 && navigator.onLine && !this.isOpen) {
      const go = h('a', { class: 'button primary', href: '#work/drafts', 'data-testid': 'drafts-offer' }, t('drafts.offer', { count: drafts.length }));
      toast.replaceChildren(go);
      toast.hidden = false;
      go.addEventListener('click', () => (toast.hidden = true));
    } else {
      toast.hidden = true;
    }
  }

  async route() {
    const match = /^#work(?:\/([a-z]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(location.hash);
    if (!match) {
      if (this.isOpen) this.els.panel.hidden = true;
      return;
    }
    const [, view = 'propose', a, b] = match;
    this.els.panel.hidden = false;
    this.els.toast.hidden = true;
    if (this.me === undefined) await this.loadMe();
    this.renderNav(view);
    const body = this.els.body;
    try {
      if (view === 'propose') await this.renderPropose(a);
      else if (view === 'draft' && a) await this.renderDraft(a);
      else if (view === 'drafts') await this.renderDrafts();
      else if (!this.me) body.replaceChildren(this.signInPrompt());
      else if (view === 'mine') await this.renderMine(a);
      else if (view === 'review' && this.me.permissions.review) await renderReview(body, a);
      else if (view === 'history') await renderHistory(body, { kind: a, id: b, canUndo: this.me.permissions.review });
      else await this.renderPropose(undefined);
    } catch (error) {
      body.replaceChildren(h('p', { class: 'form-status error' }, error instanceof ApiError && error.offline ? t('work.offline') : /** @type {Error} */ (error).message));
    }
    body.scrollTop = 0;
  }

  /** @param {string} view */
  renderNav(view) {
    const tabs = [
      ['propose', 'work.tab.propose'],
      ['drafts', 'work.tab.drafts'],
      ['mine', 'work.tab.mine'],
      ...(this.me?.permissions.review ? [['review', 'work.tab.review']] : []),
      ['history', 'work.tab.history'],
    ];
    const current = view === 'draft' ? 'drafts' : view;
    this.els.nav.replaceChildren(
      ...tabs.map(([id, key]) => h('a', { href: `#work/${id}`, class: 'tab', 'aria-current': id === current ? 'page' : null, 'data-testid': `tab-${id}` }, t(key))),
    );
  }

  signInPrompt() {
    if (this.me === undefined) return h('p', { class: 'empty' }, t('work.offline'));
    return h('div', { class: 'empty' }, h('p', {}, t('work.signIn')), h('a', { class: 'button primary', href: '/auth/sign-in' }, t('work.signInButton')));
  }

  /** @param {string | undefined} kind */
  async renderPropose(kind) {
    if (!kind || !(/** @type {readonly string[]} */ (KINDS)).includes(kind)) {
      this.els.body.replaceChildren(h('h2', {}, t('propose.title')), h('p', { class: 'muted' }, t('propose.intro')), kindChooser());
      return;
    }
    this.current = newDraft(kind, emptyForm(/** @type {any} */ (kind)));
    this.showForm(this.current, false);
  }

  /** @param {string} id */
  async renderDraft(id) {
    const draft = await getDraft(id);
    if (!draft) {
      location.hash = '#work/drafts';
      return;
    }
    this.current = draft;
    this.showForm(draft, true);
  }

  /**
   * @param {Draft} draft
   * @param {boolean} stored
   */
  showForm(draft, stored) {
    let saved = stored;
    const save = async () => {
      await saveDraft(draft);
      if (!saved) {
        saved = true;
        history.replaceState(null, '', `#work/draft/${draft.id}`);
      }
      void this.refreshBadge();
    };
    const form = proposeForm(draft, {
      save,
      submit: async () => {
        await save();
        if (!navigator.onLine) throw new Error(t('drafts.offlineKept'));
        const p = await this.submitWithMessages(draft);
        location.hash = `#work/mine/${p.id}`;
      },
    });
    this.els.body.replaceChildren(form);
  }

  /** @param {Draft} draft */
  async submitWithMessages(draft) {
    try {
      const p = await submitDraft(draft);
      void this.refreshBadge();
      return p;
    } catch (error) {
      if (error instanceof ApiError && error.offline) throw new Error(t('drafts.interrupted'));
      if (error instanceof ApiError && error.status === 401) throw new Error(t('work.signIn'));
      throw error;
    }
  }

  async renderDrafts() {
    const drafts = await listDrafts();
    const estimate = await storageEstimate();
    const body = this.els.body;
    const items = await Promise.all(
      drafts.map(async (d) => {
        const photos = await draftPhotos(d.id);
        const status = h('p', { class: 'form-status', role: 'status' });
        const submit = h('button', { type: 'button', class: 'button primary', 'data-testid': 'submit-draft', disabled: !navigator.onLine }, t('drafts.submit'));
        const remove = h('button', { type: 'button', class: 'link-button', 'data-testid': 'delete-draft' }, t('drafts.delete'));
        submit.addEventListener('click', async () => {
          submit.disabled = true;
          status.classList.remove('error');
          status.textContent = t('drafts.submitting');
          try {
            await this.submitWithMessages(d);
            await this.renderDrafts();
          } catch (error) {
            status.textContent = /** @type {Error} */ (error).message;
            status.classList.add('error');
            submit.disabled = false;
          }
        });
        remove.addEventListener('click', async () => {
          if (!confirm(t('drafts.confirmDelete'))) return;
          await deleteDraft(d.id);
          void this.refreshBadge();
          await this.renderDrafts();
        });
        return h('article', { class: 'card draft', 'data-testid': 'draft', 'data-id': d.id },
          h('header', { class: 'card-head' }, h('a', { href: `#work/draft/${d.id}`, 'data-testid': 'draft-title' }, draftTitle(/** @type {any} */ (d.kind), d.form, t))),
          h('p', { class: 'muted small' }, t('drafts.meta', { date: formatDate(d.updatedAt), photos: photos.length })),
          isStale(d) ? h('p', { class: 'warning small' }, t('drafts.stale')) : null,
          status,
          h('div', { class: 'form-actions' }, remove, submit));
      }),
    );
    const quota = estimate
      ? h('p', { class: `small ${estimate.usage / estimate.quota > QUOTA_WARNING ? 'warning' : 'muted'}`, 'data-testid': 'storage' },
          t(estimate.usage / estimate.quota > QUOTA_WARNING ? 'drafts.storageFull' : 'drafts.storage', { used: mb(estimate.usage), quota: mb(estimate.quota) }))
      : null;
    body.replaceChildren(
      h('h2', {}, t('drafts.title')),
      h('p', { class: 'muted small' }, navigator.onLine ? t('drafts.intro') : t('drafts.introOffline')),
      ...(quota ? [quota] : []),
      ...(items.length ? items : [h('p', { class: 'empty' }, t('drafts.none'))]),
    );
  }

  /** @param {string | undefined} focusId */
  async renderMine(focusId) {
    const [{ items }, settings] = await Promise.all([api('proposals?mine=true&limit=100'), api('me/notifications')]);
    const toggle = h('input', { type: 'checkbox', checked: settings.outcomeEmails, 'data-testid': 'outcome-emails' });
    toggle.addEventListener('change', async () => {
      try {
        await api('me/notifications', { method: 'PUT', body: { outcomeEmails: toggle.checked } });
      } catch {
        toggle.checked = !toggle.checked;
      }
    });
    this.els.body.replaceChildren(
      h('h2', {}, t('mine.title')),
      h('label', { class: 'switch-row' }, toggle, h('span', {}, t('mine.outcomeEmails'))),
      ...(items.length ? items.map((/** @type {any} */ p) => proposalCard(p)) : [h('p', { class: 'empty' }, t('mine.none'))]),
    );
    if (focusId) this.els.body.querySelector(`[data-id="${focusId}"]`)?.scrollIntoView({ block: 'start' });
  }
}
