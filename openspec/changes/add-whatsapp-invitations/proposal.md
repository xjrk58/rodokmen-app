# Proposal

## Why

Today an invitation reaches a relative only by email. Many relatives read WhatsApp far more often than their email, and the Owner asked on 2026-11-05 to be able to invite people "via whatsapp" (issue #141). The Owner should be able to send the same invitation link from their own WhatsApp, in a message ready in the invited relative's language.

## Decisions

The Owner answered the two questions of #141 on 2026-11-05:

1. **WhatsApp is an extra way to send the invitation, not a replacement.** An invitation still needs an email address, and the invitation email still goes out, inside the transaction as today. The Owner can also send the same link through WhatsApp. Every Member therefore keeps an address for emailed sign-in links, the fallback when a passkey is lost.
2. **The Owner sends it from their own WhatsApp.** The app opens the phone's share sheet, or WhatsApp, with the message ready, and the Owner picks the contact. There is no WhatsApp Business API, no Meta account, and no phone numbers stored on the server.

## What Changes

- The answer to `POST /api/invitations` holds the invitation's link and a ready message: in the invitation's language, with the inviter's name, the link, its 7-day validity and the address the email went to. The link is in this answer only; the list of invitations never holds it, because the server keeps only the token's hash.
- In Settings, after sending an invitation, the Owner sees the message once, with **Send through WhatsApp**, which opens the device's share sheet where there is one, and **Copy the message** everywhere, for WhatsApp on a computer. Settings says that the link is shown only now, and that to send it later the Owner withdraws the invitation and invites again.
- The invitation page shows the address the invitation went to, says that sign-in links will go there, and asks the relative not to accept when it is wrong. A link that came through a chat does not prove the relative reads that mailbox, so this is where a mistyped address is caught.
- Opening an invitation link, by anyone or any link preview, uses nothing up: the token stays in the address's fragment, checking is read-only, and only accepting with a display name uses the invitation. Tests prove it.
- Working once, the 7 days and withdrawing apply as before, whichever way the link travelled: it is one invitation with one link.

Out of scope:

- Sending anything from the server through WhatsApp, the WhatsApp Business API, a Meta account, and storing phone numbers (Decision 2).
- Invitations without an email address, and Members without one (Decision 1).
- Opening `wa.me` or any other web address with the token in it (design.md, "Who sees the token").
- Showing a pending invitation's link again later, or issuing a new link for the same invitation. The Owner withdraws it and invites again.
- Correcting a Member's email address after accepting (#152), and telling the Owner when an invitation is accepted (#151). Each is its own backlog item.
- Slovak and German texts, which come with `add-interface-languages` (#113): the message and the new interface texts exist in Czech and English, the interface languages on main.

## Capabilities

### New Capabilities

### Modified Capabilities
- `member-accounts`: the answer that creates an invitation holds its link and a message for the Owner's own WhatsApp; opening an invitation link uses nothing up; a pending invitation's check names the invited address.
- `family-view`: Owner settings offer to send a new invitation through WhatsApp (share sheet or copy), and the invitation page shows the invited address before accepting.

Main specs are empty because no change is archived yet, so these deltas add requirements, as `default-to-czech` did. They add to `member-accounts` "Invitation only" (`add-tree-backend`) and to `family-view` "Owner settings in the app" and "Sign-in in the app" (`add-family-view`) and replace nothing.

## Impact

- **Shared**: `shared/src/schemas/accounts.ts` gains `CreatedInvitation` (an `InvitationView` with `link` and `shareText`) and `email` in `InvitationCheck`.
- **Server**: `server/src/auth/accounts.ts` (`createInvitation` returns the link and the message; `checkInvitation` names the address of a pending invitation), `server/src/routes/accounts.ts` (the 201 answer of `POST /api/invitations`), a new template for the message next to the emails in `server/src/mail/templates.ts`, and `server/openapi.json`.
- **App**: `app/src/settings-screen.js` and a new `app/src/settings-invitation.js` (the message shown once, share sheet and copy), `app/src/sign-in-screen.js` (the invited address), `app/src/types.js`, `app/src/api.js`, `app/styles.css`, and new texts in `app/i18n/cs.json` and `app/i18n/en.json`.
- **Tests**: `server/test/invitations.test.ts`, a new link-preview test, an email-style snapshot of the message, and Playwright tests in `app/tests/e2e/family-settings.spec.js` and `family-sign-in.spec.js` at phone and desktop sizes.
- **Docs**: a new how-to guide for inviting a Member, `docs/reference/api.md`, `docs/explanation/privacy.md`, `docs/README.md` and `README.md`.
- **Dependencies**: none new. No new data processor: nothing leaves the server towards WhatsApp.
