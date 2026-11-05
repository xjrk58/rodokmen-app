// A new invitation's WhatsApp message in Owner settings (family-view spec, "Sending an invitation
// through WhatsApp"). The invitation email has already gone out; this block lets the Owner send
// the same link from their own WhatsApp too: through the device's share sheet where there is one,
// and by copying the message everywhere. No web address with the token is ever opened (such as
// wa.me, which would hand the token to a web server outside the family).
//
// The link is in full only in the answer that created the invitation. It lives in this block's
// state alone: never in IndexedDB, localStorage or a Draft, so it is gone once the Owner clicks
// Done or leaves Settings, and the list of invitations never shows it.

import { t } from './i18n.js';
import { Status } from './settings-parts.js';
import { html, useEffect, useRef, useState } from './ui.js';

/** @typedef {import('./types.js').CreatedInvitation} CreatedInvitation */

/**
 * Whether this browser can hand the text to the device's share sheet (the Web Share API).
 * @param {string} text
 */
function canShare(text) {
  if (typeof navigator.share !== 'function') return false;
  return typeof navigator.canShare === 'function' ? navigator.canShare({ text }) : true;
}

/**
 * The invitation just created, with its message to send through WhatsApp, shown this once.
 * @param {{ invitation: CreatedInvitation, onDone: () => void }} props
 */
export function InvitationShare({ invitation, onDone }) {
  const box = useRef(/** @type {HTMLDivElement | null} */ (null));
  const message = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
  const first = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const [status, setStatus] = useState({ text: '', error: false });
  const sharing = canShare(invitation.shareText);
  useEffect(() => {
    box.current?.scrollIntoView({ block: 'nearest' });
    first.current?.focus({ preventScroll: true });
  }, [invitation.id]);

  const share = async () => {
    setStatus({ text: '', error: false });
    try {
      // Only `text`, with the link inside it: share targets differ in how they join title, text and url.
      await navigator.share({ text: invitation.shareText });
    } catch (error) {
      // Closing the share sheet is not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setStatus({ text: t('settings.whatsapp.shareFailed'), error: true });
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invitation.shareText);
      setStatus({ text: t('settings.whatsapp.copied'), error: false });
    } catch {
      // No clipboard here (or it was refused): select the message, so it can be copied by hand.
      message.current?.focus();
      message.current?.select();
      setStatus({ text: t('settings.whatsapp.copyByHand'), error: true });
    }
  };

  return html`<div class="token-once invitation-share" role="group" aria-labelledby="invitation-share-title" data-testid="invitation-share" ref=${box}>
    <h4 id="invitation-share-title">${t('settings.whatsapp.title')}</h4>
    <p class="small">${sharing ? t('settings.whatsapp.textShare') : t('settings.whatsapp.textCopy')}</p>
    <textarea
      class="invitation-message"
      readonly
      rows="7"
      aria-label=${t('settings.whatsapp.message')}
      data-testid="invitation-message"
      ref=${message}
      value=${invitation.shareText}
    ></textarea>
    <p class="small"><strong>${t('settings.whatsapp.onlyNow')}</strong> ${t('settings.whatsapp.lost')}</p>
    <div class="token-actions">
      ${
        sharing
          ? html`<button type="button" class="button primary" data-testid="invitation-whatsapp" ref=${first} onClick=${() => void share()}>
              ${t('settings.whatsapp.send')}
            </button>`
          : null
      }
      <button
        type="button"
        class=${sharing ? 'button' : 'button primary'}
        data-testid="invitation-copy"
        ref=${sharing ? null : first}
        onClick=${() => void copy()}
      >
        ${t('settings.whatsapp.copy')}
      </button>
      <button type="button" class="button" data-testid="invitation-share-done" onClick=${onDone}>${t('settings.whatsapp.done')}</button>
    </div>
    <${Status} text=${status.text} error=${status.error} testid="invitation-share-status" />
  </div>`;
}
