# Design

## Context

`add-tree-backend` provides the schema with a `version` on every record, the read API, accounts and object storage. This change adds the only write path into the Tree (ADR 0001), the log (ADR 0006) and offline Drafts (ADR 0003).

## Goals / Non-Goals

**Goals:**
- One write path for every actor: Contributors, Editors and, later, Agents.
- Review that works one-handed on a phone.

**Non-Goals:**
- No real-time collaboration and no offline merging.
- No automatic duplicate detection beyond showing likely matches to the Editor.

## Decisions

### A Proposal is a list of typed operations
A Proposal holds an ordered list of operations from a closed set defined in `shared/`, such as `createPerson`, `addName`, `createEvent`, `addRole`, `linkChild`, `setField`, `attachCitation` and `mergePersons`. Each operation names its target record and the base version, and records created in the same Proposal are referenced by temporary ids. Free-form JSON Patch was considered and rejected: typed operations can be validated, shown as readable sentences in review ("adds godparent Anna Králová"), and inverted for undo.

### Applying is one transaction
Accepting runs every operation in one database transaction. It checks base versions, bumps record versions, writes the before and after snapshot of every touched record into the log, and marks the Proposal accepted. Any failure rolls back everything, so a Proposal is never half-applied.

### Editors' direct changes are auto-accepted Proposals
An Editor's direct change is a Proposal created and accepted in one call. History, undo and the log then need no second path.

### Conflicts
A conflict is an operation whose base version differs from the current version. The review screen shows the fields the operation sets next to their current values, and the Editor's choice per field is stored as an Editor correction on the Proposal.

### Merge
`mergePersons` moves every Name, Role, Family link and Citation from the merged Person to the kept one, then marks the merged Person as merged into the kept one rather than deleting it. Old links and search then redirect, and undo can restore it.

### Undo
Undo builds the inverse operations from the logged before-snapshots and applies them as a new, auto-accepted Proposal. Fields changed since then are shown to the Editor first, as in conflict review.

### Drafts on the device
Drafts live in IndexedDB together with their photos as blobs. The app shows a storage estimate and warns before the browser's quota is reached. On submit, the photos upload first (each to a presigned URL in a `pending/` prefix of the bucket), and then the Proposal is created. An interrupted submit can be retried without duplicates thanks to an idempotency key per Draft.

### Images
The server makes a 2,000-pixel WebP display copy with `sharp` and keeps the original. HEIC is converted on upload, and if conversion fails the upload is refused with a clear message. Accepting a Proposal moves its images from `pending/` to their final prefix. A daily job deletes images of rejected Proposals after 30 days.

### Notifications
A daily job at 18:00 Prague time sends the Editor digests. Outcome emails are sent when the decision is made. Both use the email service from `add-tree-backend`.

## Risks / Trade-offs

- [Browsers may evict IndexedDB on low storage] → the app requests persistent storage, warns about unsubmitted Drafts older than 7 days, and keeps Drafts small by compressing photos to their display size plus the original.
- [Review fatigue for a single Editor] → the digest groups by author, and accepting needs one tap once the changes are read.
- [The operation set grows over time] → operations are versioned in `shared/`, and an unknown operation is rejected rather than guessed.

## Open Questions

None that change the specs.
