// Signing in, in the app (family-view spec, "Sign-in in the app"): from an invitation link to a
// registered passkey (#invite/<token>), the emailed sign-in link (#link/<token>), and signing
// in with a passkey or asking for an emailed link (#sign-in, or any family address opened
// without signing in, which then opens once signed in). The tokens are taken out of the
// address at once, so they stay out of the history and of screenshots.
//
// Opening an invitation only checks it; only sending the form accepts it, so a link preview or a
// second visit uses nothing up (member-accounts spec, "Opening an invitation link uses nothing
// up"). The page shows the invited address before accepting, since a link that came through a
// chat does not prove the relative reads it (family-view spec, "The invited address on the
// invitation page").
//
// The link that confirms a new address the Owner gave a Member (#address/<token>) opens here too:
// opening it changes nothing, and only the button confirms it (family-view spec, "The address
// confirmation page"). Confirming signs nobody in.

import { acceptInvitation, ApiError, checkInvitation, confirmEmailChange, messageOf, requestEmailLink, verifyEmailLink } from './api.js';
import { language, setLanguage, storedLanguage, t } from './i18n.js';
import { html, useEffect, useState } from './ui.js';
import { passkeysSupported, registerPasskey, signInWithPasskey } from './webauthn.js';

/** @typedef {import('./types.js').Me} Me */
/** @typedef {{ onSignedIn: (me: Me) => Promise<void>, go: (hash: string) => void, me: Me | null, refreshMe: () => Promise<void> }} Shell */

const AFTER_KEY = 'rodokmen.afterSignIn';

/**
 * The family address someone opened before signing in (a link a relative sent): kept on the
 * device, so that signing in with an emailed link, which opens a new page, still leads there.
 * @param {string | null} hash
 */
function rememberAfterSignIn(hash) {
  try {
    if (hash) localStorage.setItem(AFTER_KEY, hash);
    else localStorage.removeItem(AFTER_KEY);
  } catch {
    // storage blocked: the tree opens on the home screen instead
  }
}

/** Where to go once signed in, forgotten as it is read. */
function takeAfterSignIn() {
  let hash = '';
  try {
    hash = localStorage.getItem(AFTER_KEY) ?? '';
    localStorage.removeItem(AFTER_KEY);
  } catch {
    // storage blocked
  }
  return hash;
}

/** @param {unknown} error */
const failure = (error) => (error instanceof ApiError && error.offline ? t('family.offline') : messageOf(error));

/** @param {{ text: string, error?: boolean }} props */
const Status = ({ text, error = false }) =>
  html`<p class=${`form-status${error ? ' error' : ''}`} role="status" aria-live="polite" data-testid="sign-in-status">${text}</p>`;

/**
 * Offers to save a passkey on this device, then opens the tree.
 * @param {{ intro: string, done: () => void }} props
 */
function PasskeyStep({ intro, done }) {
  const [status, setStatus] = useState({ text: intro, error: false });
  const [busy, setBusy] = useState(false);
  if (!passkeysSupported()) {
    return html`<div data-testid="passkey-step">
      <${Status} text=${t('signIn.noPasskeys')} /><button type="button" class="button primary" data-testid="open-tree" onClick=${done}>
        ${t('signIn.openTree')}
      </button>
    </div>`;
  }
  const save = async () => {
    setBusy(true);
    try {
      await registerPasskey();
      setStatus({ text: t('signIn.passkeySaved'), error: false });
      done();
    } catch (error) {
      setStatus({ text: error instanceof ApiError ? failure(error) : t('signIn.passkeyFailed'), error: true });
      setBusy(false);
    }
  };
  return html`<div data-testid="passkey-step">
    <${Status} text=${status.text} error=${status.error} />
    <p class="muted">${t('signIn.passkeyWhy')}</p>
    <div class="form-actions">
      <button type="button" class="link-button" data-testid="skip-passkey" onClick=${done}>${t('signIn.later')}</button>
      <button type="button" class="button primary" data-testid="register-passkey" disabled=${busy} onClick=${() => void save()}>
        ${t('signIn.savePasskey')}
      </button>
    </div>
  </div>`;
}

