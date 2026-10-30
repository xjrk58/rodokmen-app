import { describe, expect, it } from 'vitest';
import { alertEmail, digestEmail, invitationEmail, outcomeEmail, signInLinkEmail } from '../src/mail/templates.js';

const link = 'https://rodokmen.example/auth/invite#token=EXAMPLE_TOKEN_0123456789abcdefghijklmnopq';

/** Snapshot of every email in each language; review the files in test/__snapshots__/emails/ when wording changes. */
describe('invitation and sign-in emails in Czech and English', () => {
  for (const language of ['cs', 'en'] as const) {
    it(`renders the invitation in ${language}`, async () => {
      const email = invitationEmail({ to: 'relative@example.test', language, inviterName: 'Petr Dvořák', link, days: 7 });
      await expect(`Subject: ${email.subject}\n\n${email.text}`).toMatchFileSnapshot(`__snapshots__/emails/invitation.${language}.txt`);
      await expect(email.html).toMatchFileSnapshot(`__snapshots__/emails/invitation.${language}.html`);
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
    const signIn = signInLinkEmail({ to: 'x@example.test', language: 'cs', displayName: 'Jana', link, minutes: 15 });
    expect(signIn.text).toContain('15 minut');
  });

  it('escapes names in the HTML version', () => {
    const e = invitationEmail({ to: 'x@example.test', language: 'en', inviterName: '<script>alert(1)</script>', link, days: 7 });
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('&lt;script&gt;');
  });

  it('formats alerts for the Owner', () => {
    const e = alertEmail({ to: 'owner@example.test', subject: 'Nightly Backup failed', details: 'restic: repository not found', origin: 'https://rodokmen.example' });
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
          { author: 'Karel', isAgent: false, items: [{ submittedAt: new Date('2026-10-28T09:00:00Z'), summary: 'Baptism of Václav, 1803', changes: 9, link: 'https://rodokmen.example/#work/review/0192f0c4-7a1e-7c3b-9d2a-000000000002' }] },
          { author: 'Research assistant', isAgent: true, items: [{ submittedAt: new Date('2026-10-29T11:30:00Z'), summary: 'adds the Person Anna Králová', changes: 1, link: 'https://rodokmen.example/#work/review/0192f0c4-7a1e-7c3b-9d2a-000000000003' }] },
        ],
      });
      await expect(`Subject: ${email.subject}\n\n${email.text}`).toMatchFileSnapshot(`__snapshots__/emails/digest.${language}.txt`);
      await expect(email.html).toMatchFileSnapshot(`__snapshots__/emails/digest.${language}.html`);
    });
  }

  it('says when the Proposal was accepted, without a note', () => {
    const e = outcomeEmail({ to: 'x@example.test', language: 'en', displayName: 'Jana', accepted: true, editorName: 'Eva', note: null, changes: [], link: 'https://rodokmen.example/' });
    expect(e.subject).toBe('Your Proposal was accepted');
    expect(e.text).not.toContain('Note:');
  });
});
