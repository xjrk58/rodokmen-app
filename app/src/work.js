// Working on the Tree: Propose, Drafts, my Proposals, the review queue
// (Editors) and history. A full-screen panel over the map, opened by
// "#work/…" addresses so links from emails land on the right screen:
//   #work/propose[/kind]  #work/draft/<id>  #work/drafts
//   #work/mine[/<id>]     #work/review[/<id>]  #work/history[/person/<id>]

import { ApiError, getMe, getPerson, myProposals, notificationSettings, setNotificationSettings, submitProposal, uploadImage } from './api.js';
import { h } from './dom.js';
import { deleteDraft, draftPhotos, getDraft, isStale, listDrafts, newDraft, QUOTA_WARNING, requestPersistence, saveDraft, savePhoto, storageEstimate } from './drafts.js';
import { onLanguageChange, t } from './i18n.js';
import { kindChooser, proposeForm } from './propose-form.js';
import { buildOperations, draftTitle, emptyForm, KINDS, OPERATIONS_VERSION } from './proposal-build.js';
import { formatDate, messageOf, proposalCard, renderHistory, renderReview } from './review.js';

/** @typedef {import('./drafts.js').Draft} Draft */
/** @typedef {import('./proposal-build.js').PersonInput} PersonInput */
/** @typedef {import('./proposal-build.js').ProposeKind} ProposeKind */
/** @typedef {import('./types.js').Me} Me */
/** @typedef {import('./types.js').ProposalView} ProposalView */

/** @param {number} bytes */
const mb = (bytes) => `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`;

/**
 * @param {string | undefined} kind
 * @returns {kind is ProposeKind}
 */
const isKind = (kind) => KINDS.some((k) => k === kind);

/**
 * The existing Family of two Persons in the Tree, if there is one.
 * @param {PersonInput | null} a
 * @param {PersonInput | null} b
 * @returns {Promise<{ id: string, version: number } | null>}
 */
async function familyOf(a, b) {
  if (a?.mode !== 'existing' || b?.mode !== 'existing') return null;
  const person = await getPerson(a.id);
  const f = person.familiesAsPartner.find((x) => x.partner?.id === b.id);
  return f ? { id: f.id, version: f.version } : null;
}

/**
 * The existing Family a Draft adds to: the parents' of a baptism, the partners' of a marriage.
 * @param {Draft} draft
 */
function draftFamily(draft) {
  if (draft.kind === 'baptism') return familyOf(draft.form.father, draft.form.mother);
  if (draft.kind === 'marriage') return familyOf(draft.form.partner1, draft.form.partner2);
  return Promise.resolve(null);
}

