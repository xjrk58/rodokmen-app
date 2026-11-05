# Tasks

No rule of this change qualifies for a LemmaScript proof (design.md, "Rules proved with LemmaScript"), so there is no proof task.

## 1. The link and the message (shared, server)

- [ ] 1.1 Add `CreatedInvitation` (an `InvitationView` with `link` and `shareText`, each described as shown only in this answer) and `email` (nullable, only while pending) in `InvitationCheck` to `shared/src/schemas/accounts.ts`; verify with `pnpm typecheck`
- [ ] 1.2 Write `invitationShareText` in `server/src/mail/templates.ts` in Czech and English (the inviter, the link, 7 days, works once, do not forward, the invited address); verify the Czech-message scenario with golden files in `server/test/emails.test.ts`, one per language
- [ ] 1.3 Make `createInvitation` return the link and the message, the 201 answer of `POST /api/invitations` a `CreatedInvitation`, and `checkInvitation` name the address of a pending invitation only; verify in `server/test/invitations.test.ts`: the link comes back once and equals the emailed one, the list never holds it (nor the token), the emailed link is refused once the WhatsApp link was accepted, withdrawing and expiry refuse it, and the check names the address only while pending
- [ ] 1.4 Prove that opening an invitation link uses nothing up: fetch the link over real HTTP with a WhatsApp-like user agent from a server that serves the app, record the request targets the server received, try the token in a path and a query too, check twice, then accept; verify with a new `server/test/invitation-preview.test.ts`
- [ ] 1.5 Regenerate `server/openapi.json` with `pnpm --filter @rodokmen/server openapi`; verify with `pnpm --filter @rodokmen/server openapi:check`

## 2. The app

- [ ] 2.1 Build the block shown once after sending an invitation (`app/src/settings-invitation.js`): the message read-only, Send through WhatsApp only where `navigator.share` can share the text, Copy the message everywhere with selection as the fallback, the shown-only-now note, and Done; the link lives in the component's state only. Wire it into `FamilySection` in `app/src/settings-screen.js` and add the texts to `app/i18n/cs.json` and `en.json`; verify the phone-with-a-share-sheet, computer-without-a-share-sheet and leaving-the-message scenarios in `app/tests/e2e/family-settings.spec.js` at phone and desktop sizes, with nothing wider than the screen
- [ ] 2.2 Show the invited address on the invitation page (`app/src/sign-in-screen.js`), with the texts in both languages; verify the mistyped-address scenario, and that opening the page calls only `check` and never `accept` until the form is sent, in `app/tests/e2e/family-sign-in.spec.js`
- [ ] 2.3 Update the JSDoc types (`app/src/types.js`, `app/src/api.js`); verify with `pnpm typecheck` and `pnpm lint:js`

## 3. Docs

- [ ] 3.1 How-to: add `docs/how-to/invite-a-member.md` (invite by email, also send through WhatsApp on a phone and on a computer, lost the link, a wrong address, withdraw) with its line in the `docs/README.md` index. Reference: the invitation answers in `docs/reference/api.md`. Explanation: who sees the token, the address and forwarding in `docs/explanation/privacy.md`. Update `README.md`, which says what works. Verify with `pnpm lint:docs`

## 4. Everything together

- [ ] 4.1 Run `pnpm check`, the server tests touched (`invitations`, `invitation-preview`, `emails`, `passkeys.e2e`, `family-view.e2e`) and the Playwright files touched with at most 2 workers; verify they pass and CI is green on the PR

## Workflow follow-up

- When archiving, the requirements here add to `member-accounts` (`add-tree-backend`) and `family-view` (`add-family-view`). If `add-interface-languages` is archived first, the WhatsApp message needs Slovak and German as well, like the invitation email.
