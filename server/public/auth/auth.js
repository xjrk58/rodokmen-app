// Sign-in pages: accepting an invitation, signing in with an emailed link or a passkey, and
// saving a passkey on this device. Plain ES module, no build step. These screens can move into
// the app later; the API they call stays the same.

const STRINGS = {
  cs: {
    switchTo: 'English',
    name: 'Jméno, které uvidí ostatní',
    language: 'Jazyk',
    accept: 'Přijmout pozvánku',
    checking: 'Ověřuji odkaz…',
    noToken: 'Odkaz je neúplný. Otevřete ho prosím znovu z e-mailu.',
    welcome: 'Vítejte! Teď si uložte přístupový klíč.',
    passkeyWhy: 'Přístupový klíč (passkey) se uloží v tomto telefonu. Příště se přihlásíte otiskem prstu nebo zámkem obrazovky, bez hesla.',
    savePasskey: 'Uložit přístupový klíč',
    later: 'Teď ne',
    passkeySaved: 'Přístupový klíč je uložený. Jste přihlášeni.',
    passkeyFailed: 'Přístupový klíč se nepodařilo uložit. Zkuste to znovu, nebo se příště přihlaste odkazem z e-mailu.',
    signInWithLink: 'Přihlásit se',
    signedInShort: 'Jste přihlášeni.',
    linkReady: 'Klepnutím se přihlásíte.',
    signedIn: 'Jste přihlášeni. Chcete si na tomto zařízení uložit přístupový klíč?',
    signInWithPasskey: 'Přihlásit se přístupovým klíčem',
    noPasskey: 'Nemáte v tomto zařízení klíč? Pošleme vám přihlašovací odkaz e-mailem.',
    sendLink: 'Poslat odkaz',
    linkSent: 'Pokud je adresa v Rodokmenu, odkaz je na cestě. Platí 15 minut.',
    passkeySignInFailed: 'Přihlášení klíčem se nepovedlo. Pošlete si odkaz e-mailem.',
    openApp: 'Otevřít Rodokmen',
    failed: 'Něco se nepovedlo. Zkuste to prosím znovu.',
  },
  en: {
    switchTo: 'Čeština',
    name: 'The name others will see',
    language: 'Language',
    accept: 'Accept the invitation',
    checking: 'Checking the link…',
    noToken: 'The link is incomplete. Please open it again from the email.',
    welcome: 'Welcome! Now save a passkey.',
    passkeyWhy: 'A passkey is kept on this phone. Next time you sign in with your fingerprint or screen lock, without a password.',
    savePasskey: 'Save a passkey',
    later: 'Not now',
    passkeySaved: 'Your passkey is saved. You are signed in.',
    passkeyFailed: 'The passkey could not be saved. Try again, or sign in with an emailed link next time.',
    signInWithLink: 'Sign in',
    signedInShort: 'You are signed in.',
    linkReady: 'Tap to sign in.',
    signedIn: 'You are signed in. Save a passkey on this device?',
    signInWithPasskey: 'Sign in with a passkey',
    noPasskey: 'No passkey on this device? We will email you a sign-in link.',
    sendLink: 'Send the link',
    linkSent: 'If this address belongs to a Member, the link is on its way. It is valid for 15 minutes.',
    passkeySignInFailed: 'Signing in with a passkey did not work. Get a link by email instead.',
    openApp: 'Open Rodokmen',
    failed: 'Something went wrong. Please try again.',
  },
};

const $ = (id) => document.getElementById(id);
let lang = localStorage.getItem('rodokmen.language') || ((navigator.language || '').toLowerCase().startsWith('cs') ? 'cs' : 'en');

function t(key) {
  return STRINGS[lang][key] ?? key;
}

function applyLanguage() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  $('lang-switch').textContent = t('switchTo');
}

function setLanguage(next) {
  lang = next;
  localStorage.setItem('rodokmen.language', next);
  applyLanguage();
}

function status(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function show(...ids) {
  for (const id of ['invite-form', 'link-step', 'passkey-step', 'sign-in-step', 'done']) $(id).hidden = !ids.includes(id);
}

async function api(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(data?.message || t('failed')), { status: response.status, code: data?.code });
  return data;
}