/**
 * Submits a Draft: photos first (each to its own presigned link), then the
 * Proposal with the Draft's idempotency key, so an interrupted submit can be
 * retried without a second Proposal. The Draft is deleted only on success.
 * @param {Draft} draft
 * @returns {Promise<ProposalView>}
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
  const family = await draftFamily(draft);
  const operations = buildOperations(draft, { uploadIds, family });
  const proposal = await submitProposal({ formatVersion: OPERATIONS_VERSION, idempotencyKey: draft.idempotencyKey, note: draft.form.note?.trim() || null, direct: false, operations });
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
  }

  /** Signed-in Member, or null; undefined when the server cannot be reached. */
  async loadMe() {
    try {
      this.me = await getMe();
    } catch (error) {
      this.me = error instanceof ApiError && (error.status === 401 || error.status === 404) ? null : undefined;
    }
    return this.me;
  }

  /** The number of Drafts on the button, and an offer to submit them when online. */
  async refreshBadge() {
    const drafts = await listDrafts().catch(() => null);
    if (!drafts) return;
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
      await this.renderView(view, a, b);
    } catch (error) {
      body.replaceChildren(h('p', { class: 'form-status error' }, error instanceof ApiError && error.offline ? t('work.offline') : messageOf(error)));
    }
    body.scrollTop = 0;
  }

  /**
   * @param {string} view
   * @param {string | undefined} a
   * @param {string | undefined} b
   */
  async renderView(view, a, b) {
    const body = this.els.body;
    if (view === 'propose') this.renderPropose(a);
    else if (view === 'draft' && a) await this.renderDraft(a);
    else if (view === 'drafts') await this.renderDrafts();
    else if (!this.me) body.replaceChildren(this.signInPrompt());
    else if (view === 'mine') await this.renderMine(a);
    else if (view === 'review' && this.me.permissions.review) await renderReview(body, a);
    else if (view === 'history') await renderHistory(body, { kind: a, id: b, canUndo: this.me.permissions.review });
    else this.renderPropose(undefined);
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
  renderPropose(kind) {
    if (!isKind(kind)) {
      this.els.body.replaceChildren(h('h2', {}, t('propose.title')), h('p', { class: 'muted' }, t('propose.intro')), kindChooser());
      return;
    }
    this.showForm(newDraft(emptyForm(kind)), false);
  }

  /** @param {string} id */
  async renderDraft(id) {
    const draft = await getDraft(id);
    if (!draft) {
      location.hash = '#work/drafts';
      return;
    }
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
      if (error instanceof ApiError && error.offline) throw new Error(t('drafts.interrupted'), { cause: error });
      if (error instanceof ApiError && error.status === 401) throw new Error(t('work.signIn'), { cause: error });
      throw error;
    }
  }

  /**
   * One Draft in the list, with submit and delete.
   * @param {Draft} d
   */
  async draftCard(d) {
    const photos = await draftPhotos(d.id);
    const status = h('p', { class: 'form-status', role: 'status' });
    const submit = h('button', { type: 'button', class: 'button primary', 'data-testid': 'submit-draft', disabled: !navigator.onLine }, t('drafts.submit'));
    const remove = h('button', { type: 'button', class: 'link-button', 'data-testid': 'delete-draft' }, t('drafts.delete'));
    const send = async () => {
      submit.disabled = true;
      status.classList.remove('error');
      status.textContent = t('drafts.submitting');
      try {
        await this.submitWithMessages(d);
        await this.renderDrafts();
      } catch (error) {
        status.textContent = messageOf(error);
        status.classList.add('error');
        submit.disabled = false;
      }
    };
    submit.addEventListener('click', () => void send());
    const drop = async () => {
      if (!confirm(t('drafts.confirmDelete'))) return;
      await deleteDraft(d.id);
      void this.refreshBadge();
      await this.renderDrafts();
    };
    remove.addEventListener('click', () => void drop());
    return h('article', { class: 'card draft', 'data-testid': 'draft', 'data-id': d.id },
      h('header', { class: 'card-head' }, h('a', { href: `#work/draft/${d.id}`, 'data-testid': 'draft-title' }, draftTitle(d, t))),
      h('p', { class: 'muted small' }, t('drafts.meta', { date: formatDate(d.updatedAt), photos: photos.length })),
      isStale(d) ? h('p', { class: 'warning small' }, t('drafts.stale')) : null,
      status,
      h('div', { class: 'form-actions' }, remove, submit));
  }

  async renderDrafts() {
    const drafts = await listDrafts();
    const estimate = await storageEstimate();
    const items = await Promise.all(drafts.map((d) => this.draftCard(d)));
    const full = estimate ? estimate.usage / estimate.quota > QUOTA_WARNING : false;
    const quota = estimate
      ? h('p', { class: `small ${full ? 'warning' : 'muted'}`, 'data-testid': 'storage' }, t(full ? 'drafts.storageFull' : 'drafts.storage', { used: mb(estimate.usage), quota: mb(estimate.quota) }))
      : null;
    this.els.body.replaceChildren(
      h('h2', {}, t('drafts.title')),
      h('p', { class: 'muted small' }, navigator.onLine ? t('drafts.intro') : t('drafts.introOffline')),
      ...(quota ? [quota] : []),
      ...(items.length ? items : [h('p', { class: 'empty' }, t('drafts.none'))]),
    );
  }

  /** @param {string | undefined} focusId */
  async renderMine(focusId) {
    const [{ items }, settings] = await Promise.all([myProposals(), notificationSettings()]);
    const toggle = h('input', { type: 'checkbox', checked: settings.outcomeEmails, 'data-testid': 'outcome-emails' });
    const change = async () => {
      try {
        await setNotificationSettings({ outcomeEmails: toggle.checked });
      } catch {
        toggle.checked = !toggle.checked;
      }
    };
    toggle.addEventListener('change', () => void change());
    this.els.body.replaceChildren(
      h('h2', {}, t('mine.title')),
      h('label', { class: 'switch-row' }, toggle, h('span', {}, t('mine.outcomeEmails'))),
      ...(items.length ? items.map((p) => proposalCard(p)) : [h('p', { class: 'empty' }, t('mine.none'))]),
    );
    if (focusId) this.els.body.querySelector(`[data-id="${focusId}"]`)?.scrollIntoView({ block: 'start' });
  }
}
