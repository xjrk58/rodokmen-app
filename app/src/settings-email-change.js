// Correcting a Member's address in Owner settings (family-view spec, "Correcting a Member's
// address in Settings"). The new address takes effect only once the link Rodokmen emails to it is
// confirmed (member-accounts spec, "The Owner corrects a Member's address"). Until then sign-in
// links still go to the old address, and the waiting address shows here, with Withdraw.

import * as API from './api.js';
import { t } from './i18n.js';
import { Status, useAction } from './settings-parts.js';
import { html, useState } from './ui.js';

/** @typedef {import('./types.js').MemberView} MemberView */

/** What the server's refusals say, in the reader's language. @type {Record<string, string>} */
const REFUSALS = {
  email_unchanged: 'settings.emailUnchanged',
  already_member: 'settings.emailTaken',
  invitation_pending: 'settings.emailInvited',
};

/** @param {unknown} error */
function refusal(error) {
  const key = error instanceof API.ApiError ? REFUSALS[error.code] : undefined;
  return key ? new Error(t(key)) : error;
}

/**
 * A Member's waiting address, and the form that gives them a new one.
 * @param {{ member: MemberView, onChange: () => void }} props
 */
export function MemberEmail({ member, onChange }) {
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState('');
  const [text, error, run] = useAction();
  const send = (/** @type {Event} */ e) => {
    e.preventDefault();
    const address = email.trim();
    void run(
      async () => {
        await API.changeMemberEmail(member.id, address).catch((/** @type {unknown} */ err) => {
          throw refusal(err);
        });
        setEditing(false);
        setEmail('');
        onChange();
      },
      t('settings.emailChangeSent', { email: address }),
    );
  };
  const withdraw = () =>
    run(async () => {
      await API.withdrawEmailChange(member.id);
      onChange();
    }, t('settings.emailChangeWithdrawn'));
  return html`<div class="member-email small" data-testid="member-email">
    ${
      member.pendingEmail
        ? html`<p class="member-pending-email" data-testid="member-pending-email">
            <span class="muted">${t('settings.pendingEmail', { email: member.pendingEmail })}</span>
            <button type="button" class="link-button" data-testid="member-email-withdraw" onClick=${() => void withdraw()}>${t('settings.withdraw')}</button>
          </p>`
        : null
    }
    ${
      editing
        ? html`<form class="member-email-form" data-testid="member-email-form" onSubmit=${send}>
            <label class="field"
              ><span>${t('settings.newEmail')}</span
              ><input
                type="email"
                required
                autocomplete="off"
                data-testid="member-email-input"
                value=${email}
                onInput=${(/** @type {Event} */ e) => setEmail(/** @type {HTMLInputElement} */ (e.currentTarget).value)}
            /></label>
            <p class="muted">${t('settings.emailChangeNote')}</p>
            <div class="form-actions">
              <button type="button" class="link-button" data-testid="member-email-cancel" onClick=${() => setEditing(false)}>
                ${t('settings.cancelEmailChange')}
              </button>
              <button type="submit" class="button primary" data-testid="member-email-send">${t('settings.sendEmailConfirmation')}</button>
            </div>
          </form>`
        : html`<button type="button" class="link-button" data-testid="member-email-edit" onClick=${() => setEditing(true)}>
            ${t('settings.correctEmail')}
          </button>`
    }
    <${Status} text=${text} error=${error} testid="member-email-status" />
  </div>`;
}
