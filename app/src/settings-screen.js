// Settings (family-view spec, "Owner settings in the app"): every Member's own language,
// passkeys and sessions, and sign-out; for the Owner also the Family roots and the family:
// invitations, roles, disabling and enabling Members, and the link from each Member to their
// Person. Settings that later changes add (Agent accounts, scan reading) get their own section
// here. Other Members see nothing about anyone else.

import * as API from './api.js';
import { LANGUAGES, language, t } from './i18n.js';
import { formatTime, PersonLine, useDebounced } from './screen-parts.js';
import { html, useEffect, useState } from './ui.js';
import { APP_VERSION } from './version.js';
import { registerPasskey } from './webauthn.js';

/** @typedef {import('./types.js').Me} Me */
/** @typedef {import('./types.js').MemberView} MemberView */
/** @typedef {import('./types.js').MemberRole} MemberRole */
/** @typedef {import('./types.js').InvitationView} InvitationView */
/** @typedef {import('./types.js').PersonSummary} PersonSummary */
/** @typedef {{ me: Me, chooseLanguage: (lang: 'cs' | 'en') => Promise<void>, signOut: () => Promise<void>, refreshMe: () => Promise<void> }} SettingsProps */

const ROLES = /** @type {const} */ (['contributor', 'editor', 'owner']);

/**
 * Data for a section that loads once and on demand again.
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} load
 */
function useLoad(load) {
  const [state, setState] = useState(/** @type {{ data: T | null, error: unknown }} */ ({ data: null, error: null }));
  const [round, setRound] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then(
      (data) => !controller.signal.aborted && setState({ data, error: null }),
      (/** @type {unknown} */ error) => !controller.signal.aborted && setState((s) => ({ ...s, error })),
    );
    return () => controller.abort();
  }, [round]);
  return { ...state, reload: () => setRound((r) => r + 1) };
}

/**
 * A status line for an action, and a runner that reports its failure there.
 * @returns {[string, boolean, (action: () => Promise<unknown>, done?: string) => Promise<void>]}
 */
function useAction() {
  const [status, setStatus] = useState({ text: '', error: false });
  const run = async (/** @type {() => Promise<unknown>} */ action, done = '') => {
    setStatus({ text: '', error: false });
    try {
      await action();
      setStatus({ text: done, error: false });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), error: true });
    }
  };
  return [status.text, status.error, run];
}

/** @param {{ text: string, error: boolean, testid?: string }} props */
const Status = ({ text, error, testid }) =>
  html`<p class=${`form-status${error ? ' error' : ''}`} role="status" data-testid=${testid ?? 'settings-status'}>${text}</p>`;

/** @param {{ chooseLanguage: SettingsProps['chooseLanguage'] }} props */
function LanguageSection({ chooseLanguage }) {
  const [text, error, run] = useAction();
  return html`<section class="card" data-testid="settings-language">
    <h2>${t('settings.language')}</h2>
    <p class="muted small">${t('settings.languageText')}</p>
    <div class="segmented">
      ${LANGUAGES.map(
        (lang) =>
          html`<label key=${lang}>
            <input type="radio" name="account-language" value=${lang} checked=${language() === lang} onChange=${() => void run(() => chooseLanguage(lang))} />
            <span lang=${lang}>${lang === 'cs' ? 'Čeština' : 'English'}</span>
          </label>`,
      )}
    </div>
    <${Status} text=${text} error=${error} />
  </section>`;
}

