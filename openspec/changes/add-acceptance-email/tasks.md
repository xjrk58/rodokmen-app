# Tasks

No rule of this change qualifies for a LemmaScript proof (design.md, "Rules proved with LemmaScript"), so there is no proof task.

## 1. The email (server)

- [ ] 1.1 Write `invitationAcceptedEmail` in `server/src/mail/templates.ts` in Czech and English (fixed subject; the display name, the invited address, the date and time in Prague, Contributor who sees the whole Tree, disable in Settings if it is the wrong person, a button to `#settings`); verify with golden files `invitation-accepted.cs` and `.en` (`.txt` and `.html`) in `server/test/emails.test.ts`, and that the HTML escapes the display name
- [ ] 1.2 Send it from `acceptInvitation` after its transaction commits, to the account with the Owner role, in that account's language, with failures caught and passed to a new optional `log` in `AccountDeps`, wired in `server/src/app.ts`; update the summary of `POST /api/auth/invitation/accept` and regenerate `server/openapi.json`. Verify in `server/test/invitations.test.ts`: one email to the Owner with the name, the address and the Settings link; accepting through the WhatsApp link and then the emailed one sends one; two invitations to one address send one; after ownership is handed over the new Owner gets it; a failing send still answers 201 with a session and the Member stored, and logs the failure; and with `pnpm --filter @rodokmen/server openapi:check`
- [ ] 1.3 Check the other suites that accept invitations and count emails (`email-links`, `passkeys.e2e`, `family-view.e2e`, `invitation-preview`) still pass; verify by running them

## 2. Docs

- [ ] 2.1 How-to: in `docs/how-to/invite-a-member.md`, say what the Owner gets when a relative accepts and what to do if it was the wrong person. Reference: the accept route in `docs/reference/api.md` ("Invitations"). Explanation: the forwarding paragraph of `docs/explanation/privacy.md` ("Invitation links in chats"). `README.md`, which says what works. Verify with `pnpm lint:docs`

## 3. Everything together

- [ ] 3.1 Run `pnpm check` and `pnpm verify`, and the server tests touched; verify they pass and CI is green on the PR
