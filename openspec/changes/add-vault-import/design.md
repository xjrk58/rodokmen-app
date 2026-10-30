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
| `people/<id>` name, variants, sex | Person, primary Name, one Name per variant (type from the spelling: Latin, German or other) |
| birth, baptism, death, burial, marriages, residences | Events with Roles (child, father and mother from `father`/`mother`; partners from `marriages`) |
| `father` / `mother` | child link to a Family, the birth Family of that pair, created once per pair |
| `confidence` | confidence of the Citations that Person's facts cite (lowest wins when Persons disagree) |
| `tags` | Labels, except `obec/…`, `nepribuzny`, `mozny-pribuzny`, `import/…` |
| body | research notes; for Source notes also the transcription |
| `living`, `aliases` | not imported (Living is computed); aliases go into the id map |
| `plans/<id>` | open Research lead with the note's text and links |
| `log/<id>` searches | search records on Research leads (found or not found) |

### Proposal order and batch-scoped references
The importer topologically orders its Proposals. Places, Houses, Parishes and registers come first. Then Source notes, in date order, so a Person is created by the earliest entry that names them. Then one Proposal per Person for facts no Source note covers. A Proposal may reference a record created earlier in the batch by a batch reference `{batch, proposal, tempId}`. The server stores the dependency and resolves the reference when the earlier Proposal is accepted. That only works if acceptance follows dependency order, so the review rule enforces it. Waves that wait for acceptance were considered; they would make the Owner run the importer five times.

### Vault provenance Source
Each run creates, or reuses, one Family account Source named "Vault (rodokmen-data)", given by the Owner and dated with the Vault's commit. A fact without its own Source note cites it with the note path as page and low confidence. That way the evidence rule holds and every fact says where it came from.

### Relation to the family
The relation is computed on the server after each accepted Proposal (a recursive CTE from the Family roots over Family links). The confidence threshold uses the best Citation on each link. The result is stored in `person.relation` so search and map filters stay cheap. Bulk acceptance recomputes once at the end, not per Proposal. The rule itself is a pure function in `shared/` (relation from a graph, Family roots and link confidences), so it can be proved with LemmaScript (ADR 0009).

### Id map and re-runs
`vault_import_map(vault_id, record_kind, tree_id, note_hash, batch_id)` is kept on the server and read by the importer through the API. A note whose hash is unchanged is skipped. A changed note becomes a Proposal of `setField` operations against the current Tree version, so ordinary conflict review covers edits made in the Tree since then.

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