/** @param {{ me: Me, refreshMe: SettingsProps['refreshMe'] }} props */
function PasskeysSection({ me, refreshMe }) {
  const keys = useLoad((signal) => API.myPasskeys(signal));
  const [text, error, run] = useAction();
  return html`<section class="card" data-testid="settings-passkeys">
    <h2>${t('settings.passkeys')}</h2>
    <ul class="plain-list">
      ${(keys.data?.items ?? []).map(
        (k) =>
          html`<li key=${k.id} data-testid="passkey">
            <span>${k.name}</span>
            <span class="muted small">
              ·
              ${t('settings.created', { time: formatTime(k.createdAt) })}${k.lastUsedAt ? ` · ${t('settings.lastUsed', { time: formatTime(k.lastUsedAt) })}` : ''}</span
            >
            <button
              type="button"
              class="link-button"
              onClick=${() =>
                void run(async () => {
                  if (!confirm(t('settings.removePasskeyConfirm'))) return;
                  await API.removePasskey(k.id);
                  keys.reload();
                  await refreshMe();
                })}
            >
              ${t('settings.remove')}
            </button>
          </li>`,
      )}
    </ul>
    ${keys.data && keys.data.items.length === 0 ? html`<p class="muted small">${t('settings.noPasskeys')}</p>` : null}
    <button
      type="button"
      class="button"
      data-testid="add-passkey"
      onClick=${() =>
        void run(async () => {
          await registerPasskey();
          keys.reload();
          await refreshMe();
        }, t('signIn.passkeySaved'))}
    >
      ${me.passkeyCount ? t('settings.addPasskey') : t('signIn.savePasskey')}
    </button>
    <${Status} text=${text} error=${error} />
  </section>`;
}

function SessionsSection() {
  const sessions = useLoad((signal) => API.mySessions(signal));
  const [text, error, run] = useAction();
  return html`<section class="card" data-testid="settings-sessions">
    <h2>${t('settings.sessions')}</h2>
    <ul class="plain-list">
      ${(sessions.data?.items ?? []).map(
        (s) =>
          html`<li key=${s.id} data-testid="session">
            <span>${s.current ? t('settings.thisDevice') : (s.userAgent ?? t('settings.unknownDevice'))}</span>
            <span class="muted small"> · ${t(`settings.method.${s.method}`)} · ${t('settings.lastSeen', { time: formatTime(s.lastSeenAt) })}</span>
            ${
              s.current
                ? null
                : html`<button type="button" class="link-button" onClick=${() => void run(async () => (await API.endSession(s.id), sessions.reload()))}>
                    ${t('settings.endSession')}
                  </button>`
            }
          </li>`,
      )}
    </ul>
    <${Status} text=${text} error=${error} />
  </section>`;
}

/**
 * Picks a Person of the Tree by name.
 * @param {{ onPick: (p: PersonSummary) => void, testid: string }} props
 */
function PersonPick({ onPick, testid }) {
  const [q, setQ] = useState('');
  const settled = useDebounced(q.trim(), 250);
  const [hits, setHits] = useState(/** @type {PersonSummary[]} */ ([]));
  useEffect(() => {
    if (settled.length < 2) return setHits([]);
    const controller = new AbortController();
    API.listPersons({ q: settled, offset: 0, limit: 8 }, controller.signal).then(
      (r) => !controller.signal.aborted && setHits(r.items.map((i) => i.person)),
      () => !controller.signal.aborted && setHits([]),
    );
    return () => controller.abort();
  }, [settled]);
  return html`<div class="picker-search">
    <input
      type="search"
      placeholder=${t('settings.findPerson')}
      data-testid=${`${testid}-search`}
      value=${q}
      onInput=${(/** @type {Event} */ e) => setQ(/** @type {HTMLInputElement} */ (e.currentTarget).value)}
    />
    <ul class="picker-results" data-testid=${`${testid}-results`}>
      ${hits.map(
        (p) =>
          html`<li key=${p.id}>
            <button type="button" class="picker-item" onClick=${() => onPick(p)}><${PersonLine} person=${p} /></button>
          </li>`,
      )}
    </ul>
  </div>`;
}

