# Design

## Context

How accepting works today (`add-tree-backend`, `add-whatsapp-invitations`):

- `acceptInvitation` in `server/src/auth/accounts.ts` locks the invitation, checks that it is pending and that its address is no Member's yet, creates the Contributor and marks the invitation accepted, all in one transaction. Then it creates the session. `POST /api/auth/invitation/accept` answers 201 and sets the cookie.
- An invitation has one token and one link, whether it went by email, through WhatsApp or both. It works once. Inviting an address that has a pending invitation is allowed, and accepting one makes the others fail with 409 `already_member`.
- The Owner is the one account with `role = 'owner'`. `changeRole` can hand ownership to another Member; the invitation keeps `invited_by`, the Member who sent it.
- The outcome emails of Proposals (`sendOutcome` in `server/src/proposals/service.ts`) are sent after the decision is committed, and a failure is logged, never returned to the Editor. `AccountDeps` has no logger yet.
- The emails are in `server/src/mail/templates.ts`, in Czech and English, the interface languages on main; golden files in `server/test/__snapshots__/emails/` pin each.

## Goals / Non-Goals

**Goals:**

- The Owner learns of every new Member within minutes, by email, without opening the app.
- A failure to send that email never costs a relative their acceptance.

**Non-Goals:**

- No new storage, no migration, no setting and no app change.
- No retry of a failed email. The Owner still sees the new Member in Settings.

## Decisions

### How the Owner learns of it: an email, nothing else

The email is the point of #151: the Owner should not have to open Settings to notice. Settings already shows the invitation as accepted and the new Member under **Members**, so it needs no change to show what happened.

Rejected for now, and put to the Owner as questions:

- **A mark in Settings** for Members who joined since the Owner last looked. It needs a "last looked" time per Owner, so new state, and it tells the Owner nothing they do not see in the list already. The email is what arrives without opening the app.
- **A switch to turn the email off**, like the outcome emails' (`PUT /api/me/notifications`). It needs a new column and a control in Settings. The email is a safety notice, rare by nature (one per new Member, and the family invites a handful of people a year), and turning it off would bring back exactly the risk #151 exists to shorten. If the Owner wants it anyway, it is a small follow-up: a column `account.acceptance_emails`, one more field in `NotificationSettings`, and a switch in Settings.

### One email per acceptance

The email is sent on the one path where an acceptance succeeds, after the transaction that creates the Member. Nothing else sends it. So:

- **Email and WhatsApp.** Both carry the same link to the same invitation. It is accepted once; the second try answers 410 `invitation_accepted` and sends nothing.
- **Two invitations to one address** (the Owner invited again without withdrawing). The first accepted creates the Member; the other answers 409 `already_member` and sends nothing.
- **Two accepts at the same moment.** The invitation row is locked `for update`, and the address is unique among accounts, so only one transaction commits.

No record of "already told" is needed, since nothing can send it twice.

### Who gets it: the Owner at the time of acceptance

The email goes to the account with `role = 'owner'` when the invitation is accepted, read after the transaction. Its purpose is that someone can disable a wrong Member, and only the Owner can. If ownership was handed over after the invitation went out, the Member who sent it is now an Editor and could do nothing about it. The Owner's account is always enabled (a check constraint), and a Member always has an address, so there is always someone to tell.

The email is in the Owner's language, read from their account, as every email follows its recipient's language.

### After the commit, failures logged

The invitation email is sent inside its transaction, so that if it fails, no invitation is left whose link nobody has. Here the opposite holds: the acceptance is what matters, and the email is a notice about it. So it is sent after the transaction commits and before the answer, inside a `try`/`catch`. A failure is logged through a new optional `log` in `AccountDeps`, wired in `server/src/app.ts` to the server log as the outcome emails are, and the relative gets their 201 and session as if nothing happened.

The relative's answer waits for the SMTP server to take the email, as the outcome emails make the Editor wait. The mailer's timeouts bound that wait. Sending it in the background instead would save the relative at most a few seconds once, at the cost of an email that may still be in flight when the server shuts down, and of tests that must wait for it.

### What the email says

Built by `invitationAcceptedEmail` in `server/src/mail/templates.ts`, with the shared `render`:

- **Subject:** fixed text ("Invitation accepted" in English). The display name is the new Member's own text, up to 100 characters, so it stays out of the subject and appears only in the body, where the HTML version escapes it.
- **Body:** the display name the relative chose, the invited address, the date and time of the acceptance in Prague time, and that the new Member is a Contributor who sees the whole Tree, Living people included.
- **What to do:** if this is not the person the Owner invited, disable them in Settings, under **Members**, which ends their sessions at once. Then invite the right address.
- **Button:** "Open Settings", to `<PUBLIC_ORIGIN>/#settings`. It holds no token: Settings asks the Owner to sign in when needed.

### Rules proved with LemmaScript

None qualifies (ADR 0009). Who gets the email is a database read (the account with the Owner role), and when it is sent is the order of I/O around a transaction. Neither is a pure rule. The tests in `server/test/invitations.test.ts` cover both, and the golden files cover the text.

## Risks / Trade-offs

- [The SMTP server is slow or down when a relative accepts] → The relative waits at most the mailer's timeouts and is then signed in as usual; the failure is logged, and the Owner sees the new Member in Settings.
- [The Owner gets the email but does not read it in time] → It shortens the time a wrong acceptance goes unnoticed; it cannot close it. The link still works once and for 7 days, and the page shows the invited address.
- [A display name crafted to mislead, such as a name that looks like a warning] → It appears only in the body, escaped in HTML, next to the invited address, which the relative cannot choose.
- [An Owner who would rather not get these emails] → No switch now (see above); asked as a question in the PR and on #151.

## Migration Plan

No migration and no setting. Deploy as usual. A rollback reverts the code; nothing new is stored.
