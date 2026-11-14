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
  /** The one link of the email; a notice that asks nothing of the reader has none. */
  button: { label: string; url: string } | null;
  /** Paragraphs after the button. */
  outro: string[];
  signature: string;
}

function render(to: string, body: Body): MailMessage {
  const text = [...body.intro, ...(body.button ? [body.button.url] : []), ...body.outro, body.signature].join('\n\n') + '\n';
  const p = (t: string) => `<p style="margin:0 0 16px${t.includes('\n') ? ';white-space:pre-line' : ''}">${escapeHtml(t)}</p>`;
  const html = [
    '<!doctype html>',
    `<html><body style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:16px;line-height:1.5;color:#1f2933;max-width:560px;margin:0 auto;padding:24px">`,
    ...body.intro.map(p),
    ...(body.button
      ? [
          `<p style="margin:24px 0"><a href="${escapeHtml(body.button.url)}" style="background:#7a3e1d;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(body.button.label)}</a></p>`,
          `<p style="margin:0 0 16px;font-size:13px;color:#52606d;word-break:break-all">${escapeHtml(body.button.url)}</p>`,
        ]
      : []),
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

export interface InvitationShareText {
  /** The invited address, where the invitation email went. */
  email: string;
  language: UiLanguage;
  inviterName: string;
  link: string;
  days: number;
}

/**
 * The invitation as a chat message, for the Owner to send from their own WhatsApp
 * (member-accounts spec, "The WhatsApp message in the invitation's language"). Plain text: the
 * link stands on its own line, so that the chat app makes it a link.
 */
export function invitationShareText(m: InvitationShareText): string {
  if (m.language === 'cs') {
    return [
      `Dobrý den, ${m.inviterName} vás zve do Rodokmenu, společného rodokmenu naší rodiny s mapou míst, odkud naši předkové pocházeli.`,
      `Pozvánku přijmete tímto odkazem. Platí ${m.days} dní a dá se použít jen jednou, proto ho prosím nikomu nepřeposílejte:\n${m.link}`,
      `Stejná pozvánka vám přišla e-mailem na ${m.email}. Na tuto adresu vám Rodokmen bude posílat odkazy k přihlášení. Pokud není vaše, pozvánku nepřijímejte a požádejte o novou správce Rodokmenu (${m.inviterName}).`,
    ].join('\n\n');
  }
  return [
    `Hello, ${m.inviterName} invites you to Rodokmen, our family's shared family tree, with a map of the places our ancestors came from.`,
    `Accept the invitation with this link. It is valid for ${m.days} days and works only once, so please do not forward it:\n${m.link}`,
    `The same invitation came by email to ${m.email}. Rodokmen will send sign-in links to that address. If it is not yours, do not accept: ask ${m.inviterName} for a new invitation.`,
  ].join('\n\n');
}

export interface InvitationAcceptedEmail {
  /** The Owner's address. */
  to: string;
  /** The Owner's language. */
  language: UiLanguage;
  /** The display name the relative chose: their own text, so it stays out of the subject. */
  memberName: string;
  /** The invited address, now the new Member's. */
  email: string;
  acceptedAt: Date;
  /** Settings, where the Owner can disable the new Member. */
  settingsLink: string;
}

const timeFormat = (language: UiLanguage, d: Date) =>
  new Intl.DateTimeFormat(language === 'cs' ? 'cs-CZ' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Prague',
  }).format(d);

/**
 * Tells the Owner that a relative accepted an invitation (member-accounts spec, "The Owner is
 * told when an invitation is accepted"), so that a wrong person can be disabled at once.
 */
export function invitationAcceptedEmail(e: InvitationAcceptedEmail): MailMessage {
  const when = timeFormat(e.language, e.acceptedAt);
  if (e.language === 'cs') {
    return render(e.to, {
      subject: 'Pozvánka do Rodokmenu byla přijata',
      intro: [
        'Dobrý den,',
        `pozvánku na adresu ${e.email} přijal ${when} nový člen pod jménem „${e.memberName}“. Je teď přispěvatelem a vidí celý rodokmen včetně žijících osob.`,
        'Pokud to není ten, koho jste zvali, zablokujte ho v Nastavení, v části Členové, tlačítkem Zablokovat. Tím skončí všechna jeho přihlášení. Potom pozvěte správnou adresu.',
      ],
      button: { label: 'Otevřít Nastavení', url: e.settingsLink },
      outro: ['Tento e-mail dostane správce Rodokmenu pokaždé, když někdo přijme pozvánku.'],
      signature: 'Rodokmen',
    });
  }
  return render(e.to, {
    subject: 'Your Rodokmen invitation was accepted',
    intro: [
      'Hello,',
      `The invitation sent to ${e.email} was accepted on ${when} by someone who chose the name “${e.memberName}”. They are now a Contributor and see the whole Tree, Living people included.`,
      'If this is not the person you invited, click Disable next to them in Settings, under Members. That ends all their sessions at once. Then invite the right address.',
    ],
    button: { label: 'Open Settings', url: e.settingsLink },
    outro: ['The Owner of Rodokmen gets this email whenever someone accepts an invitation.'],
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
    intro: [
      `Hello ${e.displayName},`,
      `Someone (most likely you) asked to sign in to Rodokmen. Sign in with this link. It is valid for ${e.minutes} minutes and works only once.`,
    ],
    button: { label: 'Sign in', url: e.link },
    outro: [
      'Once you are signed in, you can save a passkey on this device, so next time you sign in without email.',
      'If you did not ask to sign in, ignore this email. Nobody can sign in without this link.',
    ],
    signature: 'Rodokmen',
  });
}

export interface AddressConfirmEmail {
  /** The new address, which the link proves. */
  to: string;
  /** The Member's language. */
  language: UiLanguage;
  displayName: string;
  /** The Owner who asked for the change. */
  ownerName: string;
  link: string;
  days: number;
}

/**
 * The link that confirms a Member's new address (member-accounts spec, "The Owner corrects a
 * Member's address"). It names the Member, so that anyone else whose address was typed by
 * mistake can see it is not for them.
 */
export function addressConfirmEmail(e: AddressConfirmEmail): MailMessage {
  if (e.language === 'cs') {
    return render(e.to, {
      subject: 'Potvrďte svou novou adresu v Rodokmenu',
      intro: [
        `Dobrý den, ${e.displayName},`,
        `${e.ownerName}, správce Rodokmenu, nastavil(a) tuto adresu jako vaši novou adresu v Rodokmenu. Sem vám Rodokmen bude posílat odkazy k přihlášení. Změna platí, až ji potvrdíte tímto odkazem. Odkaz platí ${e.days} dní a dá se použít jen jednou.`,
      ],
      button: { label: 'Potvrdit adresu', url: e.link },
      outro: [
        'Dokud adresu nepotvrdíte, chodí odkazy k přihlášení na vaši dosavadní adresu. Přístupové klíče (passkeys) fungují dál.',
        `Pokud nejste ${e.displayName} nebo jste tuto změnu nečekali, odkaz neotvírejte a e-mail ignorujte. Bez potvrzení se nic nezmění.`,
      ],
      signature: 'Rodokmen',
    });
  }
  return render(e.to, {
    subject: 'Confirm your new address for Rodokmen',
    intro: [
      `Hello ${e.displayName},`,
      `${e.ownerName}, the Owner of Rodokmen, set this as your new address in Rodokmen, where it will send your sign-in links. The change takes effect once you confirm it with this link. The link is valid for ${e.days} days and works only once.`,
    ],
    button: { label: 'Confirm the address', url: e.link },
    outro: [
      'Until you confirm it, sign-in links still go to your old address. Your passkeys keep working.',
      `If you are not ${e.displayName}, or did not expect this change, do not open the link and ignore this email. Nothing changes without the confirmation.`,
    ],
    signature: 'Rodokmen',
  });
}

export interface AddressChangedEmail {
  /** The old address. */
  to: string;
  /** The Member's language. */
  language: UiLanguage;
  /** The Owner who asked for the change. */
  ownerName: string;
}

/**
 * Tells the old address that Rodokmen no longer uses it (member-accounts spec, "After an address
 * is corrected"). The old address may be a stranger's mailbox, typed by mistake, so the notice
 * names neither the Member nor the new address.
 */
export function addressChangedEmail(e: AddressChangedEmail): MailMessage {
  if (e.language === 'cs') {
    return render(e.to, {
      subject: 'Rodokmen už tuto adresu nepoužívá',
      intro: [
        'Dobrý den,',
        `${e.ownerName}, správce Rodokmenu, společného rodokmenu jedné rodiny, změnil(a) adresu člena, který dosud používal tuto, a nová adresa byla potvrzena. Rodokmen sem už nic posílat nebude a odkazy k přihlášení, které sem přišly dřív, už nefungují.`,
      ],
      button: null,
      outro: [
        `Pokud to byla vaše adresa a změnu jste nečekali, obraťte se na správce Rodokmenu (${e.ownerName}). Pokud Rodokmen neznáte, někdo vaši adresu kdysi omylem zadal. E-mail můžete ignorovat.`,
      ],
      signature: 'Rodokmen',
    });
  }
  return render(e.to, {
    subject: 'Rodokmen no longer uses this address',
    intro: [
      'Hello,',
      `${e.ownerName}, the Owner of Rodokmen, one family's shared family tree, changed the address of the Member who used this one, and the new address was confirmed. Rodokmen will send nothing more here, and sign-in links sent here before no longer work.`,
    ],
    button: null,
    outro: [
      `If this was your address and you did not expect the change, contact ${e.ownerName}. If you do not know Rodokmen, someone once typed your address by mistake, and you can ignore this email.`,
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

export interface OutcomeEmail {
  to: string;
  language: UiLanguage;
  displayName: string;
  accepted: boolean;
  editorName: string;
  note: string | null;
  /** The Proposal's changes, one readable sentence each. */
  changes: string[];
  link: string;
}

const MAX_LISTED_CHANGES = 8;

function listed(changes: string[], more: (n: number) => string): string[] {
  const shown = changes.slice(0, MAX_LISTED_CHANGES).map((c) => `• ${c}`);
  if (changes.length > MAX_LISTED_CHANGES) shown.push(more(changes.length - MAX_LISTED_CHANGES));
  return [shown.join('\n')];
}

/** The outcome of a Proposal for its author, in the author's language (notifications spec). */
export function outcomeEmail(e: OutcomeEmail): MailMessage {
  if (e.language === 'cs') {
    return render(e.to, {
      subject: e.accepted ? 'Váš návrh byl přijat' : 'Váš návrh nebyl přijat',
      intro: [
        `Dobrý den, ${e.displayName},`,
        e.accepted
          ? `${e.editorName} přijal(a) váš návrh do Rodokmenu. Změny teď vidí všichni členové.`
          : `${e.editorName} váš návrh do Rodokmenu nepřijal(a). Ve stromu se nic nezměnilo.`,
        ...(e.note ? [`Poznámka: ${e.note}`] : []),
        ...listed(e.changes, (n) => `… a ${n} dalších změn`),
      ],
      button: { label: 'Otevřít návrh', url: e.link },
      outro: ['Tyto e-maily můžete vypnout v Rodokmenu v Nastavení.'],
      signature: 'Rodokmen',
    });
  }
  return render(e.to, {
    subject: e.accepted ? 'Your Proposal was accepted' : 'Your Proposal was not accepted',
    intro: [
      `Hello ${e.displayName},`,
      e.accepted
        ? `${e.editorName} accepted your Proposal to Rodokmen. Every Member now sees the changes.`
        : `${e.editorName} did not accept your Proposal to Rodokmen. Nothing in the Tree changed.`,
      ...(e.note ? [`Note: ${e.note}`] : []),
      ...listed(e.changes, (n) => `… and ${n} more changes`),
    ],
    button: { label: 'Open the Proposal', url: e.link },
    outro: ['You can turn these emails off in Rodokmen, under Settings.'],
    signature: 'Rodokmen',
  });
}

export interface DigestEmail {
  to: string;
  language: UiLanguage;
  displayName: string;
  /** Pending Proposals grouped by author, oldest first. */
  groups: Array<{ author: string; isAgent: boolean; items: Array<{ submittedAt: Date; summary: string; changes: number; link: string }> }>;
  queueLink: string;
}

const dayFormat = (language: UiLanguage, d: Date) =>
  new Intl.DateTimeFormat(language === 'cs' ? 'cs-CZ' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Prague' }).format(d);

/** The daily list of Proposals waiting for review, for one Editor. */
export function digestEmail(e: DigestEmail): MailMessage {
  const total = e.groups.reduce((n, g) => n + g.items.length, 0);
  const cs = e.language === 'cs';
  const groups = e.groups.map((g) => {
    const who = g.isAgent ? `${g.author} (${cs ? 'agent' : 'Agent'})` : g.author;
    const lines = g.items.map(
      (i) =>
        `• ${dayFormat(e.language, i.submittedAt)}: ${i.summary}${i.changes > 1 ? (cs ? ` (změn: ${i.changes})` : ` (${i.changes} changes)`) : ''}\n  ${i.link}`,
    );
    return `${who}\n${lines.join('\n')}`;
  });
  if (cs) {
    return render(e.to, {
      subject: `Rodokmen: návrhy ke kontrole (${total})`,
      intro: [`Dobrý den, ${e.displayName},`, `ke kontrole čeká návrhů: ${total}.`, ...groups],
      button: { label: 'Otevřít frontu ke kontrole', url: e.queueLink },
      outro: ['Tento přehled chodí editorům jednou denně v 18:00, jen když něco čeká.'],
      signature: 'Rodokmen',
    });
  }
  return render(e.to, {
    subject: `Rodokmen: ${total} Proposal${total === 1 ? '' : 's'} to review`,
    intro: [`Hello ${e.displayName},`, `${total} Proposal${total === 1 ? ' is' : 's are'} waiting for review.`, ...groups],
    button: { label: 'Open the review queue', url: e.queueLink },
    outro: ['Editors get this summary once a day at 18:00, only when something is waiting.'],
    signature: 'Rodokmen',
  });
}