/** @param {{ member: MemberView, me: Me, onChange: () => void }} props */
function MemberRow({ member, me, onChange }) {
  const [linking, setLinking] = useState(false);
  const [text, error, run] = useAction();
  const self = member.id === me.id;
  const setRole = (/** @type {MemberRole} */ role) =>
    run(async () => {
      if (role === 'owner' && !confirm(t('settings.handOverConfirm', { name: member.displayName }))) return;
      await API.changeRole(member.id, role);
      onChange();
    });
  return html`<li class="member" data-testid="member" data-email=${member.email}>
    <div class="member-head">
      <strong>${member.displayName}</strong> <span class="muted small">${member.email}</span>
      ${member.disabled ? html`<span class="chip status-rejected">${t('settings.disabled')}</span>` : null}
    </div>
    <div class="member-controls">
      <label class="small"
        >${t('settings.role')}
        <select
          data-testid="member-role"
          disabled=${self}
          onChange=${(/** @type {Event} */ e) => void setRole(/** @type {MemberRole} */ (/** @type {HTMLSelectElement} */ (e.currentTarget).value))}
        >
          ${ROLES.map((r) => html`<option value=${r} selected=${member.role === r}>${t(`settings.role.${r}`)}</option>`)}
        </select>
      </label>
      ${
        self
          ? null
          : html`<button
              type="button"
              class="link-button"
              data-testid="member-disable"
              onClick=${() => void run(async () => (await API.setDisabled(member.id, !member.disabled), onChange()))}
            >
              ${member.disabled ? t('settings.enable') : t('settings.disable')}
            </button>`
      }
    </div>
    <div class="member-person small" data-testid="member-person">
      ${t('settings.ownPerson')}:
      ${member.person ? html`<${PersonLine} person=${member.person} href=${`#people/${member.person.id}`} />` : html`<span class="muted">${t('settings.notLinked')}</span>`}
      <button type="button" class="link-button" data-testid="member-link" onClick=${() => setLinking(!linking)}>
        ${member.person ? t('settings.changeLink') : t('settings.link')}
      </button>
      ${member.person ? html`<button type="button" class="link-button" data-testid="member-unlink" onClick=${() => void run(async () => (await API.linkPerson(member.id, null), onChange()))}>${t('settings.unlink')}</button>` : null}
    </div>
    ${linking ? html`<${PersonPick} testid="link-person" onPick=${(/** @type {PersonSummary} */ p) => void run(async () => (await API.linkPerson(member.id, p.id), setLinking(false), onChange()))} />` : null}
    <${Status} text=${text} error=${error} />
  </li>`;
}

/** @param {{ me: Me }} props */
function FamilySection({ me }) {
  const members = useLoad((signal) => API.listMembers(signal));
  const invitations = useLoad((signal) => API.listInvitations(signal));
  const [email, setEmail] = useState('');
  const [lang, setLang] = useState(/** @type {'cs' | 'en'} */ ('cs'));
  const [text, error, run] = useAction();
  const send = (/** @type {Event} */ e) => {
    e.preventDefault();
    void run(async () => {
      await API.invite({ email, language: lang });
      setEmail('');
      invitations.reload();
    }, t('settings.invited'));
  };
  return html`<section class="card" data-testid="settings-family">
    <h2>${t('settings.family')}</h2>
    <h3>${t('settings.invite')}</h3>
    <form class="invite-form" onSubmit=${send}>
      <label class="field"
        ><span>${t('settings.email')}</span
        ><input
          type="email"
          required
          data-testid="invite-email"
          value=${email}
          onInput=${(/** @type {Event} */ e) => setEmail(/** @type {HTMLInputElement} */ (e.currentTarget).value)}
      /></label>
      <label class="field"
        ><span>${t('settings.inviteLanguage')}</span>
        <select
          data-testid="invite-language"
          onChange=${(/** @type {Event} */ e) => setLang(/** @type {HTMLSelectElement} */ (e.currentTarget).value === 'en' ? 'en' : 'cs')}
        >
          <option value="cs" selected=${lang === 'cs'}>Čeština</option>
          <option value="en" selected=${lang === 'en'}>English</option>
        </select>
      </label>
      <button type="submit" class="button primary" data-testid="send-invitation">${t('settings.sendInvitation')}</button>
    </form>
    <${Status} text=${text} error=${error} testid="invite-status" />
    <ul class="plain-list" data-testid="invitations">
      ${(invitations.data?.items ?? []).map(
        (i) =>
          html`<li key=${i.id} data-testid="invitation" data-email=${i.email}>
            <span>${i.email}</span> <span class=${`chip status-${i.status}`} data-testid="invitation-status">${t(`settings.invitation.${i.status}`)}</span>
            ${
              i.status === 'pending'
                ? html` <button
                    type="button"
                    class="link-button"
                    onClick=${() => void run(async () => (await API.revokeInvitation(i.id), invitations.reload()))}
                  >
                    ${t('settings.withdraw')}
                  </button>`
                : null
            }
          </li>`,
      )}
    </ul>
    <h3>${t('settings.members')}</h3>
    <ul class="plain-list members" data-testid="members">
      ${(members.data?.items ?? []).map((m) => html`<${MemberRow} key=${m.id} member=${m} me=${me} onChange=${members.reload} />`)}
    </ul>
  </section>`;
}

