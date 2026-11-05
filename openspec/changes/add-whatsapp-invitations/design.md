# Design

## Context

How invitations work today (`add-tree-backend`, `add-family-view`):

- Only the Owner invites, with `POST /api/invitations` (an email address and a language). `createInvitation` in `server/src/auth/accounts.ts` makes a 256-bit token, stores only its hash, and sends the invitation email inside the transaction, so that no invitation exists that nobody has the link to. The answer is an `InvitationView`, which holds no link.
- The link is `<PUBLIC_ORIGIN>/#invite/<token>`. The app reads the token from the fragment and takes it out of the address at once. It checks the invitation with `POST /api/auth/invitation/check`, which only reads, and accepts it with `POST /api/auth/invitation/accept`, with the display name and language the relative typed. Accepting uses the invitation in the same transaction that creates the account.
- The app's pages go out with `Referrer-Policy: no-referrer`. The service worker leaves `/api/` alone, and the Settings screen keeps an Agent's new token in its state alone (`app/src/settings-agents.js`).
- The account's address is the invited address. Emailed sign-in links, the fallback when a passkey is missing, go to it.

The Owner's two decisions are in proposal.md, "Decisions": the email stays and still goes out, and the Owner sends the WhatsApp message from their own phone or computer.

## Goals / Non-Goals

**Goals:**

- The Owner can send the same invitation link through their own WhatsApp, in a message in the relative's language, without the token passing through any server other than ours.
- Nothing about an invitation's lifecycle changes: one link, works once, 7 days, can be withdrawn.
- A mistyped address is caught before it becomes an account's address, without a new verification step.

**Non-Goals:**

- No new storage, no migration, no new dependency, no new data processor.
- No way to show a link again later. Losing it means withdrawing and inviting again.

## Decisions

### The server returns the link once, and writes the message

The 201 answer of `POST /api/invitations` becomes a `CreatedInvitation`: the `InvitationView` plus `link` (the same link as in the email) and `shareText` (the message). This is the pattern of `IssuedAgentToken`: a secret is shown in the answer that creates it and nowhere else, because only its hash is stored. `GET /api/invitations` keeps answering `InvitationView`, which has no link.

The message is written on the server, in `server/src/mail/templates.ts` next to the invitation email, by `invitationShareText`:

