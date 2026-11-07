# How to erase a Living person

This guide shows the Owner how to remove a Living relative from the Tree completely, when they ask. Erasure cannot be undone. What it removes is in the [Exports and erasure reference](../reference/exports.md#erasure); why the log may be rewritten for it is in ADR 0006 and in [Privacy and the public/private split](../explanation/privacy.md).

Only the Owner can erase, and only a Living person: born within the last 100 years with no recorded death, or with neither birth nor death recorded.

## Erase them

1. In the app, open the Person's page (**People**, search their name).
2. At the bottom, under **Erase this person**, tap **Show what would be erased**. If the section is not there, the Person is not Living, or you are not signed in as the Owner.
3. Read the list: their Names, Roles and Family links, the Events only they took part in, the Citations and images that go with them, the Research leads, and how many Proposals will show as "erased record" in the history. Pending Proposals about them are closed.
4. Type their name as shown (case and spaces do not matter) and tap **Erase for good**.

The app returns to the People list. Search, person pages, pedigrees and family pins no longer show them.

## After the erasure

- **The Export.** If the nightly Export is on, the next one replaces the history of `rodokmen-export` with a single commit. To do it at once, run `node dist/cli.js export run` in the API container ([Set up the nightly Export](set-up-the-nightly-export.md)). GitHub may keep the old commits in its caches for a while; if the relative asks, ask GitHub Support to purge the cached views of `rodokmen-export`.
- **What stays.** A Citation of an Event others share keeps its transcription, and research notes and scan readings keep their text, even where they name the erased Person. Search for their name and correct those through a Proposal.
- **Other devices.** A Member's phone drops its saved copy of the person page the next time it opens it online.
- **Backups.** Older Backups still hold the Person until they age out after 12 months. A restore erases them again before the API answers any request ([Restore from a Backup](restore-from-a-backup.md)).
- **The Vault importer.** Do not run the Vault importer again: it would propose the Person anew. If it does, reject that Proposal.

## By API

The same as the app does, with the Owner's session:

```sh
curl -b cookies.txt https://<domain>/api/persons/<id>/erasure
curl -b cookies.txt -H 'content-type: application/json' -d '{"confirmation":"<name>"}' https://<domain>/api/persons/<id>/erase
```
