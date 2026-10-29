# Proposal

## Why

The family's work must never be locked into one server. A readable copy of the Tree should live outside it (ADR 0008), and GEDCOM should be available for other genealogy programs. Living relatives must also be protected in every copy, and be able to leave the Tree completely if they ask (ADR 0006, the erasure exception).

## What Changes

- A nightly one-way Export to the private `rodokmen-data` repo: one Markdown note per record plus a GEDCOM file, never images.
- The same Living-people reduction in every Export: name, sex, relationships and birth year only.
- An on-demand GEDCOM download for the Owner with the same reduction.
- Erasure: the Owner removes a Living person from the Tree, the log, future Exports and the Export history, and Backup restores keep them erased.

Out of scope: GEDCOM import (a later change); Exports for anyone other than the Owner; any Export containing images.

## Capabilities

### New Capabilities
- `exports`: Export formats, schedule, destination and the Living-people reduction.
- `erasure`: removing a Living person completely at their request.

### Modified Capabilities

## Impact

- New scheduled job on the server with write access to the private `rodokmen-data` repo (a deploy key limited to that repo).
- A GEDCOM 5.5.1 writer and a Markdown writer in `server/`.
- Changes to the log, which may be rewritten for erasure only, and to Backup restore, which reapplies erasures.
- Depends on `add-tree-backend` and `add-proposals-and-review`.
