# Design

## Context

The log (ADR 0006) is append-only, Backups are kept for 12 months (operations spec), and `rodokmen-export` is a one-way Export (ADR 0008). Erasure has to work across all three.

## Goals / Non-Goals

**Goals:**
- Exports readable by a person and by an Agent without the server.
- Erasure that holds after any restore.

**Non-Goals:**
- No GEDCOM 7 yet: 5.5.1 is what most programs import.
- No rewriting of Backups; they age out.

## Decisions

### Export layout
`rodokmen-export` holds `people/`, `families/`, `places/`, `houses/`, `parishes/`, `estates/` and `sources/`, with one Markdown note per record. Each note has YAML frontmatter generated from the shared schemas and `[[slug]]` links between notes, so it opens in Obsidian. `family.ged` sits at the root. Slugs are generated (for example `jan-novak-1801`) and kept stable through a slug table, so links do not churn between nights.

### Reduction happens in one place
One function in `shared/` produces the reduced view of a Living person. Both writers (Markdown and GEDCOM) call it, so they cannot drift apart. A test feeds a Living fixture through both writers and fails if any field outside the allowed set appears.

### Git access
The server pushes with a deploy key that can write only to `rodokmen-export`. After an erasure, the Export force-pushes an orphan commit to replace the branch. Old commits may linger in GitHub's caches until garbage collection, which is noted for the Owner.

### Erasure mechanics
Erasure runs in one transaction. It deletes the Person and their dependent rows, removes Events left with no participants, rewrites log entries about the Person to `{ erased: true, at }`, and appends the Person's id to the `erasures` table. The restore procedure applies the `erasures` table before the API starts.

### Rules proved with LemmaScript
These pure functions in `shared/` are proved with `lsc check` (ADR 0009). Each lives in one file with everything its proof calls, and keeps optionals out of ordering comparisons (docs/verification.md, known issues). The queries that load and delete rows, the writers' text and the Git push are the trust boundary; the tests cover them.
- **The reduction of a Living person** (exports: Living people are reduced in every Export; exports: GEDCOM download for the Owner): the one reduction function. Proved: its output holds only name, sex, relationships and birth year, and no exact date, other Event, Place, House, Citation, note or image. Who is Living comes from the proved Living rule.
- **The Export view of a record** (exports: No images in any Export): proved: for any record the view holds no image and no image link.
- **Who may be erased, and what goes** (erasure: Owner erases a Living person): proved: erasure is refused unless the Person is Living and the confirmation names them; the Events removed are exactly those whose only participant is the Person; no row of another Person is selected.
- **The log rewrite** (erasure: Erasure reaches the log): proved: every entry about the Person becomes a marker holding only "erased" and the time, and no other entry changes.
- **Reapplying erasures** (erasure: Restores keep erased people erased): proved: after reapplying the list no erased id remains, and nothing else is removed.

## As built (issue #19)

Choices made while building, within the specs:

- **One record shape.** Every record kind is an `ExportRecord` (shared/src/export.ts); `exportRecord` is the view both writers write, so "for any record" in the proofs means every kind. Image and document links are links of kind `image` or `document`; the gatherer decides which links those are and takes image embeds out of notes.
- **Events with Living people.** An Event in which a Living person has any Role is left out of every record, not only theirs: a parent's or partner's note would otherwise give the exact birth or marriage date the reduction hides. A Family with a Living partner or child keeps its partners and children but not its notes. A Family account given by a Living person says "a Living relative". When in doubt the Export leaves out more.
- **Leads** are exported as notes in `leads/`, through `leadsForExport` (research-leads task 1.4).
- **Slugs** are unique across folders, so a `[[slug]]` link names one note.
- **Erasure also removes** the Citations attached only to what goes (their transcription names the Person), Families left with nobody, Persons merged into the erased one, and their entries in the importer's map. Citations of Events others share stay, with their transcriptions; the Owner corrects those, as the erasure guide says.
- **The log rewrite** marks every change that mentions a removed record, and records which records that stay it pointed at (`log_change.erased_refs`), so that their history still lists the entry as "erased record". The Proposal behind such an entry, and any Proposal whose operations name a removed record, loses its operations, notes and reader marks (`proposal.erased_at`); a pending one is closed. Its undo is refused.
- **Reapplying** runs when the API starts, before it listens, and in `erasures reapply`. Each Backup keeps the list (`db/erasures.tsv`), so a restore of an older Backup takes the newest list; the monthly restore test erases again with it.
- **Off by default.** The nightly Export runs only with `RODOKMEN_EXPORT_ENABLED=true` and a repository, since production holds the Owner's real Tree.

## Risks / Trade-offs

- [Erasure removes evidence other people relied on] → only Living people can be erased, and the confirmation lists which Events will disappear.
- [GitHub keeps unreachable commits for a while] → documented. GitHub support can purge cached views if a relative asks.
- [Backups keep erased data for up to 12 months] → the erasure list is reapplied on any restore, and Backups age out.

## Open Questions

None that change the specs.