/** @param {{ token: string, shell: Shell }} props */
function Invitation({ token, shell }) {
  const [check, setCheck] = useState(/** @type {{ status: string, message: string, email?: string | null } | null} */ (null));
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [lang, setLang] = useState(/** @type {'cs' | 'en'} */ (language()));
  const [step, setStep] = useState(/** @type {'form' | 'passkey'} */ ('form'));
  useEffect(() => {
    checkInvitation(token).then(
      (c) => {
        setCheck(c);
        setLang(c.language);
        // The invitation's language, unless the reader chose one on this device.
        if (!storedLanguage() && c.language !== language()) void setLanguage(c.language).catch(() => undefined);
      },
      (e) => setError(failure(e)),
    );
  }, [token]);
  const accept = async (/** @type {Event} */ e) => {
    e.preventDefault();
    setError('');
    try {
      const result = await acceptInvitation({ token, displayName: name, language: lang });
      await shell.onSignedIn(result.member);
      setStep('passkey');
    } catch (err) {
      setError(failure(err));
    }
  };
  if (error && !check) return html`<${Status} text=${error} error=${true} />`;
  if (!check) return html`<${Status} text=${t('signIn.checking')} />`;
  if (check.status !== 'pending' && step === 'form') return html`<${Status} text=${check.message} error=${true} />`;
  if (step === 'passkey') return html`<${PasskeyStep} intro=${t('signIn.welcome')} done=${() => shell.go(takeAfterSignIn())} />`;
  return html`<form class="sign-in-form" data-testid="invite-form" onSubmit=${(/** @type {Event} */ e) => void accept(e)}>
    <p class="muted">${check.message}</p>
    ${
      check.email
        ? html`<div class="invite-address" data-testid="invite-address">
            <p><strong>${t('signIn.inviteAddress', { email: check.email })}</strong></p>
            <p class="muted small">${t('signIn.inviteAddressWhy')}</p>
          </div>`
        : null
    }
    <label class="field"
      ><span>${t('signIn.name')}</span>
      <input
        name="name"
        autocomplete="name"
        required
        maxlength="100"
        data-testid="invite-name"
        value=${name}
        onInput=${(/** @type {Event} */ e) => setName(/** @type {HTMLInputElement} */ (e.currentTarget).value)}
      />
    </label>
    <label class="field"
      ><span>${t('signIn.language')}</span>
      <select
        data-testid="invite-language"
        onChange=${(/** @type {Event} */ e) => setLang(/** @type {HTMLSelectElement} */ (e.currentTarget).value === 'en' ? 'en' : 'cs')}
      >
        <option value="cs" selected=${lang === 'cs'}>Čeština</option>
        <option value="en" selected=${lang === 'en'}>English</option>
      </select>
    </label>
    ${error ? html`<${Status} text=${error} error=${true} />` : null}
    <button type="submit" class="button primary" data-testid="accept-invitation">${t('signIn.accept')}</button>
  </form>`;
}

/** @param {{ token: string, shell: Shell }} props */
function EmailLink({ token, shell }) {
  const [status, setStatus] = useState({ text: t('signIn.linkReady'), error: false });
  const [step, setStep] = useState(/** @type {'tap' | 'passkey'} */ ('tap'));
  const verify = async () => {
    try {
      const result = await verifyEmailLink(token);
      await shell.onSignedIn(result.member);
      setStep('passkey');
    } catch (error) {
      setStatus({ text: failure(error), error: true });
    }
  };
  if (step === 'passkey') return html`<${PasskeyStep} intro=${t('signIn.signedIn')} done=${() => shell.go(takeAfterSignIn())} />`;
  return html`<div>
    <${Status} text=${status.text} error=${status.error} />
    <button type="button" class="button primary" data-testid="link-sign-in" onClick=${() => void verify()}>${t('signIn.signIn')}</button>
  </div>`;
}

/**
 * Confirms a new address with the token from its link. 410 (used, expired, withdrawn or replaced)
 * and 409 (another Member's by now) get texts in the reader's language.
 * @param {{ token: string, shell: Shell }} props
 */