// ---- WebAuthn JSON <-> binary (base64url)

const fromB64 = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(b, (c) => c.charCodeAt(0)).buffer;
};
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function creationOptions(o) {
  return {
    ...o,
    challenge: fromB64(o.challenge),
    user: { ...o.user, id: fromB64(o.user.id) },
    excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: fromB64(c.id) })),
  };
}

function requestOptions(o) {
  return { ...o, challenge: fromB64(o.challenge), allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: fromB64(c.id) })) };
}

function registrationJson(cred) {
  const r = cred.response;
  return {
    id: cred.id,
    rawId: toB64(cred.rawId),
    type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: toB64(r.clientDataJSON),
      attestationObject: toB64(r.attestationObject),
      transports: r.getTransports ? r.getTransports() : [],
    },
  };
}

function authenticationJson(cred) {
  const r = cred.response;
  return {
    id: cred.id,
    rawId: toB64(cred.rawId),
    type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: toB64(r.clientDataJSON),
      authenticatorData: toB64(r.authenticatorData),
      signature: toB64(r.signature),
      userHandle: r.userHandle ? toB64(r.userHandle) : undefined,
    },
  };
}

async function registerPasskey() {
  try {
    const options = await api('/api/auth/passkey/registration/options');
    const credential = await navigator.credentials.create({ publicKey: creationOptions(options) });
    await api('/api/auth/passkey/registration/verify', { response: registrationJson(credential), name: navigator.userAgentData?.platform || 'Passkey' });
    status(t('passkeySaved'));
    show('done');
  } catch (error) {
    status(error.status ? error.message : t('passkeyFailed'), true);
  }
}

async function passkeySignIn() {
  try {
    const options = await api('/api/auth/passkey/authentication/options');
    const credential = await navigator.credentials.get({ publicKey: requestOptions(options) });
    const result = await api('/api/auth/passkey/authentication/verify', { response: authenticationJson(credential) });
    setLanguage(result.member.language);
    status(t('signedInShort'));
    show('done');
  } catch {
    status(t('passkeySignInFailed'), true);
  }
}

function takeToken() {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('token');
  // Keep the token out of history and screenshots.
  if (token) history.replaceState(null, '', location.pathname);
  return token;
}

async function invite(token) {
  status(t('checking'));
  try {
    const check = await api('/api/auth/invitation/check', { token });
    setLanguage(check.language);
    $('language').value = check.language;
    status(check.message, check.status !== 'pending');
    if (check.status !== 'pending') return show();
    show('invite-form');
    $('invite-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const result = await api('/api/auth/invitation/accept', { token, displayName: $('name').value, language: $('language').value });
        setLanguage(result.member.language);
        status(t('welcome'));
        show('passkey-step');
      } catch (error) {
        status(error.message, true);
      }
    });
  } catch (error) {
    status(error.message, true);
  }
}

function link(token) {
  status(t('linkReady'));
  show('link-step');
  $('link-sign-in').addEventListener('click', async () => {
    try {
      const result = await api('/api/auth/email-link/verify', { token });
      setLanguage(result.member.language);
      status(t('signedIn'));
      show('passkey-step');
    } catch (error) {
      status(error.message, true);
    }
  });
}

function signIn() {
  status('');
  show('sign-in-step');
  $('passkey-sign-in').addEventListener('click', passkeySignIn);
  $('email-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/auth/email-link', { email: $('email').value });
      status(t('linkSent'));
    } catch (error) {
      status(error.message, true);
    }
  });
}

applyLanguage();
$('lang-switch').addEventListener('click', () => setLanguage(lang === 'cs' ? 'en' : 'cs'));
$('register-passkey').addEventListener('click', registerPasskey);
$('skip-passkey').addEventListener('click', () => show('done'));

const mode = location.pathname.replace(/\/$/, '').split('/').pop();
if (mode === 'invite' || mode === 'link') {
  const token = takeToken();
  if (!token) status(t('noToken'), true);
  else if (mode === 'invite') invite(token);
  else link(token);
} else {
  signIn();
}
