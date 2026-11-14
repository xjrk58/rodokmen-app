# Proposal

## Why

A Member's email address is fixed today: it is the address the invitation went to, and no route changes it. Emailed sign-in links, the fallback when a passkey is missing, go there. Since `add-whatsapp-invitations` (#141) an invitation can reach a relative through WhatsApp, which does not prove that they read the invited mailbox. A mistyped address that got past the invitation page, or an address a relative stops using, leaves them without the fallback. The only remedy now is to disable the Member and invite the right address. That makes a new account, and the Member's Proposals, passkeys and link to their Person stay with the disabled one. The Owner should be able to correct the address instead (issue #152). The Owner gave the go-ahead on 2026-11-14.

## What Changes

- In Settings, under **Members**, the Owner can correct any Member's address, their own included (`POST /api/members/{id}/email-change`).
- The new address takes effect only when it is confirmed. Rodokmen emails a confirmation link to it, in the Member's language. The link is valid for 7 days and works once.
- Until the new address is confirmed, the old one stays: sign-in links still go there. Settings shows the address that is waiting for confirmation, with **Withdraw**. Asking again replaces the waiting change, and its link stops working.
- The link opens a page in the app (`#address/<token>`). Opening it changes nothing. Only the button **Confirm the address** makes the change (`POST /api/auth/email-change/confirm`). Confirming does not sign anyone in.
- When the change takes effect:
  - the Member's unused sign-in links stop working, since they went to the old address;
  - the Member's sessions and passkeys stay;
  - the old address is told, in the Member's language and without the new address, that Rodokmen no longer uses it.
- An address cannot belong to two Members. A new address is refused (409) when it is:
  - another Member's;
  - the address of a pending invitation;
  - the Member's current address.

  At confirmation, an address that has become another Member's in the meantime is refused, and nothing changes.
- Only the Owner may ask for a change. The proved role-and-action rule `mayDo` is traced to the new requirement.

Out of scope:

- A Member changing their own address. The design explains why, and the PR asks the Owner.
- Changing an Agent's details: an Agent has no address.
- Ending sessions or removing passkeys when an address changes. If a wrong person may have signed in, the remedy stays: disable the Member and invite again.
- Slovak and German texts, which come with `add-interface-languages` (#113). The emails and the new interface texts exist in Czech and English, the interface languages on main.

## Capabilities

### New Capabilities

### Modified Capabilities
- `member-accounts`: the Owner corrects a Member's address, which takes effect once a link sent to the new address is confirmed. Also what is refused, and what happens to sign-in links, sessions, passkeys and the old address.
- `family-view`: Settings offers to correct a Member's address and shows one waiting for confirmation, and the app has a page that confirms a new address.

Main specs are empty because no change is archived yet, so these deltas add requirements, as `add-whatsapp-invitations` did. They add to `member-accounts` "Invitation only" and "Sign-in without a password" (`add-tree-backend`), and to `family-view` "Owner settings in the app" and "Sign-in in the app" (`add-family-view`). They replace nothing.

## Impact

- **Database**: a migration `0016_email_change` adds the table `email_change`, which holds one row per requested change, with only the token's hash. No existing table changes.
- **Shared**: `shared/src/schemas/accounts.ts` gains `EMAIL_CHANGE_DAYS`, `EmailChangeBody`, `EmailChangeConfirmed`, and `pendingEmail` in `MemberView`. In `shared/src/rules.ts`, `mayDo` gains a `//@ contract` line and an `ensures` for the new requirement. No new action: correcting an address is managing Members (`manageAccounts`).
- **Server**:
  - `server/src/auth/accounts.ts`: request, withdraw and confirm a change, and `pendingEmail`;
  - `server/src/routes/accounts.ts`: `POST` and `DELETE /api/members/{id}/email-change`;
  - `server/src/routes/auth.ts`: `POST /api/auth/email-change/confirm`;
  - two new emails in `server/src/mail/templates.ts`;
  - `server/openapi.json`.
- **App**:
  - `app/src/routes.js` and `app/src/shell.js`: the `#address/<token>` page;
  - `app/src/sign-in-screen.js`: the confirmation page;
  - a new `app/src/settings-email-change.js`, used by `MemberRow` in `app/src/settings-screen.js`;
  - `app/src/api.js`, `app/src/precache.js`, `app/styles.css` if needed, and new texts in `app/i18n/cs.json` and `en.json`.
- **Tests**:
  - `server/test/email-change.test.ts` (new);
  - golden files for both emails in `server/test/emails.test.ts`;
  - `server/test/migrations.test.ts` if it lists migrations;
  - `shared/test/rules.test.ts`;
  - Playwright in a new `app/tests/e2e/family-address.spec.js`, at phone and desktop sizes;
  - the routes unit test.
- **Docs**:
  - `docs/how-to/invite-a-member.md`;
  - `docs/reference/api.md` and `docs/reference/roles-and-actions.md`;
  - `docs/explanation/privacy.md`;
  - `docs/verification.md`, regenerated, with its texts in `scripts/verification-trace/texts.mjs`;
  - `README.md`.
- **Dependencies**: none new.
