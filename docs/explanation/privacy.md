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

Inside the Tree, Members see everyone, Living people too: it is the family's own Tree. The protection is for the copies that leave the server. In every Export, the nightly one to `rodokmen-export` and the Owner's GEDCOM download, a Living person keeps only their name, sex, relationships and birth year. One proved function makes that reduction, and both writers write only what it returns, so the Markdown notes and the GEDCOM file cannot disagree about what a Living person shows. The reduction reaches beyond the Person's own record: an Event a Living person took part in is left out of everyone's record, since a parent's note listing "birth of their daughter, 4 March 2010" would give away exactly what the reduction hides, and so are the notes of a Family a Living person belongs to. When in doubt it leaves out more, as the Living rule does.

The Export is one-way and off until the Owner switches it on: it sends the family's data to a repository outside the server, so it waits for the Owner's own repository and key ([Set up the nightly Export](../how-to/set-up-the-nightly-export.md)).

A Living relative may also ask to leave the Tree completely. The Owner then erases them: from the Tree, from its history, and from the Export's history ([Erase a Living person](../how-to/erase-a-living-person.md)). The log is otherwise append-only, and erasure is its one exception (ADR 0006): a complete audit trail matters less than a relative's wish to be forgotten. Their history entries become markers that say a record was erased and when, so the history of the people around them still shows that something was there, without saying what. Only Living people can be erased, because the evidence about the dead is what the Tree is for, and Events shared with others stay. The Export's history is replaced by a single commit, since an old commit would still hold them. Backups are not rewritten: they are kept for recovery and age out within a year, and every restore erases again whoever is on the list of erasures, which holds ids only.

What erasure cannot find stays: free text that names the Person, such as the transcription of a Citation other people share, a research note or a scan reading. The Owner reads and corrects those, as the erasure guide says.

## Images stay private

Each Citation can hold an image of the register page it cites, and Persons can hold portraits (ADR 0002). Archive portals change their addresses, and a Citation must stay checkable for as long as the Tree exists, so Rodokmen keeps its own copy. But archives allow copies for personal research, not for publishing. So the copies are private: they are served only through signed links that expire within minutes, from a separate host that the session cookie never reaches, and they never go into an Export.

## Data on Members' devices

The app keeps what a Member last loaded on their device, so the family stays readable offline, and Drafts with their photos stay there until submitted. Nothing is cached for a visitor who is not signed in, and signing out empties the cache ([Offline and the app](offline.md)).

## The Vault and this public repo

Before the Tree existed, the Owner kept the research as Markdown notes in a private repo, the Vault. It is imported into the Tree once, as Proposals the Owner reviews, and then frozen as a read-only archive (ADR 0010).

This repo, by contrast, is public, along with its issues and pull requests. So it holds code and public reference data only. Examples, tests and the fixture Tree use invented people. Two checks keep it that way: the `repo-guard` workflow refuses GEDCOM files, a `people/` folder and images outside the app and test fixtures; and Git hooks check every commit and push against a private denylist of the Vault's names, which never leaves the Owner's computer ([Vault denylist format](../reference/vault-denylist.md)).

## Where data goes outside

The server, its database and the images run on one VPS in the EU, and the Backups go, encrypted, to a second EU provider. Email goes through an EU email service. The one exception is scan reading, which sends a scan to Anthropic's API in the USA to be read, so private family scans leave our servers. It therefore stays off until the Owner switches it on, sends only the display copy or a marked part and the names of people who are not Living, has a daily limit, and its result is always checked by a person (ADR 0011, [Scan reading](scan-reading.md)).
