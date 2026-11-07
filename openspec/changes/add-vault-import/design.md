# Design

## Context

The Vault follows the draft spec's vault format: YAML frontmatter, `[[id]]` links, EDTF dates, and a body for notes. On import day it held about 4,100 Person notes, mostly index entries for one village. It also had 414 Source notes with about 410 scans, 67 Houses, 55 registers, 41 Places and 19 Parishes, plus a handful of family documents (PDF, DOC). The write path, the log and review exist (`add-proposals-and-review`), and so do Agent tokens (`add-agent-access`). This change adds what an import of this size needs: batch ordering, batch acceptance, and the few model fields the Vault has and the Tree lacks.

## Goals / Non-Goals

**Goals:**
- Every Vault fact arrives with provenance and goes through review.
- The Owner can review 500 Proposals in an evening by sampling, not by reading each one.
- Running the importer twice is safe.

**Non-Goals:**
- No AI reading of note bodies during import.
- No two-way sync; the Vault is frozen afterwards (ADR 0010).

## Decisions

### Names carry a language tag (decided on #64)
A Name has a type (birth, married, nickname, other) and a BCP 47 language tag (`cs`, `la`, `de`, `pl` …) or none, in the column `name.language`. The per-language types go: migration `0010_name_languages` turns `latin` into type `other` with `la` and `german` into `other` with `de`, and rewrites the stored Proposal operations the same way, so pending and decided Proposals still read. The log stays append-only: an undo that restores an older snapshot converts its legacy type as it writes it back. Tags are checked against the BCP 47 shape (language, optional script, region and variants, in their canonical case), not against a list, so `add-country-packs` needs no new type for Polish or Russian. Scan reading (`add-scan-reading`) maps its reading languages to tags once this lands.

### Importer is an API client, not a database script
`server/src/vault-import/` holds a reader, a mapper and a submitter. It runs as `node dist/cli.js vault-import --vault <path> [--dry-run]` with `RODOKMEN_URL` and an Agent token. Everything goes through the same validation, evidence rule, log and review as any Agent Proposal. A direct database import was rejected (Q45): it would bypass review and provenance.

### Mapping

| Vault | Tree |
| --- | --- |
| `places/<id>` (name, kind, district, lat/lon) | Place, linked to its Municipality by name and district where one matches |
| `houses/<id>` (place, numbers) | House with its numbers and periods |
| `parishes/<id>` | Parish; Place–Parish periods from Place notes |
| `registers/<id>` (archive, signature, kind, years, url) | Source (register book) with archive and URL |
| `sources/<id>` (register, page, url, scans, body) | Citation of that Source (page, transcription, images) |
| `sources/<id>` with `kind` family-document, family-memory, gravestone, web | Source of that kind (Family account for memory and documents) plus its Citation |
| `people/<id>` name, variants, sex | Person, primary Name (tag `cs`), one Name per variant of type other, tagged `la` or `de` from the spelling or left untagged |
| birth, baptism, death, burial, marriages, residences | Events with Roles (child, father and mother from `father`/`mother`; partners from `marriages`) |
| `father` / `mother` | child link to a Family, the birth Family of that pair, created once per pair |
| `confidence` | confidence of the Citations that Person's facts cite (lowest wins when Persons disagree) |
| `tags` | Labels, except `obec/…`, `nepribuzny`, `mozny-pribuzny`, `import/…` |
| body | research notes; for Source notes also the transcription |
| `living`, `aliases` | not imported (Living is computed); aliases go into the id map |
| `plans/<id>` | open Research lead with the note's text and links |
| `log/<id>` searches | search records on Research leads (found or not found) |

