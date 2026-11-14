import { describe, expect, it } from 'vitest';
import {
  addressChangedEmail,
  addressConfirmEmail,
  alertEmail,
  digestEmail,
  invitationAcceptedEmail,
  invitationEmail,
  invitationShareText,
  outcomeEmail,
  signInLinkEmail,
} from '../src/mail/templates.js';

const link = 'https://rodokmen.example/#invite/EXAMPLE_TOKEN_0123456789abcdefghijklmnopq';

/** The Owner's email about an accepted invitation, accepted at 11:05 Prague time. */
const invitationAccepted = (language: 'cs' | 'en', memberName: string) =>
  invitationAcceptedEmail({
    to: 'owner@example.test',
    language,
    memberName,
    email: 'cousin.marta@example.test',
    acceptedAt: new Date('2026-11-14T10:05:00Z'),
    settingsLink: 'https://rodokmen.example/#settings',
  });

/** Snapshot of every email in each language; review the files in test/__snapshots__/emails/ when wording changes. */
describe('invitation and sign-in emails in Czech and English', () => {
  for (const language of ['cs', 'en'] as const) {
    it(`renders the invitation in ${language}`, async () => {
      const email = invitationEmail({ to: 'relative@example.test', language, inviterName: 'Petr Dvořák', link, days: 7 });
      await expect(`Subject: ${email.subject}\n\n${email.text}`).toMatchFileSnapshot(`__snapshots__/emails/invitation.${language}.txt`);
      await expect(email.html).toMatchFileSnapshot(`__snapshots__/emails/invitation.${language}.html`);
    });

    it(`renders the WhatsApp message of an invitation in ${language}`, async () => {
      const text = invitationShareText({ email: 'relative@example.test', language, inviterName: 'Petr Dvořák', link, days: 7 });
      await expect(text).toMatchFileSnapshot(`__snapshots__/emails/invitation-share.${language}.txt`);
    });

    it(`renders the Owner's email about an accepted invitation in ${language}`, async () => {
      const email = invitationAccepted(language, 'Marta Invented');
      await expect(`Subject: ${email.subject}\n\n${email.text}`).toMatchFileSnapshot(`__snapshots__/emails/invitation-accepted.${language}.txt`);
      await expect(email.html).toMatchFileSnapshot(`__snapshots__/emails/invitation-accepted.${language}.html`);
    });

    it(`renders the sign-in link in ${language}`, async () => {
      const email = signInLinkEmail({ to: 'relative@example.test', language, displayName: 'Jana', link: link.replace('/invite', '/link'), minutes: 15 });
      await expect(`Subject: ${email.subject}\n\n${email.text}`).toMatchFileSnapshot(`__snapshots__/emails/sign-in-link.${language}.txt`);
      await expect(email.html).toMatchFileSnapshot(`__snapshots__/emails/sign-in-link.${language}.html`);
    });
  }

  it('Czech and English differ, and both carry the link and its limits', () => {
    const cs = invitationEmail({ to: 'x@example.test', language: 'cs', inviterName: 'Petr', link, days: 7 });
    const en = invitationEmail({ to: 'x@example.test', language: 'en', inviterName: 'Petr', link, days: 7 });
    expect(cs.subject).not.toBe(en.subject);
    for (const e of [cs, en]) {
      expect(e.text).toContain(link);
      expect(e.html).toContain(link);
      expect(e.text).toMatch(/7 (dní|days)/);
    }
    // The WhatsApp message (member-accounts spec, "The WhatsApp message in the invitation's language").
    const shareCs = invitationShareText({ email: 'x@example.test', language: 'cs', inviterName: 'Petr', link, days: 7 });
    const shareEn = invitationShareText({ email: 'x@example.test', language: 'en', inviterName: 'Petr', link, days: 7 });
    expect(shareCs).not.toBe(shareEn);
    expect(shareCs).toContain('Platí 7 dní a dá se použít jen jednou');
    for (const text of [shareCs, shareEn]) {
      expect(text).toContain('Petr');
      expect(text).toContain(`\n${link}\n`);
      expect(text).toContain('x@example.test');
      expect(text).toMatch(/7 (dní|days)/);
    }
    const signIn = signInLinkEmail({ to: 'x@example.test', language: 'cs', displayName: 'Jana', link, minutes: 15 });
    expect(signIn.text).toContain('15 minut');
  });

  it('escapes names in the HTML version', () => {
    const e = invitationEmail({ to: 'x@example.test', language: 'en', inviterName: '<script>alert(1)</script>', link, days: 7 });
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('&lt;script&gt;');
    // The name a relative chose is their own text: escaped, and never in the subject.
    for (const language of ['cs', 'en'] as const) {
      const accepted = invitationAccepted(language, '<img src=x onerror=alert(1)>');
      expect(accepted.html).not.toContain('<img');
      expect(accepted.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(accepted.subject).not.toContain('img');
    }
  });

  it("the Owner's email names the address, the time in Prague and the way to Settings", () => {
    const cs = invitationAccepted('cs', 'Marta');
    const en = invitationAccepted('en', 'Marta');
    expect(cs.subject).not.toBe(en.subject);
    expect(cs.text).toContain('14. listopadu 2026 v 11:05');
    expect(en.text).toContain('14 November 2026 at 11:05');
    for (const e of [cs, en]) {
      expect(e.to).toBe('owner@example.test');
      expect(e.text).toContain('cousin.marta@example.test');
      expect(e.text).toContain('https://rodokmen.example/#settings');
    }
  });

  it('formats alerts for the Owner', () => {
    const e = alertEmail({
      to: 'owner@example.test',
      subject: 'Nightly Backup failed',
      details: 'restic: repository not found',
      origin: 'https://rodokmen.example',
    });
    expect(e.subject).toBe('[Rodokmen alert] Nightly Backup failed');
    expect(e.text).toContain('restic: repository not found');
  });
});

describe('Proposal emails in Czech and English', () => {
  for (const language of ['cs', 'en'] as const) {
    it(`renders the rejected outcome in ${language}`, async () => {
      const email = outcomeEmail({
        to: 'karel@example.test',
        language,
        displayName: 'Karel',
        accepted: false,
        editorName: 'Eva Editor',
        note: 'wrong parish, see 1820 register',
        changes: ['adds the Person Barbora Invented', 'adds the baptism on 1813-04-02 at Kamenná Lhota'],
        link: 'https://rodokmen.example/#work/mine/0192f0c4-7a1e-7c3b-9d2a-000000000001',
      });
      await expect(`Subject: ${email.subject}\n\n${email.text}`).toMatchFileSnapshot(`__snapshots__/emails/outcome-rejected.${language}.txt`);
      await expect(email.html).toMatchFileSnapshot(`__snapshots__/emails/outcome-rejected.${language}.html`);
    });

    it(`renders the Editor digest in ${language}`, async () => {
      const email = digestEmail({
        to: 'eva@example.test',
        language,
        displayName: 'Eva',
        queueLink: 'https://rodokmen.example/#work/review',
        groups: [
          {
            author: 'Karel',
            isAgent: false,
            items: [
              {
                submittedAt: new Date('2026-10-28T09:00:00Z'),
                summary: 'Baptism of Václav, 1803',
                changes: 9,
                link: 'https://rodokmen.example/#work/review/0192f0c4-7a1e-7c3b-9d2a-000000000002',
              },
            ],
          },
          {
            author: 'Research assistant',
            isAgent: true,
            items: [
              {
                submittedAt: new Date('2026-10-29T11:30:00Z'),
                summary: 'adds the Person Anna Králová',
                changes: 1,
                link: 'https://rodokmen.example/#work/review/0192f0c4-7a1e-7c3b-9d2a-000000000003',
              },
            ],
          },
        ],
      });
      await expect(`Subject: ${email.subject}\n\n${email.text}`).toMatchFileSnapshot(`__snapshots__/emails/digest.${language}.txt`);
      await expect(email.html).toMatchFileSnapshot(`__snapshots__/emails/digest.${language}.html`);
    });
  }

  it('says when the Proposal was accepted, without a note', () => {
    const e = outcomeEmail({
      to: 'x@example.test',
      language: 'en',
      displayName: 'Jana',
      accepted: true,
      editorName: 'Eva',
      note: null,
      changes: [],
      link: 'https://rodokmen.example/',
    });
    expect(e.subject).toBe('Your Proposal was accepted');
    expect(e.text).not.toContain('Note:');
  });
});

// member-accounts spec, "The Owner corrects a Member's address" and "After an address is corrected".
describe("emails about a Member's new address in Czech and English", () => {
  const confirmLink = 'https://rodokmen.example/#address/EXAMPLE_TOKEN_0123456789abcdefghijklmnopq';
  const confirm = (language: 'cs' | 'en', displayName = 'Marta Invented') =>
    addressConfirmEmail({ to: 'marta.new@example.test', language, displayName, ownerName: 'Petr Dvořák', link: confirmLink, days: 7 });

  for (const language of ['cs', 'en'] as const) {
    it(`renders the confirmation of a new address in ${language}`, async () => {
      const email = confirm(language);
      await expect(`Subject: ${email.subject}\n\n${email.text}`).toMatchFileSnapshot(`__snapshots__/emails/address-confirm.${language}.txt`);
      await expect(email.html).toMatchFileSnapshot(`__snapshots__/emails/address-confirm.${language}.html`);
    });

    it(`renders the notice to the old address in ${language}`, async () => {
      const email = addressChangedEmail({ to: 'marta.old@example.test', language, ownerName: 'Petr Dvořák' });
      await expect(`Subject: ${email.subject}\n\n${email.text}`).toMatchFileSnapshot(`__snapshots__/emails/address-changed.${language}.txt`);
      await expect(email.html).toMatchFileSnapshot(`__snapshots__/emails/address-changed.${language}.html`);
    });
  }

  it('the confirmation names the Member, the Owner, the link and its limits, and escapes names in HTML', () => {
    for (const language of ['cs', 'en'] as const) {
      const email = confirm(language);
      expect(email.to).toBe('marta.new@example.test');
      for (const part of ['Marta Invented', 'Petr Dvořák', confirmLink]) expect(email.text).toContain(part);
      expect(email.text).toMatch(/7 (dní|days)/);
      const hostile = confirm(language, '<b>x</b>');
      expect(hostile.html).not.toContain('<b>x</b>');
      expect(hostile.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    }
  });

  it('the notice to the old address names neither the Member nor a new address, and has no link', () => {
    for (const language of ['cs', 'en'] as const) {
      const email = addressChangedEmail({ to: 'marta.old@example.test', language, ownerName: 'Petr Dvořák' });
      expect(email.to).toBe('marta.old@example.test');
      expect(email.text).toContain('Petr Dvořák');
      expect(email.text).not.toMatch(/@|https?:/);
      expect(email.html).not.toContain('<a ');
    }
  });
});
