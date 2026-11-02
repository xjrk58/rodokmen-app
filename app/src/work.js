// Working on the Tree: Propose, Drafts, my Proposals, the review queue
// (Editors) and history. A full-screen panel over the map, opened by
// "#work/…" addresses so links from emails land on the right screen:
//   #work/propose[/kind[/<person id>]]  #work/draft/<id>  #work/drafts
//   #work/mine[/<id>]     #work/review[/<id>]  #work/history[/person/<id>]
//   #work/lead/<lead id>/<kind>   a Proposal that starts from a Research lead and answers it

import {
  ApiError,
  getLead,
  getMe,
  getPerson,
  messageOf,
  myProposals,
  notificationSettings,
  setNotificationSettings,
  submitProposal,
  uploadDocument,
  uploadImage,
} from './api.js';
import { guarded, h, showError } from './dom.js';
import {
  deleteDraft,
  draftPhotos,
  getDraft,
  isStale,
  listDrafts,
  newDraft,
  QUOTA_WARNING,
  requestPersistence,
  saveDraft,
  savePhoto,
  storageEstimate,
} from './drafts.js';
import { onLanguageChange, t } from './i18n.js';
import { leadStart } from './lead-parts.js';
import { personText } from './pickers.js';
import { kindChooser, proposeForm } from './propose-form.js';
import { buildOperations, draftTitle, emptyForm, formProblems, KINDS, OPERATIONS_VERSION } from './proposal-build.js';
import { formatDate, proposalCard, renderHistory, renderReview } from './review.js';

/** @typedef {import('./drafts.js').Draft} Draft */
/** @typedef {import('./proposal-build.js').PersonInput} PersonInput */
/** @typedef {import('./proposal-build.js').ProposeKind} ProposeKind */
/** @typedef {import('./types.js').Me} Me */
/** @typedef {import('./types.js').ProposalView} ProposalView */
/** @typedef {import('./types.js').SubmitProposalBody} SubmitProposalBody */

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
 * The body of a Draft's Proposal: photos first (each to its own presigned link,
 * remembered so a retry does not upload them again), then the operations.
 * @param {Draft} draft
 * @returns {Promise<SubmitProposalBody>}
 */
async function proposalBody(draft) {
  const uploadIds = [];
  const documents = [];
  for (const photo of await draftPhotos(draft.id)) {
    const document = photo.kind === 'document';
    if (!photo.uploadId) {
      photo.uploadId = document ? await uploadDocument(photo.blob) : await uploadImage(photo.blob);
      await savePhoto(photo);
    }
    if (document) documents.push({ uploadId: photo.uploadId, title: photo.name.replace(/\.pdf$/i, '') || photo.name });
    else uploadIds.push(photo.uploadId);
  }
  const family = await draftFamily(draft);
  const operations = buildOperations(draft, { uploadIds, documents, family });
  return {
    formatVersion: OPERATIONS_VERSION,
    idempotencyKey: draft.idempotencyKey,
    note: draft.form.note?.trim() || null,
    direct: false,
    operations,
    answersLeads: draft.lead ? [draft.lead.id] : [],
  };
}

/**
 * Sends a Draft's Proposal. When the answer is lost the Proposal may exist
 * already, so the body is kept with the Draft and only it is sent again.
 * @param {Draft} draft
 */
async function sendDraft(draft) {
  const body = draft.pending ?? (await proposalBody(draft));
  try {
    return await submitProposal(body);
  } catch (error) {
    if (error instanceof ApiError && error.offline && !draft.pending) {
      draft.pending = body;
      await saveDraft(draft);
    }
    throw error;
  }
}

/**
 * Forgets the uploads of a Draft's photos (and the body that names them), so they are uploaded again.
 * @param {Draft} draft
 */
async function forgetUploads(draft) {
  delete draft.pending;
  await saveDraft(draft);
  for (const photo of await draftPhotos(draft.id)) {
    photo.uploadId = null;
    await savePhoto(photo);
  }
}

/**
 * Submits a Draft with its idempotency key, so an interrupted submit can be
 * retried without a second Proposal. The Draft is checked before anything is
 * uploaded, and deleted only on success. The server deletes uploads unused for
 * 30 days; a Draft that waited that long uploads its photos again, once.
 * @param {Draft} draft
 * @returns {Promise<ProposalView>}
 */