### As built: mapping details
The table above holds; where the Vault said more, the importer does the following, all deterministic:
- **Keys.** Every record gets a stable key from the Vault (`person:<id>`, `event:<id>:baptism`, `family:<a>+<b>`, `citation:<source note>` …). A Family is created once per pair; a marriage both spouses record is one Event. With a Source note, its key ends with that note's id. Without one (no `source`, or a register note), the k-th marriage a note records to a spouse is the k-th the spouse's note records back (#149). When both give the same date and Place as written, they are one Event, created by the note that comes first in the Vault under the key an earlier run gave it (`event:marriage:<pair>:vault:<note>:<index>`), and each note attaches its own Citations. With another date or Place they stay two Events, and the dry run lists them.
- **Places.** A Place links to the Municipality of the same name in its `district` (the app's municipality list); a Place without a point of its own takes the Municipality's point when it is the Municipality's namesake. `names.de`/`la`/`old` become Place names; other languages are reported.
- **Parishes.** The Vault puts baptisms and marriages at their Parish (`place: [[parish]]`): such an Event is at the Parish's seat. A seat named in the Parish note but without a Place note becomes a Place created from that name, and the report says so.
- **Registers.** Title from kinds, Places and years; `archive`, `signature` and `url` become archive, call number and link; N, O and Z become the coverage's kinds (I, an index, none) and `years` its years. The Places a register's `places` names belong to its Parish in its years.
- **Entries.** A register entry's Citation has the note's body as transcription, its `page` (else `frame`) as page, `accessed` as read-on day, and the note path and scan link in its note. A Citation has no research notes; Source notes outside the registers (family documents and memories, gravestones, web) become Sources of their own whose research notes and Citation transcription both hold the body.
- **Persons.** `birth_surname` makes the primary Name a married name with a birth Name beside it; parents' Roles go on the birth or baptism Event the child cites, so that the parent link carries its Citation (#17). Residences become residence Events at their House or Place with their period. A date that is not EDTF is left out of the Event and kept in its description.
- **Facts citing a register note** (#133). A fact or marriage whose `source` links a register note, not an entry note, has no Source note of its own, so it cites the Vault provenance Source like any such fact. Its Event also cites the register's Source: one Citation per register and Person note (key `register-citation:<person>:<register>`), with no page, `Vault: <note path>` as its note, the Person note's frontmatter as transcription and the Person's confidence, attached to each Event of that note that cites the register. A confirmed or probable Person's parent and partner links then rest on a Citation of normal or higher confidence and are strong. The dry run's relation comparison counts such a link at the Person's confidence too.
- **Presumed death** (#132). A Person with no death or burial and no birth or baptism date of their own gets a death Event without a date in their own Proposal, with the Role deceased, citing the Vault provenance Source with low confidence and the note path. That happens when a chain of fixed bounds proves them born more than 125 years before the run. The bounds: born at least 12 years before their own marriage (recorded in either spouse's note); a parent at least 12 years before their child; a child at most a year after a parent's death, and at most 60 years after the mother's latest possible birth. They are applied again and again until nothing changes. A date counts by its latest day. Nothing else is read: no typical ages, no spouse age gaps, no note text. The description states the chain, such as `Died, date unknown: born by 1791-02-10 at the latest (married 1803-02-10, at least 12 years old), more than 125 years before 2026-11-05.` The Living rule stays at 100 years (#58); 125 years is the bound for this presumption only. The rule is `shared/src/presumed-death.ts`: an unproved search finds the tightest bound and the chain behind it, and a check proved with LemmaScript accepts only a chain whose every step follows (docs/verification.md). The dry run lists these Persons with their bound, so "Living differs" holds only the rest. The app shows an undated death as "†".
- **Fields the Tree has no place for** (#134). Each field a note has that the Tree has no place for (a Person's `occupation`, a Parish's `denomination` or `period`, a Source note's `evidence`), and each value it cannot map (a Place's `kind` word, a `district` no Municipality matches, a Place name in a language it does not take), is kept as a line as written (`occupation: farmer, retired farmer`; `Evidence class: A`). The lines follow the body of the record's research notes under "From the Vault, not mapped:", so the body stays unchanged above them. A register entry has no research notes, so its lines go in its Citation's note, below the note path. The dry run still lists every such field. Later structured homes take over field by field: an occupation Event (`add-tree-charts`), a Parish's denomination (`add-country-packs`).
- **Logs.** A search is a bullet under a heading saying found (`… a nalezeno`) or not found (`… bez výsledku`); its register is the one the bullet links (or the register of a linked entry); its years and pages are taken when written as `1784–1820` and `s. 1–60`. Nothing else is read into the prose.

### Proposal order and batch-scoped references
The importer topologically orders its Proposals. Places, Houses, Parishes and registers come first. Then Source notes, in date order, so a Person is created by the earliest entry that names them. Then one Proposal per Person for facts no Source note covers. A Proposal over the API's limit on operations (a long register index can have over 1,000) goes in as consecutive parts, cut between Persons so each keeps its facts and a Citation; the note counts as imported once its last part is in. A Proposal may reference a record created earlier in the batch by a batch reference, written `batch:<proposal id>/tmp:x` wherever an operation refers to a record. The server stores the dependency and resolves the reference when the earlier Proposal is accepted (`proposal_temp` keeps the temporary ids of every accepted batch Proposal). That only works if acceptance follows dependency order, so the review rule enforces it. Waves that wait for acceptance were considered; they would make the Owner run the importer five times.

### Vault provenance Source
Each run creates, or reuses, one Family account Source named "Vault (rodokmen-data)", given by the Owner and dated with the Vault's commit. A fact without its own Source note cites it with the note path as page and low confidence. That way the evidence rule holds and every fact says where it came from.

### Relation to the family
The relation is computed on the server after each accepted Proposal. The confidence threshold uses the best Citation on each link. The result is stored in `person.relation` so search and map filters stay cheap. Bulk acceptance recomputes once at the end, not per Proposal. The rule itself is a pure function in `shared/` (relation from a graph, Family roots and link confidences), so it can be proved with LemmaScript (ADR 0009).

As built under #15 (tasks 1.3–1.5): the server runs the proved rule itself over every Family link, not a recursive CTE, so one definition decides. Family links are a Family's two partners, and each partner with each child of the Family. Citations hang on Events, so a link's Citations are those of the Events that record it: for a partner link, Events where both have the Role partner (the marriage); for a parent link, Events where the child has the Role child and the parent father or mother (the baptism or birth). A link without such a Citation is weak. Family roots are `family_root` records the Owner marks through their own route, logged as the Owner's direct change, so they have history and undo like any change and a merge keeps them. The relation is derived: it bumps no version and stays out of the log.

### Id map and re-runs
`vault_import_map(key, kind, note_hash, batch_id, proposal_id, temp_id, record_id)` is kept on the server and read and written by the importer through the API (`GET`/`PUT /api/import-map`). It holds every key the importer submitted, with the Proposal and temporary id that create it; the record in the Tree is resolved once that Proposal is accepted. A re-run leaves out every key already there (unless its Proposal was rejected), refers to imported records by their ids with their current versions, and submits only the rest. As built, a note changed since its import is listed in the report under "Changed notes" and its new facts come in as new keys; `setField` updates of changed values were not built, as the Vault is frozen after import day.

What is left of a Proposal after the imported keys are dropped is submitted when it changes or attaches anything; a lone `createCitation`, attached to nothing, is not. So a Citation attached to an Event already in the Tree comes in on its own. That is how the register Citations (#133) reach a Tree imported before them: the Owner had accepted the first batch and was accepting the second when the bug was found. On the next run each Person note with such a fact gives one Proposal that creates the register Citation and attaches it to the imported Event by its record id from the id map, at the Event's current version. The Vault provenance Citation that Event already has stays, as a re-run removes nothing, and a fresh import attaches both, so either way the Tree ends up the same. An Event whose Proposal is still pending holds its register Citation back until that Proposal is accepted, like any reference to an earlier batch.

A presumed death (#132) has keys of its own (`event:<id>:presumed-death`), so a later run adds it to a Person imported before, in that Person's Proposal. The run reads each such Person first. If the Tree no longer treats them as Living, because the Owner has added a death, burial or birth date since, it leaves the Event out with its Role and Citation, and the report lists them.

An importer before #134 wrote research notes from the body alone, and none for a note without a body, so the Owner's Tree lacks those lines. A later run never writes the research notes of a record an earlier run imported as part of a note's Proposal. Instead, for each record that lacks the lines, it reads the record. If its notes still hold exactly what the earlier run wrote, it submits a Proposal of one `setNotes`, with the version it read, so a change made after the run is a conflict at review. Notes changed in the app since are left alone, and the report lists their lines for the Owner. Each update is recorded in the id map under a key of its own (`vault-fields:<record>`), so a run while it is pending submits nothing twice. A register entry's Citation note can't be completed this way: the evidence rule counts a `setField` of a Citation as a change of facts that needs a Citation of its own, which the importer does not have. Those lines stay in the report until the Owner decides #157.

A marriage both spouses record without a Source note (#149) came in as two Events before the fix, one in each spouse's Proposal. On the next run, the second note's Proposal attaches its Citations to the first Event by its record id, as new keys, and creates no Event. The report lists each such pair under "Marriage Events imported twice", with the record ids of the Event to keep and of the other one. No operation removes or merges an Event (`mergePersons` merges Persons; `restoreRecord` is an undo's), so the other Event stays until the Tree can merge Events (#154). It does no harm meanwhile: a partner link's Citations are those of every Event where both are partners.

### Research leads after acceptance
The leads of `plans/` and `log/` link Persons, Places and registers that exist only once the batch is accepted, and leads are written directly, not proposed. So the importer creates them on the run after acceptance; until then the report counts them as waiting.

A lead's reason holds the whole note (#136): up to 20,000 characters, like a Citation's transcription, which the longest log and plan notes in the Vault fit. An importer before #136 kept the first 4,000. On a later run, a lead that still holds exactly those gets the whole note, written with the version the importer read (leads are written at once, and the lead's history shows the change). A lead changed in the app since is left as it is, and the report lists it. The lead screen keeps a reason's line breaks.

### Import batches have their own limit
An Agent may submit 60 Proposals and make 1,000 other requests an hour. The Vault holds about 4,700 Proposals and 400 files, so an Agent's requests to its Import batches (opening one, submitting into it, its uploads and the id map) count against a window of their own of 10,000 an hour (agent-access requirement "Import batches have their own limit"). Only its author adds to a batch, and nothing changes in the Tree before review.

### Files
JPG, PNG and WebP scans go through the normal upload path. PDF documents use a new upload kind. DOC files are converted to PDF once with LibreOffice (`soffice --headless --convert-to pdf`) on the Owner's machine during import, and the original is uploaded as well. If LibreOffice is missing, the DOC is reported and skipped.

### Batch acceptance
`POST /api/batches/:id/accept` is Owner-only. It runs each Proposal in its own transaction, in batch order, and continues past failures. It returns accepted, failed and blocked lists. The review screen shows batch progress and a random sample of 20 pending Proposals.

## Risks / Trade-offs

- [Vault data quality: broken links, odd dates, duplicate Persons] → the dry run lists them all; the Owner fixes the Vault before the real run, or after import through review and merging.
- [Bulk acceptance hides mistakes] → batch acceptance is Owner-only; sampling is built in; every Proposal stays undoable, and undo refuses when later work depends on it.
- [Computed relation differs from the Vault's tags] → the dry run lists every difference so the Owner can check Family roots and link confidences first.
- [Living people in the Vault's family document] → they enter the private Tree like anyone else and are reduced in every Export; the importer never writes outside the API.

## Migration Plan

1. Finish and merge this change. Mark Family roots on the empty Tree (the Owner).
2. Dry run against the real Vault in a private session; fix reported problems in the Vault.
3. Real run: one Import batch. The Owner samples it, then accepts it.
4. Freeze the Vault: a final commit with a README note, branch protection or the repo archived on GitHub, and agents told to use the API.
5. A re-run later, if needed, submits only what changed.

## Open Questions

- The 334 Persons tagged `mozny-pribuzny` by surname only will mostly come out as Unrelated, because a shared surname isn't a link. The dry run shows the list; if the Owner wants them kept visible, a Label can mark them. This changes data only.
