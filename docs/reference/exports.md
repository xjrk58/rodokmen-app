# Exports and erasure

What leaves the server in an Export, in which files and formats, and what erasing a Living person removes. Why Rodokmen works this way is in [Privacy and the public/private split](../explanation/privacy.md). The Owner's steps are in [Set up the nightly Export](../how-to/set-up-the-nightly-export.md) and [Erase a Living person](../how-to/erase-a-living-person.md).

## What every Export holds

Every Export, the nightly one and the Owner's GEDCOM download, is written from the same view of each record (`exportRecord` in `shared/src/export.ts`, proved, see [Verification](../verification.md)):

| Record                                     | In the Export                                                                                                                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A Living person                            | the given name and surname of the primary Name, sex, the Families they are a child or partner in, and the birth year. No other Name, Event, exact date, Place, House, Citation, note, Label or image |
| Any other Person                           | every Name with its Citations, sex, Families, the Events they took part in, relation to the family, Family root, Labels and research notes                                                           |
| An Event a Living person is in             | left out of every record, also of the notes of the other people in it                                                                                                                                |
| A Family with a Living member              | its partners and children, without its research notes                                                                                                                                                |
| A Family account a Living person gave      | "given by a Living relative", without the link to them                                                                                                                                               |
| Places, Houses, Parishes, Estates, Sources | every field, with their links to each other                                                                                                                                                          |
| Research leads (Markdown only)             | without links to Living people; a lead about Living people only is left out; search records with the name the searcher gave, never a Member's account                                                |
| Images and documents                       | never: no page image, portrait, photo or PDF, and no link to one. Image embeds and links to images or documents are taken out of research notes                                                      |

Who is Living is the [Living rule](../explanation/privacy.md#living-people) on the day the Export is written.

## The Markdown Export

One note per record, in folders, with YAML frontmatter and `[[slug|title]]` links, so the folder opens as an Obsidian vault:

| Path                 | Holds                                                         |
| -------------------- | ------------------------------------------------------------- |
| `README.md`          | what the repository is, and that it is not edited by hand     |
| `family.ged`         | the GEDCOM file (below)                                       |
| `people/<slug>.md`   | a Person: Names, Families, Events with their Citations, notes |
| `families/<slug>.md` | a Family: partners, children, marriages, notes                |
| `places/<slug>.md`   | a Place: names over time, Parishes, Estates, Houses, notes    |
| `houses/<slug>.md`   | a House: its Place and house numbers over time                |
| `parishes/<slug>.md` | a Parish: its seat and its Places over time                   |
| `estates/<slug>.md`  | an Estate: its Places over time                               |
| `sources/<slug>.md`  | a Source: type, title, archive, reference, register coverage  |
| `leads/<slug>.md`    | a Research lead with its search records                       |

Every note's frontmatter has `id` (the record's id in the Tree) and `type`; a Person's also `name`, `aliases`, `sex`, `living`, `birthYear`, `relation`, `familyRoot` and `labels`.

A slug is made once from the record's name, such as `jan-novak-1801` for a Person (name and birth year) or `kamenna-lhota` for a Place, and kept (table `export_slug`): correcting a Name later does not rename the note. Slugs are unique across folders, with `-2`, `-3` … when one is taken.

## The GEDCOM file

`family.ged` is GEDCOM 5.5.1, lineage-linked, in UTF-8, the same in the nightly Export and the download.

