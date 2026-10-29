# Proposal

## Why

Most of the family research so far lives in the Owner's Vault: about 4,100 Persons, 414 register entries with their scans, Houses, Places and Parishes, kept as Markdown notes in the private `rodokmen-data` repo. The Tree starts empty. Retyping the Vault is impossible, and letting an AI re-read it would invent things. A deterministic importer brings it in once, through the same review as everything else (ADR 0001, ADR 0010).

## What Changes

- A Vault importer: a command the Owner runs. It reads the Vault, maps it to typed Proposal operations, and submits them as one Import batch with an Agent token.
- A dry run first: a report of what would be imported and what can't be mapped, without submitting anything.
- One Proposal per Source note, plus Proposals for the Places, Houses, Parishes and registers they refer to. Proposals in an Import batch may refer to records created by earlier Proposals of the same batch.
- The Owner can accept a whole Import batch at once after spot-checking it.
- The importer keeps a map from Vault ids to Tree ids, so a second run submits only what is new.
- Scans become Citation images. PDF family documents become documents on their Source; a DOC is converted to PDF once.
- New in the Tree:
  - research notes on records, taken from note bodies
  - Labels on Persons, from the Vault's tags that can't be derived
  - Family roots, and a computed relation to the family (Relative, Possible relative, Unrelated person), replacing the Vault's `nepribuzny` / `mozny-pribuzny` tags
  - search and the map can leave Unrelated people out
- After import day, the Vault becomes a read-only archive, and Agents contribute through the API.
- The Vault's `plans/` become open Research leads, and its `log/` searches become search records.

Out of scope: syncing in both directions; importing from other genealogy programs (GEDCOM import is a later change); any AI interpretation of prose during import.

## Capabilities

### New Capabilities
- `vault-import`: reading the Vault, the dry run, mapping, submitting Import batches and re-runs.

### Modified Capabilities
- `tree-model`: research notes on records, Labels, Family roots, and the computed relation to the family.
- `tree-read-api`: filtering search and map Events by relation to the family.
- `review`: accepting a whole Import batch, and the order of Proposals within a batch.
- `evidence-media`: PDF documents on Sources.

These capabilities come from `add-tree-backend` and `add-proposals-and-review`, which are not archived yet. Their requirements here are added ones.

## Impact

- New command in `server/` (`vault-import`), a client of the public API, plus an invented fixture Vault for tests. The real Vault never enters this repo.
- Schema additions: notes columns, a Person label table, a Family root flag, a stored relation status recomputed after each accepted Proposal, Import batch and batch order on Proposals, and Source documents.
- Review queue screen: batch view and "Accept batch".
- Depends on `add-agent-access` (Agent tokens) and `add-research-leads` (for `plans/` and `log/`). `add-family-view` hides Unrelated people by default.
- `rodokmen-data` becomes read-only, and the Export target moves to `rodokmen-export` (ADR 0010).
