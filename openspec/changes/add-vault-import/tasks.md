# Tasks

Tasks 1.3, 1.4 and 1.5 were built under #15 (add-family-view's Family roots, Family-root fallback and Possible relatives needed them), ahead of the rest of this change; the importer stays with #17.

## 0. Names with language tags

The Owner's decision on #64: a Name carries a BCP 47 language tag instead of one type per language. Built before the importer, which tags the Vault's name variants.

- [x] 0.1 Plan the requirement "Names carry a language tag" in `specs/tree-model/spec.md`; verify `openspec validate add-vault-import --strict`
- [x] 0.2 Migrate the Names: `latin` becomes type `other` with `la`, `german` type `other` with `de`, every other Name keeps its type without a tag; the stored Proposal operations follow, and an undo of an older Proposal restores the new form; verify the names-recorded-before scenario with a migration test
  - Note: migration `0010_name_languages` adds `name.language` (checked against the BCP 47 shape, the same pattern as `LANGUAGE_TAG_PATTERN` in `shared/src/schemas/common.ts`), converts the rows without bumping their versions, and rewrites `proposal_operation` (author's and corrected operations). The log stays append-only; `legacyName` (`server/src/proposals/records.ts`) converts an old Name snapshot when an undo writes it back. Verified in `server/test/name-languages.test.ts` ("Names recorded before the tags", on a database migrated to 0009 first) and by the rollback test in `server/test/migrations.test.ts`.
- [x] 0.3 Carry the tag through the Zod schemas, the Proposal operations and their sentences, the app's Name form and person page, search, the MCP tools, the OpenAPI description and the fixture Tree; verify the Latin-form, Polish-form, language-not-known and not-a-tag scenarios
  - Note: `LanguageTag` in the schemas; `NameType` is birth, married, nickname or other; `createPerson`, `addName` and `setField` of a Name take `language` (null when not known). Sentences say the language in words ("other form, Latin"). The app's Name form offers the type and a language (Latin, German, Czech, Polish, Slovak, Russian or not known), turns an older Draft's `latin`/`german` into the new form, and the person page shows both. Search is unchanged: every Name's spelling is folded the same way whatever its language. The MCP instructions explain the tag. Verified in `server/test/name-languages.test.ts`, `shared/test/schemas.test.ts`, `app/tests/unit/proposal-contract.test.mjs` and `app/tests/e2e/family-people.spec.js`.

## 1. Model additions

- [ ] 1.1 Add research notes to every Tree record and a `setNotes` operation; verify the open-question scenario and that notes appear in history
- [ ] 1.2 Add Labels on Persons (operations, search filter ignoring case and diacritics); verify the family-line and two-Labels scenarios
- [x] 1.3 Add Family roots (Owner only) and the relation rule as a pure function in `shared/`; verify the confirmed-marriage, weak-link and godparent scenarios as unit tests
  - Note: built under #15. Family roots are `family_root` records (migration `0008_family_relation`), marked and unmarked only by the Owner: the action `markFamilyRoots` in `mayDo`, `PUT /api/persons/:id/family-root`, logged as the Owner's direct change with the server-only operation `setFamilyRoot` (fact-free), so the Person's history shows it, only the Owner can undo it, and a merge keeps the root on the kept Person. `GET /api/family-roots` and `me.familyRoots` list them. The rule is `relationLevels` in `shared/src/relation.ts` with the shell `relationsOf`. Verified in `shared/test/relation.test.ts` (confirmed marriage, weak link, link without Citation, godparent, evidence improves, cycles, several roots, no roots) and `server/test/relation.test.ts` (the same scenarios through Proposals, the Owner-only route and undo, the log entry, and the stored relations against the rule applied to the fixture model).
- [x] 1.4 Store `person.relation`, recompute it after each accepted Proposal and once after a batch, and add the relation filter to search and map Events; verify the family-only and everyone-in-a-village scenarios
  - Note: built under #15. `person.relation` is recomputed in the transaction of every accepted change that touches a Person, Family, child link, Event, Role, Citation or Family root: accepted Proposals, direct changes, merges, undos and Family roots all go through `acceptInTransaction` (`server/src/tree/relation.ts`, serialised by an advisory lock). It is derived, so it bumps no version (`rdk_bump_person_version`) and stays out of the log's snapshots and undo. There is no batch path yet: batch acceptance (task 2.3) calls `recomputeRelations` once at the end. `GET /api/persons` and `GET /api/map/events` take `relation=relative,possible` (any combination); every Person states its relation, and the hourglass marks weak links. Family-only and everyone-in-a-village verified in `server/test/relation.test.ts`; the MCP tool `search_persons` takes the filter too.
- [x] 1.5 Prove the relation rule with `lsc check` and add its `//@ contract tree-model: Relation to the family is computed`; verify `lsc check` passes and `docs/verification.md` lists it
  - Note: built under #15. `relationLevels` carries the contracts "Relation to the family is computed" and "Relation follows the evidence", with the scenarios as ensures; the full search is proved, including termination, closure and a certificate of how each Person was reached, plus the lemmas `ReachedIsLeast` and `EvidenceOnlyAdds` in `shared/proofs/src/relation.dfy`. `pnpm verify` passes and `docs/verification.md` lists it, with its exact scope (what is and is not proved). Mutations checked: treating low confidence as confirming fails `isConfirming` and the weak-link ensures of `relationLevels`; letting the Relatives' search follow weak links fails its certificate.
- [ ] 1.6 Add PDF documents on Sources (upload kind, 50 MB limit, expiring links, never exported); verify the family-chronicle and not-a-PDF scenarios
- [ ] 1.7 Add Proposal operations for Places with their names, Houses with their numbers, Parishes, Estates and the periods that link them to Places, so that the importer can submit them first, as the vault-import spec asks; verify a Place Proposal is accepted, shown and undone like any other

## 2. Batches in review

- [ ] 2.1 Add Import batches and batch references between Proposals of one batch; verify the out-of-order scenario
- [ ] 2.2 Mark dependents blocked when a batch Proposal is rejected; verify the rejected-foundation scenario
- [ ] 2.3 Add Owner-only batch acceptance in batch order, continuing past failures; verify the 500-with-one-conflict scenario and that an Editor is refused
- [ ] 2.4 Add the batch entry, progress and random sample to the review screen; verify the spot-checking scenario at a 390 px viewport

## 3. Importer

- [ ] 3.1 Create an invented fixture Vault in `server/test/fixtures/vault/` covering every note type including `plans/` and `log/`, a broken link, a bad date, an unknown folder, scans, a PDF and a DOC; verify the fixture contains no real names by the repo guard
- [ ] 3.2 Write the reader (frontmatter, `[[links]]`, EDTF check, unknown folders); verify the unknown-folder and broken-link scenarios
- [ ] 3.3 Write the mapper per the design table, including the Vault provenance Source, confidence carry-over and tag rules; verify the baptism-entry, fact-from-body, probable-Person, line-tag and transcription scenarios
- [ ] 3.3a Map `plans/` to open Research leads and `log/` searches to search records; verify the negative-search-in-a-log scenario
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
