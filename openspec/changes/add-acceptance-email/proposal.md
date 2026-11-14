# Proposal

## Why

Anyone who holds an invitation link can accept it, and since `add-whatsapp-invitations` (#141) the link can also travel through WhatsApp, where a message is forwarded with one tap and kept in backups. Every Member sees the whole Tree, Living people included. Today the Owner notices a wrong acceptance only by opening Settings. The Owner should be told at once, so that a wrong person can be disabled before they have looked around for long (issue #151). The Owner gave the go-ahead on 2026-11-14.

## What Changes

- When a relative accepts an invitation, Rodokmen emails the Owner once, in the Owner's language. The email names the display name the relative chose, the invited address and when it was accepted. It says that the new Member is a Contributor and sees the whole Tree, and that if this is not the person the Owner invited, the Owner disables them in Settings, which ends their sessions at once. Its button opens Settings.
- The email goes to whoever is the Owner when the invitation is accepted, not necessarily the Member who sent it, since ownership can be handed over and only the Owner can disable a Member.
- The email goes out after the acceptance is stored. A failure to send it is logged and changes nothing: the relative stays a Member and signed in. (The invitation email works the other way round on purpose: it is sent inside its transaction, so that no invitation exists whose link nobody has.)
- One acceptance, one email. An invitation has one link, however it travelled, and works once. A second pending invitation to the same address is refused once the first is accepted. So the Owner never gets two emails for one new Member.

Out of scope:

- A switch to turn these emails off, and a mark in Settings for new Members. The design explains why, and the PR asks the Owner whether either is wanted.
- Telling the Owner about anything else a Member does (signing in, adding passkeys).
- Slovak and German texts, which come with `add-interface-languages` (#113): the email exists in Czech and English, the interface languages on main.

## Capabilities

### New Capabilities

### Modified Capabilities
- `member-accounts`: accepting an invitation also tells the Owner by email, after the acceptance is stored.

Main specs are empty because no change is archived yet, so this delta adds a requirement, as `add-whatsapp-invitations` did. It adds to `member-accounts` "Invitation only" (`add-tree-backend`) and replaces nothing.

## Impact

- **Server**: `server/src/auth/accounts.ts` (`acceptInvitation` sends the email after its transaction; `AccountDeps` gains an optional `log`), `server/src/mail/templates.ts` (the new email), `server/src/app.ts` (the log).
- **API**: no new route and no new field. `POST /api/auth/invitation/accept` answers as before; `server/openapi.json` changes only in that route's summary.
- **App**: none.
- **Tests**: `server/test/invitations.test.ts` and golden files in `server/test/__snapshots__/emails/` (`emails.test.ts`), one per language.
- **Docs**: `docs/how-to/invite-a-member.md`, `docs/reference/api.md`, `docs/explanation/privacy.md` and `README.md`.
- **Data and dependencies**: no migration, no new setting, no new dependency.
