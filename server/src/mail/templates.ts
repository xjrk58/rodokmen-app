import type { UiLanguage } from '@rodokmen/shared';
import type { MailMessage } from './mailer.js';

/**
 * Emails in the recipient's language (member-accounts spec, "Emails in the Member's language").
 * Each template returns a plain-text and an HTML body with the same content.
 */

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

interface Body {
  subject: string;
  /** Paragraphs before the button. */
  intro: string[];
  button: { label: string; url: string };
  /** Paragraphs after the button. */
  outro: string[];
  signature: string;
}

function render(to: string, body: Body): MailMessage {
  const text = [...body.intro, body.button.url, ...body.outro, body.signature].join('\n\n') + '\n';
  const p = (t: string) => `<p style="margin:0 0 16px">${escapeHtml(t)}</p>`;
  const html = [
    '<!doctype html>',
    `<html><body style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:16px;line-height:1.5;color:#1f2933;max-width:560px;margin:0 auto;padding:24px">`,
    ...body.intro.map(p),
    `<p style="margin:24px 0"><a href="${escapeHtml(body.button.url)}" style="background:#7a3e1d;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(body.button.label)}</a></p>`,
    `<p style="margin:0 0 16px;font-size:13px;color:#52606d;word-break:break-all">${escapeHtml(body.button.url)}</p>`,
    ...body.outro.map(p),
    `<p style="margin:24px 0 0;color:#52606d">${escapeHtml(body.signature)}</p>`,
    '</body></html>',
  ].join('\n');
  return { to, subject: body.subject, text, html };
}

export interface InvitationEmail {
  to: string;
  language: UiLanguage;
  inviterName: string;
  link: string;
  days: number;
}

export function invitationEmail(e: InvitationEmail): MailMessage {
  if (e.language === 'cs') {
    return render(e.to, {
      subject: 'Pozvánka do Rodokmenu',
      intro: [
        'Dobrý den,',
        `${e.inviterName} vás zve do Rodokmenu, společného rodokmenu naší rodiny s mapou míst, odkud naši předkové pocházeli.`,
        `Pozvánku přijmete tímto odkazem. Platí ${e.days} dní a dá se použít jen jednou.`,
      ],
      button: { label: 'Přijmout pozvánku', url: e.link },
      outro: [
        'Po otevření si zvolíte jméno, které uvidí ostatní, a jazyk. Potom si do telefonu uložíte přístupový klíč (passkey), takže žádné heslo nepotřebujete.',
        `Pokud odkaz vypršel, požádejte o novou pozvánku správce Rodokmenu (${e.inviterName}). Pokud jste pozvánku nečekali, e-mail klidně ignorujte.`,
      ],
      signature: 'Rodokmen',
    });
  }
  return render(e.to, {
    subject: 'Your invitation to Rodokmen',
    intro: [
      'Hello,',
      `${e.inviterName} invites you to Rodokmen, our family's shared family tree, with a map of the places our ancestors came from.`,
      `Accept the invitation with this link. It is valid for ${e.days} days and works only once.`,
    ],
    button: { label: 'Accept the invitation', url: e.link },
    outro: [
      'When it opens, you choose the name others will see and your language. Then you save a passkey on your phone, so you never need a password.',
      `If the link has expired, ask ${e.inviterName} for a new invitation. If you were not expecting this, you can ignore this email.`,
    ],
    signature: 'Rodokmen',
  });
}

export interface SignInLinkEmail {
  to: string;
  language: UiLanguage;
  displayName: string;
  link: string;
  minutes: number;
}

export function signInLinkEmail(e: SignInLinkEmail): MailMessage {
  if (e.language === 'cs') {
    return render(e.to, {
      subject: 'Přihlášení do Rodokmenu',
      intro: [
        'Dobrý den,',
        `někdo (nejspíš vy, ${e.displayName}) požádal o přihlášení do Rodokmenu. Přihlásíte se tímto odkazem. Platí ${e.minutes} minut a dá se použít jen jednou.`,
      ],
      button: { label: 'Přihlásit se', url: e.link },
      outro: [
        'Po přihlášení si můžete na tomto zařízení uložit přístupový klíč (passkey). Příště se pak přihlásíte bez e-mailu.',
        'Pokud jste o přihlášení nežádali, e-mail ignorujte. Bez tohoto odkazu se nikdo nepřihlásí.',
      ],
      signature: 'Rodokmen',
    });
  }
  return render(e.to, {
    subject: 'Sign in to Rodokmen',
    intro: [`Hello ${e.displayName},`, `Someone (most likely you) asked to sign in to Rodokmen. Sign in with this link. It is valid for ${e.minutes} minutes and works only once.`],
    button: { label: 'Sign in', url: e.link },
    outro: [
      'Once you are signed in, you can save a passkey on this device, so next time you sign in without email.',
      'If you did not ask to sign in, ignore this email. Nobody can sign in without this link.',
    ],
    signature: 'Rodokmen',
  });
}

export interface AlertEmail {
  to: string;
  subject: string;
  details: string;
  origin: string;
}

/** Operational alerts go to the Owner in English, with the facts the Owner needs to act. */
export function alertEmail(e: AlertEmail): MailMessage {
  const subject = `[Rodokmen alert] ${e.subject}`;
  const text = `${e.subject}\n\n${e.details}\n\nServer: ${e.origin}\nSee deploy/README.md, "When an alert arrives".\n`;
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif"><h2>${escapeHtml(e.subject)}</h2><pre style="white-space:pre-wrap">${escapeHtml(e.details)}</pre><p>Server: ${escapeHtml(e.origin)}<br>See deploy/README.md, "When an alert arrives".</p></body></html>`;
  return { to: e.to, subject, text, html };
}