| Tree                          | GEDCOM                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Person                        | `INDI`, cross-reference `@I…@` from the last 16 hex digits of the id                                                        |
| Name                          | `NAME Given /Surname/` with `GIVN`, `SURN`; other Names with `TYPE` (`birth`, `married`, `aka`)                             |
| Living person                 | `NAME`, `SEX`, `BIRT` with `DATE <year>`, `FAMC`, `FAMS`, and nothing else                                                  |
| Birth, baptism, death, burial | `BIRT`, `CHR`, `DEAT`, `BURI` for the child or the deceased                                                                 |
| Residence, census, other      | `RESI`, `CENS`, `EVEN` with `TYPE`, for each Person in it                                                                   |
| Godparent, witness, priest    | `ASSO` with `RELA` on the child's or the deceased's record                                                                  |
| Marriage                      | `MARR` on the `FAM` record                                                                                                  |
| Place, House                  | `PLAC` with `MAP`/`LATI`/`LONG`; a House as `ADDR` with `čp.` and its number                                                |
| Date                          | `1801`, `FEB 1801`, `6 FEB 1801`; about `ABT`, uncertain `EST`, ranges `BET … AND …`, `BEF`, `AFT`                          |
| Family                        | `FAM` with `HUSB`, `WIFE` (by sex where known, else in the Tree's order) and `CHIL`; `PEDI` for adopted and foster children |
| Citation                      | `SOUR @S…@` with `PAGE`, `QUAY` (very low 0, low 1, normal 2, high and very high 3) and `DATA`/`TEXT`                       |
| Source                        | `SOUR` with `TITL`, `AUTH` (who gave a Family account), `REPO` and `CALN`; the archive as a `REPO` record                   |

The header has no date, so the same Tree always gives the same file.

## The nightly Export

| What          | Value                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| When          | every night at 04:00 Prague time, as the daily job `nightly-export`; `export run` runs it at once                                             |
| Where         | the branch `RODOKMEN_EXPORT_BRANCH` of `RODOKMEN_EXPORT_REPO` ([Configuration](configuration.md)), with the deploy key over SSH               |
| Commit        | only when the files differ from the branch's last commit; message `Export of <day>`                                                           |
| Hand edits    | overwritten by the next Export: it writes every file from the Tree, and nothing flows back                                                    |
| After erasure | the next Export commits the files with no parent and force-pushes it: the branch has a single commit (`…, history replaced after an erasure`) |
| Off           | until `RODOKMEN_EXPORT_ENABLED=true`; the API's log says `the nightly Export is off` when it starts                                           |

## Routes

| Route                           | Who       | What                                                                                                                              |
| ------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/export/family.ged`    | the Owner | the GEDCOM file, as an attachment `family.ged`, never cached                                                                      |
| `GET /api/persons/{id}/erasure` | the Owner | what erasing the Person would remove (`ErasurePreview`): whether they may be erased, the name to type, counts, the Events that go |
| `POST /api/persons/{id}/erase`  | the Owner | erases them; body `{ "confirmation": "<name>" }`, case and spaces do not matter (`ErasureResult`)                                 |

The OpenAPI description (`server/openapi.json`) has their schemas.

## Erasure

Only a Living person can be erased; anyone else is refused with `409 not_living`. A confirmation that does not name them is refused with `400 confirmation_mismatch`, and a Person merged into another with `409 merged` (erase the Person it was merged into).

In one transaction, erasure removes:

- the Person and any Persons merged into them, their Names, Roles in Events, Family links, Labels and Family root;
- the Events only they took part in; an Event shared with others stays, without their Role;
- the Citations attached only to what goes; a Citation also attached to something that stays keeps its transcription;
- the images that show only them, and the page images of the Citations that go, with their files;
- Families left with nobody;
- the Research leads about them alone; other leads lose their link to them, and the history of a lead says "erased" where it named them;
- their entries in the Vault importer's map and the Export's slugs; a Member linked to them is unlinked, and a Family account they gave keeps the account but not their name.

In the log, every change that mentioned a removed record becomes `{ "erased": true, "at": "<time>" }`; the history of a record shows that entry as "Erased record (erased on <day>)". Each Proposal behind such an entry, and each Proposal whose operations named a removed record, loses its operations, notes and reader marks; a pending one is closed as rejected. Such a Proposal can no longer be undone (`409 erased`).

The erased ids and dates are kept in the table `erasure`, without any other data. The nightly Backup copies them to `db/erasures.tsv`. The API erases again every listed Person a restored database still holds before it answers any request, and `erasures reapply --list` brings in a newer list ([Restore from a Backup](../how-to/restore-from-a-backup.md)).

Not changed: the transcriptions of Citations that stay, notes of other records, and scan readings, even where they name the Person; the Owner reads and corrects those. A pending Proposal that would create the Person anew, without naming their id, is not found either.