- The email and the message are two forms of one invitation. Written side by side, they agree on the link, the inviter's name and the 7 days.
- The message must be in the invitation's language, which may differ from the Owner's interface language. The app loads only the reader's language, while the server already writes every text sent to a relative in the relative's language.
- When `add-interface-languages` (#113) adds Slovak and German, the message is translated in the same place as the emails.

The field is `shareText`, not `message`, because `InvitationCheck.message` already means something else.

Alternative: return the token and let the app build the link and write the message from `app/i18n/`. Rejected. The app would have to load a second language's texts, and the public origin is the server's setting (`PUBLIC_ORIGIN`), not necessarily the app's address.

### Who sees the token: the share sheet, copying as the fallback, never `wa.me`

On a device whose browser has the Web Share API (`navigator.share`, and `navigator.canShare({ text })` where it exists), **Send through WhatsApp** calls `navigator.share({ text: shareText })`. The browser hands the text to the system's share sheet. The Owner picks WhatsApp and the relative. WhatsApp receives the text on the device and sends it end-to-end encrypted. No server sits in between, and no HTTP request holds the token. Android Chrome, Safari on iPhone and Mac, and Chrome and Edge on Windows and ChromeOS have it. Firefox on computers and Chrome on Linux do not.

Only `text` is passed, with the link inside it. Share targets differ in how they join `title`, `text` and `url`, and some keep only one of them, while a single `text` reaches every target whole. WhatsApp puts it into its compose box, where the Owner can still edit it before sending.

**The fallback is copying.** The message is shown read-only, with **Copy the message**, which uses `navigator.clipboard.writeText`. Where the clipboard is refused, the message is selected so it can be copied by hand, as for an Agent's token. The Owner pastes it into WhatsApp on the computer (the desktop app or WhatsApp Web) or sends it to their phone. Copy is offered on every device, also beside the share button, because a computer's share sheet may not list WhatsApp.

Rejected alternatives:

- **`https://wa.me/?text=…`** (and `api.whatsapp.com/send?text=…`). The whole message, token included, goes in a query string to Meta's web servers before any app opens. HTTPS protects it on the way, but the server receives it and may log it, and the address lands in the browser's history and its sync. All this saves the Owner one paste on a computer. A live token, which makes whoever holds it a Member, is not worth handing to a web server outside the family for that. So the app opens no web address that holds the token, and none is used anywhere.
- **`whatsapp://send?text=…`**. It stays on the device, but it works only when WhatsApp's desktop app is installed. Otherwise it fails silently or the browser asks about an unknown protocol, and the page cannot tell beforehand. Copying works everywhere.

### When the link exists

The link exists in exactly one answer, the one that creates the invitation. The app keeps that answer in the Settings component's state only: never in IndexedDB, localStorage, a Draft or the service worker's cache (which skips `/api/` anyway). **Done**, leaving Settings or reloading the page drops it. The list of invitations never holds it.

What #141 feared, a pending invitation whose link nobody holds, cannot happen: the email still goes out inside the transaction, so the relative always has the link by email. Losing it in the app loses only the WhatsApp route. Then the Owner withdraws the invitation and invites again, which sends a new email and kills the old link. Settings says so next to the message, and the how-to guide too. Inviting an address that has a pending invitation is allowed today, and stays so. The list shows both invitations, and accepting one makes the other fail with "already a Member".

Rejected alternatives:

- A route that issues a new link for a pending invitation. Replacing the token would silently kill the emailed link, and keeping several tokens per invitation needs a new table.
- Storing the token encrypted to show it again. It breaks "only the hash is stored", which is what makes a database leak harmless for invitations.

### Proof of the address: show it before accepting

An emailed link shows that whoever opens it can read that mailbox. A link that came through WhatsApp shows nothing about the address. If the Owner mistypes it, the account gets a stranger's address. Later emailed sign-in links go to that stranger, who could then sign in as the relative. (The stranger also gets the invitation email and could accept it first, a risk that exists today.)

The choice is to show the address to the relative, the one person who knows whether it is theirs, before they accept:

- The check of a pending invitation answers its address (`InvitationCheck.email`; `null` once it is not pending, so that an old link found in a chat later reveals nothing).
- The invitation page shows it above the form ("Your account's address: …"), says that Rodokmen sends sign-in links there, and asks the relative not to accept if it is not theirs but to ask the Owner for a new invitation.
- The WhatsApp message names it too, so the relative can notice before even opening the link.

What it means for later sign-in links: nothing changes. They go to the invited address, as for every Member. If a wrong address got through anyway, the Owner disables the Member, which ends their sessions and unused sign-in links, and invites the right address. No route changes a Member's address today. That is #152, out of scope here.

Rejected alternatives:

- **An unverified address until an emailed confirmation is clicked.** It needs new state, a migration and a step every relative must finish, for a fallback that passkeys make rare.
- **Making the relative type their address and comparing it.** People mistype too, and a mismatch has no good answer: refusing locks out the right person, and accepting changes nothing.

### Forwarding and link previews

**Link previews.** WhatsApp builds a link's preview by fetching the address, on the sender's device and sometimes the receiver's. HTTP never carries a link's fragment (RFC 9110, section 4.2.4, and the URL Standard): the request is for `/`, which answers the static app shell, the same for every visitor and with no Tree data. A previewer that ran the app's JavaScript would only check the invitation, and checking only reads. Accepting needs a display name typed into the form and a `POST`, which no previewer makes. So no preview can use up the invitation, and the server never even sees the token in one. Tests prove this rather than assume it:

- a server test fetches the invitation link over real HTTP, with a WhatsApp-like user agent, records the request targets the server received (none holds the token), also tries a previewer that misplaces the token into the path or query, checks twice, and then still accepts;
- a Playwright test opens `#invite/<token>` and sees only `check` called, never `accept`, until the form is sent.

**Forwarding.** Anyone who holds the link can accept it, as with a forwarded email. A chat makes forwarding one tap, and chats are kept in backups that are not always end-to-end encrypted. Every Member sees the whole Tree, so a stranger who accepts would see it all, Living people included. The risk is accepted for these reasons:

- The link works once and for 7 days, so a forwarded or backed-up link is soon dead. Once the relative accepts, the copy in the chat is worthless.
- The message asks the relative not to forward it. The invitation page shows the invited address, so whoever opens a forwarded link sees that it is meant for someone else.
- The Owner sees every accepted invitation and the new Member's name in Settings, and disabling a Member ends their sessions at once. New Members are Contributors, so they cannot change the Tree without review.

Telling the Owner by email when an invitation is accepted would shorten the time a wrong acceptance goes unnoticed. That is #151, a separate backlog item.

### The Settings block

After **Send the invitation** succeeds, the status line says, as today, that the invitation is on its way by email. Under it, a block in the style of an Agent's new token (`.token-once`) is titled "Also send it through WhatsApp". It holds:

- the message, read-only;
- **Send through WhatsApp**, only where the share sheet exists;
- **Copy the message**;
- the note "The link is shown only now. To send it later, withdraw the invitation and invite again.";
- **Done**.

Cancelling the share sheet (`AbortError`) does nothing. Any other failure suggests copying instead. The block lives in a new module, `app/src/settings-invitation.js`, so that `settings-screen.js` does not grow, and the new interface texts are added to `app/i18n/cs.json` and `en.json`, the interface languages on main.

### API compatibility

Both changes only add fields: `link` and `shareText` to the 201 answer of `POST /api/invitations`, and `email` to the check's answer. Clients that ignore them keep working. `InvitationView` and the list do not change. `server/openapi.json` is regenerated.

### Rules proved with LemmaScript

None qualifies (ADR 0009). The change adds two decisions, neither worth a proof:

- whether a check names the address, which is one comparison with a status that the existing, unchanged `invitationStatus` computes from the clock;
- which buttons Settings shows, which depends on what the browser offers.

The message is text formatting, which golden files check. The rules the requirements rest on (works once, the 7 days, withdrawing) are the existing status logic, which this change leaves as it is and the API tests cover.

## Risks / Trade-offs

- [The share sheet does not list WhatsApp, or the browser has no share sheet] → Copying is offered on every device.
- [The clipboard holds a live token for a while] → It is the same as copying the link out of the email. The next copy replaces it, and the link dies once used or after 7 days.
- [The Owner sends the message to the wrong contact] → The message and the page name the invited address, so the wrong person can see it is not for them. The Owner withdraws the invitation, which kills the link, and invites again.
- [Two pending invitations for one relative after inviting again] → The list shows both, and the how-to guide says to withdraw the old one. Accepting one makes the other fail with "already a Member".
- [A previewer, today or in a future WhatsApp, behaves differently] → The guarantee does not depend on the client: the fragment never travels over HTTP, no `GET` changes an invitation, and checking only reads. The server test pins all three.
- [A forwarded link is accepted by the wrong person] → See "Forwarding" above: it works once for 7 days, the page shows the address, and the Owner can disable the Member at once.

## Migration Plan

No migration and no new setting. Deploy as usual. A rollback reverts the code: nothing new is stored, and older clients ignore the new fields.