/**
 * The Family roots (tree-model spec, "Family roots"): the Persons the family descends from, from
 * which every relation to the family is computed. Until the first is marked, the app shows
 * everyone and this section asks the Owner to mark one.
 * @param {{ refreshMe: SettingsProps['refreshMe'] }} props
 */
function FamilyRootsSection({ refreshMe }) {
  const roots = useLoad((signal) => API.listFamilyRoots(signal));
  const [adding, setAdding] = useState(false);
  const [text, error, run] = useAction();
  const change = (/** @type {string} */ personId, /** @type {boolean} */ familyRoot, /** @type {string} */ done) =>
    run(async () => {
      await API.setFamilyRoot(personId, familyRoot);
      setAdding(false);
      roots.reload();
      await refreshMe();
    }, done);
  const items = roots.data?.items ?? [];
  return html`<section class="card" data-testid="settings-family-roots">
    <h2>${t('settings.familyRoots')}</h2>
    <p class="muted small">${t('settings.familyRootsText')}</p>
    ${roots.data && items.length === 0 ? html`<p class="prompt" role="note" data-testid="family-roots-prompt">${t('settings.familyRootsPrompt')}</p>` : null}
    <ul class="plain-list" data-testid="family-roots">
      ${items.map(
        (p) =>
          html`<li key=${p.id} data-testid="family-root" data-id=${p.id}>
            <${PersonLine} person=${p} href=${`#people/${p.id}`} />
            <button type="button" class="link-button" data-testid="family-root-remove" onClick=${() => void change(p.id, false, t('settings.rootRemoved'))}>
              ${t('settings.remove')}
            </button>
          </li>`,
      )}
    </ul>
    <button type="button" class="button" data-testid="family-root-add" aria-expanded=${adding ? 'true' : 'false'} onClick=${() => setAdding(!adding)}>
      ${t('settings.addFamilyRoot')}
    </button>
    ${adding ? html`<${PersonPick} testid="root-person" onPick=${(/** @type {PersonSummary} */ p) => void change(p.id, true, t('settings.rootMarked'))} />` : null}
    <${Status} text=${text} error=${error} testid="family-roots-status" />
  </section>`;
}

/** @param {SettingsProps} props */
export function SettingsScreen({ me, chooseLanguage, signOut, refreshMe }) {
  const [text, error, run] = useAction();
  return html`<section class="screen-body settings-screen" data-testid="settings-screen">
    <h1>${t('settings.title')}</h1>
    <section class="card" data-testid="settings-account">
      <h2>${t('settings.account')}</h2>
      <p><strong>${me.displayName}</strong> <span class="muted">${me.email}</span></p>
      <p class="muted small">${t('settings.yourRole', { role: t(`settings.role.${me.role}`) })}</p>
      <button type="button" class="button" data-testid="sign-out" onClick=${() => void run(signOut)}>${t('settings.signOut')}</button>
      <${Status} text=${text} error=${error} />
    </section>
    <${LanguageSection} chooseLanguage=${chooseLanguage} />
    <${PasskeysSection} me=${me} refreshMe=${refreshMe} />
    <${SessionsSection} />
    ${me.permissions.markFamilyRoots ? html`<${FamilyRootsSection} refreshMe=${refreshMe} />` : null}
    ${me.role === 'owner' ? html`<${FamilySection} me=${me} />` : null}
    <section class="card">
      <h2>${t('settings.about')}</h2>
      <p class="muted small">${t('settings.version', { version: APP_VERSION })}</p>
    </section>
  </section>`;
}
