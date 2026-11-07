# Tasks

No rule of this change qualifies for a LemmaScript proof (design.md, "Rules proved with LemmaScript"), so there is no proof task.

## 1. The link and the message (shared, server)

- [x] 1.1 Add `CreatedInvitation` (an `InvitationView` with `link` and `shareText`, each described as shown only in this answer) and `email` (nullable, only while pending) in `InvitationCheck` to `shared/src/schemas/accounts.ts`; verify with `pnpm typecheck`
  - Note: `CreatedInvitation` follows `IssuedAgentToken`. The types `CreatedInvitation` and `InvitationCheck` are exported for the app's JSDoc (`app/src/types.js`).
- [x] 1.2 Write `invitationShareText` in `server/src/mail/templates.ts` in Czech and English (the inviter, the link, 7 days, works once, do not forward, the invited address); verify the Czech-message scenario with golden files in `server/test/emails.test.ts`, one per language
  - Note: golden files `server/test/__snapshots__/emails/invitation-share.cs.txt` and `.en.txt`. The link stands on a line of its own, so that the chat app makes it a link.
- [x] 1.3 Make `createInvitation` return the link and the message, the 201 answer of `POST /api/invitations` a `CreatedInvitation`, and `checkInvitation` name the address of a pending invitation only; verify in `server/test/invitations.test.ts`: the link comes back once and equals the emailed one, the list never holds it (nor the token), the emailed link is refused once the WhatsApp link was accepted, withdrawing and expiry refuse it, and the check names the address only while pending
  - Note: the email still goes out inside the transaction, unchanged. The new `describe` in `invitations.test.ts` also covers the lost link (withdraw, invite again, only the new link works).
- [x] 1.4 Prove that opening an invitation link uses nothing up: fetch the link over real HTTP with a WhatsApp-like user agent from a server that serves the app, record the request targets the server received, try the token in a path and a query too, check twice, then accept; verify with a new `server/test/invitation-preview.test.ts`
  - Note: the server listens on a random port and serves `app/`. The targets it received for a `HEAD` and a `GET` of the link are exactly `/` and `/`, the page is the app shell without the token or the address, and the invitation stays pending until accepted.
- [x] 1.5 Regenerate `server/openapi.json` with `pnpm --filter @rodokmen/server openapi`; verify with `pnpm --filter @rodokmen/server openapi:check`

## 2. The app

- [x] 2.1 Build the block shown once after sending an invitation (`app/src/settings-invitation.js`): the message read-only, Send through WhatsApp only where `navigator.share` can share the text, Copy the message everywhere with selection as the fallback, the shown-only-now note, and Done; the link lives in the component's state only. Wire it into `FamilySection` in `app/src/settings-screen.js` and add the texts to `app/i18n/cs.json` and `en.json`; verify the phone-with-a-share-sheet, computer-without-a-share-sheet and leaving-the-message scenarios in `app/tests/e2e/family-settings.spec.js` at phone and desktop sizes, with nothing wider than the screen
  - Note: each test runs in both Playwright projects (390 px phone, 1280 px desktop). The share sheet and the clipboard are stubbed, so that each case is the same in every browser: with a share sheet (closing it is no failure, and only `text` is shared), without one (no share button; copying), copying refused (the message is selected), and Done (the token is in no storage or IndexedDB store on the device, before or after). No request went to WhatsApp or held the token. The module is in the precache list (`app/src/precache.js`). The status line now says the invitation went by email.
- [x] 2.2 Show the invited address on the invitation page (`app/src/sign-in-screen.js`), with the texts in both languages; verify the mistyped-address scenario, and that opening the page calls only `check` and never `accept` until the form is sent, in `app/tests/e2e/family-sign-in.spec.js`
  - Note: the first-visit test opens the link twice and sees two checks and no accept before the form is sent. The used-invitation test sees no address.
- [x] 2.3 Update the JSDoc types (`app/src/types.js`, `app/src/api.js`); verify with `pnpm typecheck` and `pnpm lint:js`

## 3. Docs

- [x] 3.1 How-to: add `docs/how-to/invite-a-member.md` (invite by email, also send through WhatsApp on a phone and on a computer, lost the link, a wrong address, withdraw) with its line in the `docs/README.md` index. Reference: the invitation answers in `docs/reference/api.md`. Explanation: who sees the token, the address and forwarding in `docs/explanation/privacy.md`. Update `README.md`, which says what works. Verify with `pnpm lint:docs`
  - Note: `docs/reference/api.md` gains a section "Invitations", and `docs/explanation/privacy.md` a section "Invitation links in chats".

## 4. Everything together

- [x] 4.1 Run `pnpm check`, the server tests touched (`invitations`, `invitation-preview`, `emails`, `passkeys.e2e`, `family-view.e2e`) and the Playwright files touched with at most 2 workers; verify they pass and CI is green on the PR
  - Note: the result of each run is in the PR description.

## Workflow follow-up

- When archiving, the requirements here add to `member-accounts` (`add-tree-backend`) and `family-view` (`add-family-view`). If `add-interface-languages` is archived first, the WhatsApp message needs Slovak and German as well, like the invitation email.
