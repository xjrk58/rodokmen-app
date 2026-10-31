// Passkeys in the browser: the WebAuthn options and answers the API passes as JSON (base64url
// for binary fields, as @simplewebauthn on the server expects), converted to and from what
// navigator.credentials uses. Moved here from the server's former sign-in pages.

import { api } from './api.js';

/** @param {string} s base64url */
export function fromBase64url(s) {
  const bin = atob(
    s
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(s.length / 4) * 4, '='),
  );
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer;
}

/** @param {ArrayBuffer | ArrayBufferView} buf */
export function toBase64url(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @typedef {{ id: string, type?: string, transports?: string[] }} CredentialRef */

/**
 * @param {Record<string, unknown>} o the API's registration options (PublicKeyCredentialCreationOptionsJSON)
 * @returns {PublicKeyCredentialCreationOptions}
 */
export function creationOptions(o) {
  const user = /** @type {{ id: string, name: string, displayName: string }} */ (o.user);
  const exclude = /** @type {CredentialRef[] | undefined} */ (o.excludeCredentials) ?? [];
  return /** @type {PublicKeyCredentialCreationOptions} */ ({
    ...o,
    challenge: fromBase64url(/** @type {string} */ (o.challenge)),
    user: { ...user, id: fromBase64url(user.id) },
    excludeCredentials: exclude.map((c) => ({ ...c, type: 'public-key', id: fromBase64url(c.id) })),
  });
}

/**
 * @param {Record<string, unknown>} o the API's authentication options
 * @returns {PublicKeyCredentialRequestOptions}
 */
export function requestOptions(o) {
  const allow = /** @type {CredentialRef[] | undefined} */ (o.allowCredentials) ?? [];
  return /** @type {PublicKeyCredentialRequestOptions} */ ({
    ...o,
    challenge: fromBase64url(/** @type {string} */ (o.challenge)),
    allowCredentials: allow.map((c) => ({ ...c, type: 'public-key', id: fromBase64url(c.id) })),
  });
}

/** @param {PublicKeyCredential} cred */
function common(cred) {
  return {
    id: cred.id,
    rawId: toBase64url(cred.rawId),
    type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
  };
}

/**
 * Registers a passkey on this device for the signed-in Member.
 * @returns {Promise<void>}
 */
export async function registerPasskey() {
  /** @type {Record<string, unknown>} */
  const options = await api('auth/passkey/registration/options', { method: 'POST' });
  const cred = await navigator.credentials.create({ publicKey: creationOptions(options) });
  if (!(cred instanceof PublicKeyCredential) || !(cred.response instanceof AuthenticatorAttestationResponse)) throw new Error('No passkey was created.');
  const r = cred.response;
  const response = {
    ...common(cred),
    response: { clientDataJSON: toBase64url(r.clientDataJSON), attestationObject: toBase64url(r.attestationObject), transports: r.getTransports() },
  };
  // userAgentData (Chromium) names the platform, such as "Android"; other browsers get a plain name.
  const data = 'userAgentData' in navigator ? navigator.userAgentData : null;
  const platform = typeof data === 'object' && data !== null && 'platform' in data && typeof data.platform === 'string' ? data.platform : '';
  await api('auth/passkey/registration/verify', { method: 'POST', body: { response, name: platform || 'Passkey' } });
}

/**
 * Signs in with a passkey on this device.
 * @returns {Promise<import('./types.js').SignedIn>}
 */
export async function signInWithPasskey() {
  /** @type {Record<string, unknown>} */
  const options = await api('auth/passkey/authentication/options', { method: 'POST' });
  const cred = await navigator.credentials.get({ publicKey: requestOptions(options) });
  if (!(cred instanceof PublicKeyCredential) || !(cred.response instanceof AuthenticatorAssertionResponse)) throw new Error('No passkey was used.');
  const r = cred.response;
  const response = {
    ...common(cred),
    response: {
      clientDataJSON: toBase64url(r.clientDataJSON),
      authenticatorData: toBase64url(r.authenticatorData),
      signature: toBase64url(r.signature),
      userHandle: r.userHandle ? toBase64url(r.userHandle) : undefined,
    },
  };
  return api('auth/passkey/authentication/verify', { method: 'POST', body: { response } });
}

/** Whether this browser can use passkeys at all. */
export const passkeysSupported = () => typeof window.PublicKeyCredential === 'function' && typeof navigator.credentials?.create === 'function';