function AddressConfirmation({ token, shell }) {
  const [status, setStatus] = useState({ text: '', error: false });
  const [email, setEmail] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      const result = await confirmEmailChange(token);
      setEmail(result.email);
      // A Member signed in on this device sees their new address in Settings.
      if (shell.me) await shell.refreshMe().catch(() => undefined);
    } catch (error) {
      const text =
        error instanceof ApiError && error.status === 410
          ? t('address.invalid')
          : error instanceof ApiError && error.status === 409
            ? t('address.taken')
            : failure(error);
      setStatus({ text, error: true });
      setBusy(false);
    }
  };
  if (email !== null) {
    return html`<div data-testid="address-confirmed">
      <${Status} text=${t('address.done', { email })} />
      <button type="button" class="button primary" data-testid="address-open" onClick=${() => shell.go('')}>${t('address.open')}</button>
    </div>`;
  }
  return html`<div>
    <p class="muted">${t('address.text')}</p>
    <button type="button" class="button primary" data-testid="address-confirm" disabled=${busy} onClick=${() => void confirm()}>${t('address.confirm')}</button>
    ${status.text ? html`<${Status} text=${status.text} error=${status.error} />` : null}
  </div>`;
}

/** @param {{ shell: Shell, then: string | null }} props then: where to go once signed in, null to stay */
function SignInChoices({ shell, then }) {
  const [status, setStatus] = useState({ text: '', error: false });
  const [email, setEmail] = useState('');
  const withPasskey = async () => {
    try {
      const result = await signInWithPasskey();
      await shell.onSignedIn(result.member);
      rememberAfterSignIn(null);
      if (then !== null) shell.go(then);
    } catch {
      setStatus({ text: t('signIn.passkeySignInFailed'), error: true });
    }
  };
  const sendLink = async (/** @type {Event} */ e) => {
    e.preventDefault();
    try {
      await requestEmailLink(email);
      setStatus({ text: t('signIn.linkSent'), error: false });
    } catch (error) {
      setStatus({ text: failure(error), error: true });
    }
  };
  return html`<div class="sign-in-choices">
    ${passkeysSupported() ? html`<button type="button" class="button primary" data-testid="passkey-sign-in" onClick=${() => void withPasskey()}>${t('signIn.withPasskey')}</button>` : null}
    <form class="sign-in-form" onSubmit=${(/** @type {Event} */ e) => void sendLink(e)}>
      <label class="field"
        ><span>${t('signIn.noPasskey')}</span>
        <input
          type="email"
          autocomplete="email"
          required
          data-testid="sign-in-email"
          value=${email}
          onInput=${(/** @type {Event} */ e) => setEmail(/** @type {HTMLInputElement} */ (e.currentTarget).value)}
        />
      </label>
      <button type="submit" class="button" data-testid="send-link">${t('signIn.sendLink')}</button>
    </form>
    <${Status} text=${status.text} error=${status.error} />
  </div>`;
}

/**
 * @param {{ mode: 'sign-in' | 'required' | 'invite' | 'link' | 'address', token?: string, shell: Shell }} props
 */
export function SignInScreen({ mode, token, shell }) {
  // The token is read once from the address and kept only here.
  useEffect(() => {
    if ((mode === 'invite' || mode === 'link' || mode === 'address') && token) history.replaceState(null, '', `${location.pathname}${location.search}#${mode}`);
    if (mode === 'required') rememberAfterSignIn(location.hash);
  }, [mode, token]);
  const title = mode === 'invite' ? t('signIn.inviteTitle') : mode === 'address' ? t('address.title') : t('signIn.title');
  let body;
  if (mode === 'invite' && token) body = html`<${Invitation} token=${token} shell=${shell} />`;
  else if (mode === 'link' && token) body = html`<${EmailLink} token=${token} shell=${shell} />`;
  else if (mode === 'address' && token) body = html`<${AddressConfirmation} token=${token} shell=${shell} />`;
  else
    body = html`${mode === 'required' ? html`<p class="muted" data-testid="sign-in-required">${t('signIn.required')}</p>` : null}<${SignInChoices}
        shell=${shell}
        then=${mode === 'sign-in' ? '' : null}
      />`;
  return html`<section class="screen-body sign-in" data-testid="sign-in-screen" data-mode=${mode}>
    <h1>${title}</h1>
    ${body}
    <p><a href="#map" data-testid="to-map">${t('signIn.toMap')}</a></p>
  </section>`;
}
