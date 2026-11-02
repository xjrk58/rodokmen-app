# Privacy and the public/private split

Rodokmen has a public half and a private half, and most of its privacy design is about keeping the line between them sharp. The public half is the map of the Czech lands: search, archive lookup and historical maps, useful to anyone researching the region. The private half is the Tree: one family's people, evidence and history, for invited Members only.

## The public map holds no family data

The map runs on public reference data alone: districts, Municipalities, archives and map layers in `app/data/`. It works without signing in, offline, and even from static hosting. Nothing about the family is needed to answer "which archive holds the registers for this village?", so nothing about the family is in it. When a Member signs in, the same app shows the family on the map, fetched from the API with their session.

## The Tree is for invited Members

There are no public pages of the Tree and no self-registration. The Owner invites each Member by email, and Members sign in with passkeys or emailed links, never passwords. Every API request except the health check and the sign-in steps needs a Member's session or an Agent's token, and a refused request reveals nothing, not even whether a record exists.

Inside, every Member sees the whole Tree. Rodokmen deliberately has no per-person permissions: it serves one extended family that shares its history, and rules about who may see which cousin would be hard to get right and harder to explain. The roles decide who may change the Tree, not who may read it ([Roles and actions](../reference/roles-and-actions.md)).

Pending Proposals are the exception: other Members see a change only once an Editor accepts it ([Proposals and review](proposals-and-review.md)).

## Living people

A Person counts as Living when they were born within the last 100 years with no recorded death, or when neither birth nor death is recorded. Rodokmen computes this from the Events and never lets it be set by hand: a flag someone must remember to tick is a flag someone forgets. The rule errs on the side of caution, since a Person with no dates at all is treated as Living. It is one of the proved rules.

Today the app marks Living people. Their real protection is for the copies that leave the server, which are still to be built (OpenSpec change `add-exports-and-erasure`): in every Export, a Living person keeps only their name, sex, relationships and birth year. And a Living relative may ask to be erased; the Owner then removes them from the Tree and from its history, the one exception to the append-only log (ADR 0006).

## Images stay private

Each Citation can hold an image of the register page it cites, and Persons can hold portraits (ADR 0002). Archive portals change their addresses, and a Citation must stay checkable for as long as the Tree exists, so Rodokmen keeps its own copy. But archives allow copies for personal research, not for publishing. So the copies are private: they are served only through signed links that expire within minutes, from a separate host that the session cookie never reaches, and they never go into an Export.

## Data on Members' devices

The app keeps what a Member last loaded on their device, so the family stays readable offline, and Drafts with their photos stay there until submitted. Nothing is cached for a visitor who is not signed in, and signing out empties the cache ([Offline and the app](offline.md)).

## The Vault and this public repo

Before the Tree existed, the Owner kept the research as Markdown notes in a private repo, the Vault. It is imported into the Tree once, as Proposals the Owner reviews, and then frozen as a read-only archive (ADR 0010).

This repo, by contrast, is public, along with its issues and pull requests. So it holds code and public reference data only. Examples, tests and the fixture Tree use invented people. Two checks keep it that way: the `repo-guard` workflow refuses GEDCOM files, a `people/` folder and images outside the app and test fixtures; and Git hooks check every commit and push against a private denylist of the Vault's names, which never leaves the Owner's computer ([Vault denylist format](../reference/vault-denylist.md)).

## Where data goes outside

The server, its database and the images run on one VPS in the EU, and the Backups go, encrypted, to a second EU provider. Email goes through an EU email service. The one planned exception is scan reading, which would send a scan to Anthropic's API to be read, so private family scans would leave our servers. It therefore stays off until the Owner switches it on, has a daily limit, and its result is always checked by a person (ADR 0011).
