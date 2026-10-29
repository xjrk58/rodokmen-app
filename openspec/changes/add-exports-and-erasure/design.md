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

## Risks / Trade-offs

- [Erasure removes evidence other people relied on] → only Living people can be erased, and the confirmation lists which Events will disappear.
- [GitHub keeps unreachable commits for a while] → documented. GitHub support can purge cached views if a relative asks.
- [Backups keep erased data for up to 12 months] → the erasure list is reapplied on any restore, and Backups age out.

## Open Questions

None that change the specs.
