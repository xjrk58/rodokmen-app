# Tasks

## 1. Storage and shared schemas

- [x] 1.1 Add the migration `0016_email_change` (the table and its partial unique index on open changes) and `EmailChangeTable` (in a new `server/src/db/emailed-link-types.ts`, with `SignInLinkTable` moved there, so that `types.ts` stays within its line limit); verify with `server/test/migrations.test.ts` (up and down) and `pnpm typecheck`
- [x] 1.2 Add `EMAIL_CHANGE_DAYS`, `EmailChangeBody`, `EmailChangeConfirmed` and `pendingEmail` in `MemberView` to `shared/src/schemas/accounts.ts`; verify with `pnpm typecheck`

## 2. The proof

- [x] 2.1 Trace `mayDo` to member-accounts "The Owner corrects a Member's address": a `//@ contract` line and an `ensures` for the scenario "An Editor tries to change an address" (only the Owner may `manageAccounts`; Editors, Contributors and Agents are refused); verify with `pnpm verify` and `pnpm verify:trace`, by a deliberate bug that makes `lsc check` fail (letting an Editor `manageAccounts`), and with a case in `shared/test/rules.test.ts`. Update the proof's scope in `scripts/verification-trace/texts.mjs` and regenerate `docs/verification.md`

## 3. The server

- [x] 3.1 Write the confirmation email (to the new address: the Member's name, the Owner who asked, the link, 7 days, once, ignore it if you are not that Member) and the notice to the old address (no name of the Member, no new address; when, and whose change) in `server/src/mail/templates.ts`, in Czech and English; verify with golden files `address-confirm.*` and `address-changed.*` (`.txt` and `.html`) in `server/test/emails.test.ts`
- [x] 3.2 In `server/src/auth/accounts.ts`, request a change (refusals, withdrawing the open one, the email inside the transaction), withdraw it, confirm it (the address, the change and the unused sign-in links in one transaction; the notice to the old address after the commit, failures logged through `AccountDeps.log`), and list open changes for `MemberView.pendingEmail`. Add the routes `POST` and `DELETE /api/members/{id}/email-change` (`manageAccounts`) and `POST /api/auth/email-change/confirm` (public), and regenerate `server/openapi.json`. Verify in a new `server/test/email-change.test.ts`:
  - only the Owner may ask (Editor and Contributor 403, Agent token 403, anonymous 401), and nothing is sent when refused;
  - the change waits for confirmation, and sign-in links go to the old address until then;
  - `pendingEmail` is shown, and asking again replaces the open change and kills its link;
  - withdrawing kills the link;
  - an expired link is refused;
  - a used link is refused, and so is the same address, another Member's address, an address with a pending invitation, an Agent and an unknown id;
  - an address taken before confirming is refused and nothing changes;
  - after confirming, the next sign-in link goes to the new address and an old unused one is refused;
  - sessions and passkeys stay;
  - the old address gets one notice without the new address, and a failing notice keeps the change;
  - a failing confirmation email leaves nothing waiting;
  - the token is stored only as its hash.

  Also verify with `pnpm --filter @rodokmen/server openapi:check` and `server/test/auth-guard.test.ts`

## 4. The app

- [x] 4.1 The confirmation page: the route `#address/<token>` in `app/src/routes.js` (not a family address), wired in `app/src/shell.js`, as a mode of `app/src/sign-in-screen.js` that takes the token out of the address bar, confirms only on the button, names the new address after, and turns 410 and 409 into texts in the reader's language. Add `confirmEmailChange` to `app/src/api.js` and the texts to `app/i18n/cs.json` and `en.json`. Verify with a routes case in the unit tests (`app/tests/unit/`) and in a new `app/tests/e2e/family-address.spec.js` at phone and desktop sizes: opening the page calls nothing until the button, the token leaves the address bar, confirming names the address, and an old link shows the message
- [x] 4.2 Settings: `app/src/settings-email-change.js` in `MemberRow` (Correct the address, the form with its note, Send a confirmation link, Cancel; the waiting address with Withdraw), with `changeMemberEmail` and `withdrawEmailChange` in `app/src/api.js`, the module in `app/src/precache.js`, and the texts in both languages. Verify in `app/tests/e2e/family-address.spec.js` at phone and desktop sizes: the request's body, the status line, the waiting address and Withdraw, a refusal shown, nothing wider than the screen, and a Contributor sees none of it; and with the app unit tests (`precache`, `i18n`)

## 5. Docs

- [x] 5.1 How-to: a section "Correct a Member's address" in `docs/how-to/invite-a-member.md` (ask, what the relative does, withdraw, an invited address, when to disable instead), and its index line in `docs/README.md`. Reference: the three routes and `pendingEmail` in `docs/reference/api.md`, and correcting addresses under `manageAccounts` in `docs/reference/roles-and-actions.md`. Explanation: why a new address waits for confirmation, and what the old address is told, in `docs/explanation/privacy.md`. Update `README.md`, which says what works. Verify with `pnpm lint:docs`

## 6. Everything together

- [x] 6.1 Run `pnpm check`, `pnpm verify`, the server tests touched (`email-change`, `emails`, `invitations`, `email-links`, `auth-guard`, `agents`, `migrations`, `openapi`, `roles`) and the Playwright files touched with at most 2 workers; verify they pass and CI is green on the PR

## Workflow follow-up

- When archiving, the requirements here add to `member-accounts` (`add-tree-backend`) and `family-view` (`add-family-view`). If `add-interface-languages` is archived first, both emails and the new texts need Slovak and German as well.
