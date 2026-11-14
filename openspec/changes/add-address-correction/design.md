# Design

## Context

How a Member's address works today (`add-tree-backend`, `add-whatsapp-invitations`):

- `account.email` is set once, by accepting an invitation: it is the invited address, lowercased, unique among accounts (`account_email_idx`). An Agent has none. No route changes it.
- `POST /api/auth/email-link` sends a sign-in link to a Member's address. The link is valid once for 15 minutes, and only its hash is stored (`sign_in_link`). Disabling a Member ends their sessions and uses up their unused sign-in links.
- Passkeys belong to the account, not to the address. Sessions are rows of `session`, ended by `endAllSessions`.
- Invitations, sign-in links and Agent tokens follow one pattern: a 256-bit token, only its SHA-256 hash stored, the token in the link's fragment (`#invite/…`, `#link/…`), which no browser or link preview sends to a server. The app takes it out of the address bar at once, and a button press sends it, so opening a link uses nothing up.
- Only the Owner manages Members (`manageAccounts`, proved Owner-only in `mayDo`). The Owner's routes are under `/api/members/…`. The public sign-in steps are under `/api/auth/…`, which `server/test/auth-guard.test.ts` treats as the only public prefix besides the health check.

## Goals / Non-Goals

**Goals:**

- The Owner can correct a Member's address and keep the Member's account, with its Proposals, passkeys and link to their Person.
- A typo in the correction cannot hand the account to a stranger without that stranger confirming, and the confirmation names whose account it is.
- Nothing changes for a Member until the new address is confirmed.

**Non-Goals:**

- Members changing their own address.
- Changing anything but the address (name and language stay the Member's own, `PATCH /api/me`).
- Telling the Owner by email when a change is confirmed. Settings shows the new address.

## Decisions

### Only the Owner, through the Members list

The request is `POST /api/members/{id}/email-change` with `{ email }`, action `manageAccounts`. Correcting an address is managing a Member, the same as roles, disabling and the link to a Person. `mayDo` already lets only the Owner do it, so no new action is needed, and Agents, Contributors and Editors get 403 from the auth plugin before the route runs.

The Owner may correct their own address the same way, from their own row: the confirmation proves the new mailbox for them too.

A Member cannot change their own address. That would be a second route with its own risks: a stolen session could move the account to an attacker's address in one step, and the Owner would not see it happen. The issue asked whether to allow it. The answer built is no, and the PR asks the Owner.

Alternative: a new action `correctEmails` in `mayDo`. Rejected: it would be Owner-only like `manageAccounts`, so it adds a row to every table and a proof obligation without changing who may do what.

### The new address takes effect only once it is confirmed

Sign-in links go to the address, so whoever reads it can become the Member. A typo in the correction would otherwise hand the account to a stranger at once. So the change waits for a confirmation link sent to the new address:

- **Validity: 7 days, once.** That matches an invitation, which also proves an address the Owner typed for a relative. A relative may not read email every day, and the link does not sign anyone in, so a long validity costs little. If it expires, the Owner asks again.
- **The email** is in the Member's language. It names the Member's display name and the Owner who asked, and it says what to do when the reader is not that Member: ignore it. A stranger whose address was mistyped learns the display name, but that is what lets them see the email is not for them.
- **Sent inside the requesting transaction**, as the invitation email is. If it cannot go out, no change is left waiting whose link nobody has, and the Owner sees the error.
- **Until confirmed**, nothing changes for the Member: sign-in links still go to the old address, and the new one is no Member's. The change is visible only to the Owner, as `pendingEmail` in `MemberView`.

Rejected alternatives:

- **Changing the address at once**, without confirmation. It is simpler, but a typo would give a stranger the fallback sign-in at once, which is exactly the risk #141's design names.
- **A short validity, like a sign-in link's 15 minutes.** That would force the Owner and the relative to coordinate by phone, for no gain in safety. The danger is a wrong new address, not a slow confirmation.

### Confirming: a page and a button, no sign-in

The link is `<PUBLIC_ORIGIN>/#address/<token>`. The app takes the token out of the address bar, shows what the link does and the button **Confirm the address**, and only the button sends `POST /api/auth/email-change/confirm` with the token. Mail scanners and link previews never send the fragment. A scanner that runs the page's script still presses no button. This is how the emailed sign-in link already works.

Confirming does not sign the reader in. It proves the mailbox, which is all the change needs. If the relative has no passkey on that device, they ask for a sign-in link, which now goes to the new address. Signing in on confirmation would save one email, but it would make this link a second kind of sign-in link with a 7-day life, which is too long for one.

The answer is `{ ok: true, email }`, the address now in effect, so that the page can name it. The page does not need to show the address before confirming: the link came to it.

### One waiting change per Member, and withdrawing

A Member has at most one waiting change. Asking again marks the waiting one withdrawn, so its link stops working, and sends a new link. `DELETE /api/members/{id}/email-change` withdraws it. That is how the Owner undoes a typo in the correction before a stranger confirms it. 404 when nothing is waiting.

The table enforces it: a partial unique index on `email_change (account_id)` where it is neither confirmed nor withdrawn. Asking again withdraws all such rows first, with the Member's account row locked `for update`, so two requests at once cannot both insert.

### What is refused

When asking:

- **the same address** as now: 409 `email_unchanged`;
- **another Member's address** (or an Agent's, which has none): 409 `already_member`, as for invitations;
- **an address with a pending invitation**: 409 `invitation_pending`. The Owner withdraws the invitation first. Otherwise the invitation could still be accepted, which would refuse the confirmation later, or the reverse. Settings and the how-to say so.
- **an Agent or an unknown id**: 404, as the other Member routes answer.

