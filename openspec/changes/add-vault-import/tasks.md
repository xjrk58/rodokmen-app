# Tasks

## 1. Model additions

- [ ] 1.1 Add research notes to every Tree record and a `setNotes` operation; verify the open-question scenario and that notes appear in history
- [ ] 1.2 Add Labels on Persons (operations, search filter ignoring case and diacritics); verify the family-line and two-Labels scenarios
- [ ] 1.3 Add Family roots (Owner only) and the relation rule as a pure function in `shared/`; verify the confirmed-marriage, weak-link and godparent scenarios as unit tests
- [ ] 1.4 Store `person.relation`, recompute it after each accepted Proposal and once after a batch, and add the relation filter to search and map Events; verify the family-only and everyone-in-a-village scenarios
- [ ] 1.5 Prove the relation rule with `lsc check` and add its `//@ contract tree-model: Relation to the family is computed`; verify `lsc check` passes and `docs/verification.md` lists it
- [ ] 1.6 Add PDF documents on Sources (upload kind, 50 MB limit, expiring links, never exported); verify the family-chronicle and not-a-PDF scenarios

## 2. Batches in review

- [ ] 2.1 Add Import batches and batch references between Proposals of one batch; verify the out-of-order scenario
- [ ] 2.2 Mark dependents blocked when a batch Proposal is rejected; verify the rejected-foundation scenario
- [ ] 2.3 Add Owner-only batch acceptance in batch order, continuing past failures; verify the 500-with-one-conflict scenario and that an Editor is refused
- [ ] 2.4 Add the batch entry, progress and random sample to the review screen; verify the spot-checking scenario at a 390 px viewport

## 3. Importer

- [ ] 3.1 Create an invented fixture Vault in `server/test/fixtures/vault/` covering every note type, a broken link, a bad date, an unknown folder, scans, a PDF and a DOC; verify the fixture contains no real names by the repo guard
- [ ] 3.2 Write the reader (frontmatter, `[[links]]`, EDTF check, unknown folders); verify the unknown-folder and broken-link scenarios
- [ ] 3.3 Write the mapper per the design table, including the Vault provenance Source, confidence carry-over and tag rules; verify the baptism-entry, fact-from-body, probable-Person, line-tag and transcription scenarios
- [ ] 3.4 Write the dry run report (counts, planned Proposals, unmapped fields, broken links, bad dates, unreadable files, Living and relation differences); verify the nothing-submitted and Vault-says-Living scenarios
- [ ] 3.5 Write the submitter: Agent token, uploads, DOC to PDF with LibreOffice, one Import batch per run; verify the family-document and batch-in-the-queue scenarios against a test server
- [ ] 3.6 Keep the id map with note hashes and submit only new or changed notes on a re-run; verify the second-run scenario
- [ ] 3.7 Document the import procedure in `server/src/vault-import/README.md`; verify a fresh run of the fixture Vault following only the README works

## 4. Import day

- [ ] 4.1 Owner marks Family roots, then runs the dry run on the real Vault in a private session; verify the report has no unmapped fields left that the Owner hasn't accepted
- [ ] 4.2 Owner runs the real import, samples and accepts the batch; verify Tree counts match the dry run and the log names the importing Agent
- [ ] 4.3 Freeze the Vault: final README note, GitHub archive or branch protection, and agents pointed to the API and MCP; verify a push to `rodokmen-data` is refused

## Workflow follow-up

- Archive this change after import day so its specs move to `openspec/specs/`.
