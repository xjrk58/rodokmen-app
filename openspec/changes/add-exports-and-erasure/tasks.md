# Tasks

## 1. Reduction

- [ ] 1.1 Write the Living-person reduction in `shared/`; verify with a fixture that only name, sex, relationships and birth year survive

## 2. Writers

- [ ] 2.1 Write the Markdown Export (layout, frontmatter, stable slugs, `[[links]]`); verify a fixture Export opens in Obsidian with working links and that slugs stay stable after a Name correction
- [ ] 2.2 Write the GEDCOM 5.5.1 writer using the same reduction; verify the living-grandchild scenario and that the file passes a GEDCOM validator and imports into Gramps
- [ ] 2.3 Verify that neither writer emits images or image links, with a test over a fixture holding page images

## 3. Nightly Export and download

- [ ] 3.1 Schedule the nightly Export with a deploy key limited to `rodokmen-export`, committing only on change; verify the quiet-night and busy-night scenarios
- [ ] 3.2 Add the Owner's GEDCOM download; verify that only the Owner can call it and the file matches the nightly one

## 4. Erasure

- [ ] 4.1 Implement erasure (Living only, named confirmation, dependent rows, orphaned Events, log markers, erasures table) in one transaction; verify the cousin, not-Living and history-after-erasure scenarios
- [ ] 4.2 After an erasure, replace the `rodokmen-export` branch with a single orphan commit; verify the export-history scenario on a test repo
- [ ] 4.3 Reapply the erasures table during restore, before the API starts; verify the restore-from-old-Backup scenario in the monthly restore job

## Workflow follow-up

- Archive this change after it ships so its specs move to `openspec/specs/`.