export async function submitDraft(draft) {
  const problems = formProblems(draft);
  if (problems.length) throw new Error(problems.map((p) => t(p)).join(' '));
  let proposal;
  try {
    proposal = await sendDraft(draft);
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 'upload_unusable')) throw error;
    await forgetUploads(draft);
    proposal = await sendDraft(draft);
  }
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
    /** @type {AbortController | null} the screen shown; aborted when the Member moves on, so its late answers are dropped */
    this.screen = null;
    /** @type {(() => void) | null} stores what was typed into the open form, now */
    this.flushForm = null;
    els.button.addEventListener('click', () => {
      location.hash = '#work/propose';
    });
    els.close.addEventListener('click', () => this.close());
    window.addEventListener('hashchange', () => void this.route());
    window.addEventListener('online', () => void this.refreshBadge());
    onLanguageChange(() => {
      if (this.isOpen) void this.route();
    });
    // A phone may end the app at any time after it goes to the background.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushForm?.();
    });
    window.addEventListener('pagehide', () => this.flushForm?.());
    void requestPersistence();
    void this.refreshBadge();
    void this.route();
  }

  get isOpen() {
    return !this.els.panel.hidden;
  }

  /** Stores the open form and drops the pending work of the screen shown. */
  leaveScreen() {
    this.flushForm?.();
    this.flushForm = null;
    this.screen?.abort();
    this.screen = null;
  }

  close() {
    this.leaveScreen();
    this.els.panel.hidden = true;
    history.pushState(null, '', location.pathname + location.search);
    // pushState fires no hashchange; the app shell follows the address on hashchange.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  /**
   * Signed-in Member, or null; undefined when the server cannot be reached.
   * @param {AbortSignal} [signal]
   */
  async loadMe(signal) {
    try {
      this.me = await getMe(signal);
    } catch (error) {
      if (signal?.aborted) return this.me;
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
    this.leaveScreen();
    const match = /^#work(?:\/([a-z]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(location.hash);
    if (!match) {
      if (this.isOpen) this.els.panel.hidden = true;
      return;
    }
    const screen = new AbortController();
    this.screen = screen;
    const { signal } = screen;
    const [, view = 'propose', a, b] = match;
    this.els.panel.hidden = false;
    this.els.toast.hidden = true;
    if (this.me === undefined) await this.loadMe(signal);
    if (signal.aborted) return;
    this.renderNav(view);
    const body = this.els.body;
    try {
      await this.renderView(view, a, b, signal);
    } catch (error) {
      if (signal.aborted) return;
      body.replaceChildren(h('p', { class: 'form-status error' }, error instanceof ApiError && error.offline ? t('work.offline') : messageOf(error)));
    }
    if (!signal.aborted) body.scrollTop = 0;
  }

  /**
   * @param {string} view
   * @param {string | undefined} a
   * @param {string | undefined} b
   * @param {AbortSignal} signal
   */
  async renderView(view, a, b, signal) {
    const body = this.els.body;
    if (view === 'propose') await this.renderPropose(a, b, signal);
    else if (view === 'draft' && a) await this.renderDraft(a, signal);
    else if (view === 'drafts') await this.renderDrafts(signal);
    else if (!this.me) body.replaceChildren(this.signInPrompt());
    else if (view === 'mine') await this.renderMine(a, signal);
    else if (view === 'lead' && a) await this.renderFromLead(a, b, signal);
    else if (view === 'review' && this.me.permissions.review) await renderReview(body, a, signal);
    else if (view === 'history') await renderHistory(body, { kind: a, id: b, canUndo: this.me.permissions.review }, signal);
    else await this.renderPropose(undefined);
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
      ...tabs.map(([id, key]) =>
        h('a', { href: `#work/${id}`, class: 'tab', 'aria-current': id === current ? 'page' : null, 'data-testid': `tab-${id}` }, t(key)),
      ),
    );
  }

  signInPrompt() {
    if (this.me === undefined) return h('p', { class: 'empty' }, t('work.offline'));
    return h('div', { class: 'empty' }, h('p', {}, t('work.signIn')), h('a', { class: 'button primary', href: '#sign-in' }, t('work.signInButton')));
  }

  /**
   * A new Proposal of a kind; with a Person (#work/propose/correction/<id>, "Propose a change"
   * on a person page), the correction form starts on that Person.
   * @param {string | undefined} kind
   * @param {string | undefined} [personId]
   * @param {AbortSignal} [signal]
   */
  async renderPropose(kind, personId, signal) {
    if (!isKind(kind)) {
      this.els.body.replaceChildren(h('h2', {}, t('propose.title')), h('p', { class: 'muted' }, t('propose.intro')), kindChooser());
      return;
    }
    const draft = newDraft(emptyForm(kind));
    if (personId && (draft.kind === 'correction' || draft.kind === 'notes')) {
      const person = await getPerson(personId, signal);
      if (signal?.aborted) return;
      const primary = person.names.find((n) => n.primary) ?? person.names[0];
      const birth = person.events.find((e) => e.role === 'child' && (e.event.type === 'birth' || e.event.type === 'baptism'))?.event.date ?? null;
      draft.form.person = { mode: 'existing', id: person.id, version: person.version, label: personText(primary?.given ?? '', primary?.surname ?? '', birth) };
    }
    this.showForm(draft, false);
  }

  /**
   * "Start from this lead" (research-leads spec, "Findings link back to leads"): a Proposal of a
   * kind that starts from the lead's Persons, Place and register, and names the lead it answers,
   * so that accepting it marks the lead found.
   * @param {string} leadId
   * @param {string | undefined} kind
   * @param {AbortSignal} signal
   */
  async renderFromLead(leadId, kind, signal) {
    const lead = await getLead(leadId, signal);
    if (signal.aborted) return;
    if (!isKind(kind)) {
      location.hash = `#leads/${leadId}`;
      return;
    }
    const draft = newDraft(emptyForm(kind));
    draft.lead = { id: lead.id, question: lead.question };
    const { persons, place, source } = leadStart(lead);
    const [first = null, second = null] = persons;
    if (source) {
      draft.form.citation.sourceMode = 'existing';
      draft.form.citation.source = source;
    }
    if (draft.kind === 'baptism') {
      if (first) draft.form.child = first;
      draft.form.place = place;
    } else if (draft.kind === 'marriage') {
      draft.form.partner1 = first;
      draft.form.partner2 = second;
      draft.form.place = place;
    } else if (draft.kind === 'death') {
      draft.form.person = first;
      draft.form.place = place;
    } else {
      draft.form.person = first;
    }
    this.showForm(draft, false);
  }

  /**
   * @param {string} id
   * @param {AbortSignal} signal
   */
  async renderDraft(id, signal) {
    const draft = await getDraft(id);
    if (signal.aborted) return;
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
    const address = location.hash;
    let saved = stored;
    const save = async () => {
      if (!saved) {
        saved = true;
        // From now on the address names the stored Draft, so a reload or a language change reopens it.
        if (location.hash === address) history.replaceState(null, '', `#work/draft/${draft.id}`);
      }
      await saveDraft(draft);
      void this.refreshBadge();
    };
    const { element, flush } = proposeForm(draft, {
      save,
      submit: async () => {
        await save();
        if (!navigator.onLine) throw new Error(t('drafts.offlineKept'));
        const p = await this.submitWithMessages(draft);
        location.hash = `#work/mine/${p.id}`;
      },
    });
    this.flushForm = flush;
    this.els.body.replaceChildren(element);
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
   * @param {AbortSignal} signal
   */
  async draftCard(d, signal) {
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
        await this.renderDrafts(signal);
      } catch (error) {
        showError(status)(error);
        submit.disabled = false;
      }
    };
    submit.addEventListener('click', () => void send());
    remove.addEventListener(
      'click',
      guarded(showError(status), async () => {
        if (!confirm(t('drafts.confirmDelete'))) return;
        await deleteDraft(d.id);
        void this.refreshBadge();
        await this.renderDrafts(signal);
      }),
    );
    return h(
      'article',
      { class: 'card draft', 'data-testid': 'draft', 'data-id': d.id },
      h('header', { class: 'card-head' }, h('a', { href: `#work/draft/${d.id}`, 'data-testid': 'draft-title' }, draftTitle(d, t))),
      h('p', { class: 'muted small' }, t('drafts.meta', { date: formatDate(d.updatedAt), photos: photos.length })),
      isStale(d) ? h('p', { class: 'warning small' }, t('drafts.stale')) : null,
      d.pending ? h('p', { class: 'warning small' }, t('drafts.pending')) : null,
      status,
      h('div', { class: 'form-actions' }, remove, submit),
    );
  }

  /** @param {AbortSignal} signal */
  async renderDrafts(signal) {
    const drafts = await listDrafts();
    const estimate = await storageEstimate();
    const items = await Promise.all(drafts.map((d) => this.draftCard(d, signal)));
    if (signal.aborted) return;
    const full = estimate ? estimate.usage / estimate.quota > QUOTA_WARNING : false;
    const quota = estimate
      ? h(
          'p',
          { class: `small ${full ? 'warning' : 'muted'}`, 'data-testid': 'storage' },
          t(full ? 'drafts.storageFull' : 'drafts.storage', { used: mb(estimate.usage), quota: mb(estimate.quota) }),
        )
      : null;
    this.els.body.replaceChildren(
      h('h2', {}, t('drafts.title')),
      h('p', { class: 'muted small' }, navigator.onLine ? t('drafts.intro') : t('drafts.introOffline')),
      ...(quota ? [quota] : []),
      ...(items.length ? items : [h('p', { class: 'empty' }, t('drafts.none'))]),
    );
  }

  /**
   * @param {string | undefined} focusId
   * @param {AbortSignal} signal
   */
  async renderMine(focusId, signal) {
    const [{ items }, settings] = await Promise.all([myProposals(signal), notificationSettings(signal)]);
    if (signal.aborted) return;
    const toggle = h('input', { type: 'checkbox', checked: settings.outcomeEmails, 'data-testid': 'outcome-emails' });
    const status = h('p', { class: 'form-status', role: 'status', 'data-testid': 'outcome-status' });
    toggle.addEventListener(
      'change',
      guarded(showError(status), async () => {
        status.textContent = '';
        try {
          await setNotificationSettings({ outcomeEmails: toggle.checked });
        } catch (error) {
          toggle.checked = !toggle.checked;
          throw error;
        }
      }),
    );
    this.els.body.replaceChildren(
      h('h2', {}, t('mine.title')),
      h('label', { class: 'switch-row' }, toggle, h('span', {}, t('mine.outcomeEmails'))),
      status,
      ...(items.length ? items.map((p) => proposalCard(p)) : [h('p', { class: 'empty' }, t('mine.none'))]),
    );
    if (focusId) this.els.body.querySelector(`[data-id="${focusId}"]`)?.scrollIntoView({ block: 'start' });
  }
}