When confirming:

- **an unknown, used, expired or withdrawn link**: 410 `address_link_invalid`, one code for all four, as sign-in links have one;
- **an address that became another Member's** in the meantime: 409 `already_member`, and nothing changes. The unique index on `account.email` is the backstop.

A pending invitation created for the address after the change was asked for is not checked at confirmation: whichever finishes first wins, and the other is refused as "already a Member", as two invitations to one address are today.

A disabled Member's address can be corrected too. The Member stays disabled, and no sign-in link goes to a disabled Member, so nothing opens.

### When the change takes effect

In one transaction: the account's `email` becomes the new address, the change is marked confirmed, and the Member's unused sign-in links are used up, since they went to the old address. After the commit, the old address is told.

- **Sessions are kept.** The Owner corrects an address when the right person has the account and the address is wrong or unused. Ending their sessions would sign them out of every device for nothing. A Member whose account a wrong person got into needs to be disabled, not corrected. The how-to says so.
- **Passkeys are kept.** They belong to the person's devices, not to the address.
- **The old address is told** in the Member's language that Rodokmen no longer uses it, and by whose change. It does not name the new address or the Member. The old address may be the stranger's mistyped mailbox, and they need neither. The notice is sent after the commit, and a failure is logged (`AccountDeps.log`), as the acceptance email of #151 is. A failed notice must not undo a confirmed change.

### Storage

A migration `0016_email_change` adds:

- `email_change`: `id`, `token_hash` (unique), `account_id` (the Member), `email` (the new address, lowercased, as `account.email` is checked), `requested_by` (the Owner), `created_at`, `expires_at`, `confirmed_at`, `revoked_at`;
- the partial unique index above.

Rows are kept after use, like invitations, as the record of who changed whose address and when. Nothing reads them but these routes. The previous release ignores the table, so the migration works while it still runs.

### The app

- **Settings** (`app/src/settings-email-change.js`, used in `MemberRow`): **Correct the address** opens a small form with the new address, a note that it changes only once confirmed and that sign-in links go to the old address until then, **Send a confirmation link**, and **Cancel**.
  - After sending, the status line names the address the link went to.
  - A waiting address shows under the current one, with **Withdraw**.
  - The module is new so that `settings-screen.js` does not grow, and it goes into the precache list.
- **The confirmation page** is a mode of the sign-in screen (`app/src/sign-in-screen.js`), which already takes tokens out of the address bar and shows a button for an emailed link.
  - It is not a family address, so it opens without signing in.
  - After confirming, it names the new address and offers to open Rodokmen, refreshing the signed-in Member if there is one.
  - The answers 410 and 409 get texts in the reader's language.

### API compatibility

Additive only: two routes for the Owner, one public route, and `pendingEmail` in `MemberView`. Older clients ignore the field. `server/openapi.json` is regenerated.

### Rules proved with LemmaScript

- **Only the Owner corrects a Member's address**: `mayDo` in `shared/src/rules.ts` serves member-accounts "The Owner corrects a Member's address". The rule itself does not change, since the route uses `manageAccounts`. The function gains a `//@ contract` line for the requirement and an `ensures` that states the scenario "An Editor tries to change an address": an Editor, a Contributor and an Agent are refused `manageAccounts`, and the Owner is allowed. That each route names `manageAccounts` is tested, not proved, as for every route.

Nothing else qualifies (ADR 0009). Whether a change is still open is a comparison with the clock in a query, like the status of an invitation, and the rest is I/O around transactions. The API tests cover them.

## Risks / Trade-offs

- [The Owner mistypes the new address, and a stranger confirms it] → The confirmation email names the Member and asks anyone else to ignore it. Until it is confirmed, the Owner sees the waiting address and can withdraw it or ask again with the right one. If a stranger confirms anyway, the Owner corrects the address again, or disables the Member.
- [A wrong person had already signed in through the old address] → Correcting keeps sessions and passkeys, so it does not remove them. The how-to says to disable the Member in that case, not to correct the address.
- [The relative never confirms] → Nothing changes; the old address keeps working. The link expires after 7 days, and the Owner can ask again.
- [The notice to the old address reaches a stranger] → It names neither the Member nor the new address, only Rodokmen and the Owner, whom that address's invitation already named.
- [A passkey saved before the change still shows the old address in the phone's list of passkeys] → The passkey keeps working: Rodokmen finds the Member by the passkey and the account's id, never by the address. The name shown is the address at the time the passkey was saved, which the phone keeps; a passkey saved after the change shows the new one.

## Migration Plan

Deploy as usual: the migration adds a table and an index and touches no existing data. A rollback reverts the code. The table may stay, since no older code reads it. Its `down` drops it.
