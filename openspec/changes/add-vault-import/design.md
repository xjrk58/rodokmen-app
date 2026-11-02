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
- **Keys.** Every record gets a stable key from the Vault (`person:<id>`, `event:<id>:baptism`, `family:<a>+<b>`, `citation:<source note>` …). A Family is created once per pair; a marriage both spouses record is one Event.
- **Places.** A Place links to the Municipality of the same name in its `district` (the app's municipality list); a Place without a point of its own takes the Municipality's point when it is the Municipality's namesake. `names.de`/`la`/`old` become Place names; other languages are reported.
- **Parishes.** The Vault puts baptisms and marriages at their Parish (`place: [[parish]]`): such an Event is at the Parish's seat. A seat named in the Parish note but without a Place note becomes a Place created from that name, and the report says so.
- **Registers.** Title from kinds, Places and years; `archive`, `signature` and `url` become archive, call number and link; N, O and Z become the coverage's kinds (I, an index, none) and `years` its years. The Places a register's `places` names belong to its Parish in its years.
- **Entries.** A register entry's Citation has the note's body as transcription, its `page` (else `frame`) as page, `accessed` as read-on day, and the note path and scan link in its note. A Citation has no research notes; Source notes outside the registers (family documents and memories, gravestones, web) become Sources of their own whose research notes and Citation transcription both hold the body.
- **Persons.** `birth_surname` makes the primary Name a married name with a birth Name beside it; parents' Roles go on the birth or baptism Event the child cites, so that the parent link carries its Citation (#17). Residences become residence Events at their House or Place with their period. A date that is not EDTF is left out of the Event and kept in its description.
- **Logs.** A search is a bullet under a heading saying found (`… a nalezeno`) or not found (`… bez výsledku`); its register is the one the bullet links (or the register of a linked entry); its years and pages are taken when written as `1784–1820` and `s. 1–60`. Nothing else is read into the prose.

### Proposal order and batch-scoped references
The importer topologically orders its Proposals. Places, Houses, Parishes and registers come first. Then Source notes, in date order, so a Person is created by the earliest entry that names them. Then one Proposal per Person for facts no Source note covers. A Proposal may reference a record created earlier in the batch by a batch reference, written `batch:<proposal id>/tmp:x` wherever an operation refers to a record. The server stores the dependency and resolves the reference when the earlier Proposal is accepted (`proposal_temp` keeps the temporary ids of every accepted batch Proposal). That only works if acceptance follows dependency order, so the review rule enforces it. Waves that wait for acceptance were considered; they would make the Owner run the importer five times.

### Vault provenance Source
Each run creates, or reuses, one Family account Source named "Vault (rodokmen-data)", given by the Owner and dated with the Vault's commit. A fact without its own Source note cites it with the note path as page and low confidence. That way the evidence rule holds and every fact says where it came from.

### Relation to the family
The relation is computed on the server after each accepted Proposal. The confidence threshold uses the best Citation on each link. The result is stored in `person.relation` so search and map filters stay cheap. Bulk acceptance recomputes once at the end, not per Proposal. The rule itself is a pure function in `shared/` (relation from a graph, Family roots and link confidences), so it can be proved with LemmaScript (ADR 0009).

As built under #15 (tasks 1.3–1.5): the server runs the proved rule itself over every Family link, not a recursive CTE, so one definition decides. Family links are a Family's two partners, and each partner with each child of the Family. Citations hang on Events, so a link's Citations are those of the Events that record it: for a partner link, Events where both have the Role partner (the marriage); for a parent link, Events where the child has the Role child and the parent father or mother (the baptism or birth). A link without such a Citation is weak. Family roots are `family_root` records the Owner marks through their own route, logged as the Owner's direct change, so they have history and undo like any change and a merge keeps them. The relation is derived: it bumps no version and stays out of the log.

### Id map and re-runs
`vault_import_map(key, kind, note_hash, batch_id, proposal_id, temp_id, record_id)` is kept on the server and read and written by the importer through the API (`GET`/`PUT /api/import-map`). It holds every key the importer submitted, with the Proposal and temporary id that create it; the record in the Tree is resolved once that Proposal is accepted. A re-run leaves out every key already there (unless its Proposal was rejected), refers to imported records by their ids with their current versions, and submits only the rest. As built, a note changed since its import is listed in the report under "Changed notes" and its new facts come in as new keys; `setField` updates of changed values were not built, as the Vault is frozen after import day.

### Research leads after acceptance
The leads of `plans/` and `log/` link Persons, Places and registers that exist only once the batch is accepted, and leads are written directly, not proposed. So the importer creates them on the run after acceptance; until then the report counts them as waiting.

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
