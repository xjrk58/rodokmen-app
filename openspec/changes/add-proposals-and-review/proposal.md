# Proposal

## Why

The Tree can be read but not changed. Members and Agents need to add findings, and Editors need to check them before anyone else sees them (ADR 0001), with a history that can be undone (ADR 0006). Without this, the family has nothing to contribute to.

## What Changes

- Proposals: one finding with all its changes, always with evidence, submitted from the app.
- Drafts written offline and submitted later (ADR 0003).
- A review queue in the app: Editors accept or reject a whole Proposal, correct it first, resolve conflicts, and merge duplicate Persons.
- An append-only log of every accepted change, a history view per record, and undo of a whole Proposal.
- Email notifications: a daily digest for Editors, and the outcome for Contributors.
- Image upload: page images and Members' own photos on Citations, and portraits on Persons (ADR 0002).

Out of scope: Agent accounts and the MCP server (`add-agent-access`); reading screens such as the person page and pedigree (`add-family-view`); erasure (`add-exports-and-erasure`); bulk GEDCOM import.

## Capabilities

### New Capabilities
- `proposals`: creating, drafting and submitting Proposals.
- `review`: how Editors decide on Proposals, including conflicts and merging duplicates.
- `tree-history`: the log of accepted changes, record history, and undo.
- `notifications`: emails about Proposals.
- `evidence-media`: uploading and viewing page images, photos and portraits.

### Modified Capabilities

## Impact

- New server routes for Proposals, review, history and uploads; new tables for Proposals, their changes and the log.
- New app screens: the Proposal forms, the Drafts list and the review queue, all phone-first.
- Image processing on the server (resizing for display, keeping originals) and a daily scheduled job for the digest.
- Depends on `add-tree-backend`.
