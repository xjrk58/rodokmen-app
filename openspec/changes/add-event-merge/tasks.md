# Tasks

## 1. The rules (shared)

- [x] 1.1 Write `shared/src/event-merge.ts`: `mergeEventFacts` (agreement on type, type detail, date, Place or House, principal Roles and text lengths; what the kept Event holds) and `mergeOffer` (the pair the person page offers, and which Event to keep). Prove both with `lsc check`: ensures stating the scenarios "Marriage recorded twice", "Gaps are filled", "Notes of both", "Different dates", "Two different children" and "Another partner", and that a merge without conflicts loses no fact of the merged Event; `//@ contract` lines for `review: Merging duplicate Events`, `review: A merged Event fills the gaps of the kept one`, `review: Merging Events refuses disagreeing facts` and `family-view: Merge duplicate Events from the person page`; add the file to `shared/LemmaScript-files.txt`. Verify with `pnpm verify`, `pnpm verify:trace`, unit tests in `shared/test/event-merge.test.ts`, and a deliberate bug (filling the date even when both differ) that makes `lsc check` fail
- [x] 1.2 In `shared/src/rules.ts`: make `mergeEvents` fact-free in `isFactFreeOperation`, with the scenario "An Event merge needs no Citation" as an ensures of `satisfiesEvidenceRule`; add the proved `mayUseOperation(editor, op)` (only Editors use `mergePersons` and `mergeEvents`) with contracts `review: Contributors never accept or merge` and `review: Merging duplicate Events`. Verify with `pnpm verify`, `pnpm verify:trace`, `shared/test/rules.test.ts`, and a deliberate bug (letting a Contributor use `mergeEvents`) that makes `lsc check` fail
- [x] 1.3 Add the `mergeEvents` operation to `shared/src/schemas/proposals.ts` (Editor-only, `keepId ≠ mergeId`), use `mayUseOperation` in `checkOne` with a message naming the operation, add `mergeableEvents` to `PersonDetail`, and the sentence in `proposal-summaries.ts` in Czech and English. Verify with `shared/test/proposals.test.ts` (Editor accepted without a Citation, Contributor and Agent refused) and the summaries test

## 2. Applying, undo and the API (server)

- [x] 2.1 Apply `mergeEvents` in `server/src/proposals/apply.ts` in the order of design decision 4 (base versions, `mergeEventFacts`, Roles, Citation links, kept fields, delete), refusing with 409 `merge_conflict` and the facts; wire `targetColumns`, `targetsOf` and `resolved` (conflicts) like `mergePersons`; add `mergeEvents` to `service.ts` and the route `POST /api/events/{id}/merge` (`action: 'merge'`). Verify with a new `server/test/event-merge.test.ts`: the marriage recorded twice (all twins), Citations and Roles that move, gaps filled, joined notes and description, each refusal (type, date, Place, two children, three partners, text too long, a stale base version), 403 for a Contributor and an Agent, and 404 for an unknown Event
- [x] 2.2 Undo: verify in `server/test/event-merge.test.ts` that undoing the merge brings both Events back with their own Roles, Citations and fields, that the history of the kept Event, the merged Event and a partner shows the merge and the undo, and that the relation to the family is recomputed
- [x] 2.3 The redirect: `GET /api/events/{id}` answers 308 to the remaining Event of a merge (following later merges), 404 after an undo of a creation, and the Event itself after the merge is undone; an operation on a merged Event fails with 409 `event_merged`. Verify in `server/test/event-merge.test.ts`
- [x] 2.4 `mergeableEvents` in `getPerson` from `mergeOffer`. Verify in `server/test/event-merge.test.ts`: the pair offered with the Event that has more Citations to keep, no offer for two residences of different years, and none once merged
- [x] 2.5 Regenerate `server/openapi.json` and the reference docs. Verify with `pnpm --filter @rodokmen/server openapi:check` and `server/test/openapi.test.ts`

## 3. MCP

- [x] 3.1 Say in the `get_record` description and the instructions that a merged Event answers with the kept one, and that Agents report a duplicate in a Research lead instead of proposing it again. Verify with a test in `server/test/agents.test.ts` that an Agent's `mergeEvents` is refused with 403, and with the MCP tools test

## 4. App

- [x] 4.1 The offer on the person page for Editors (`app/src/person-screen.js`) and the side-by-side panel in a new `app/src/event-merge.js` (both Events from `GET /api/events/{id}`, the choice of the Event to keep, a note, the merge, the refusal by code in the Member's language), `mergeEvents` and `getEvent` in `app/src/api.js`, the module in `precache.js`, the texts in `app/i18n/cs.json` and `en.json`. Verify with the app's unit tests (i18n, precache) and typecheck
- [x] 4.2 Playwright against the real server, at phone and desktop size: an Editor merges a marriage recorded twice from the person page and sees one marriage with both Citations; a Contributor sees no offer; the merge is undone from the history. Verify with a new `server/test/event-merge.e2e.test.ts`, run with at most two workers

## 5. The importer's report and the 25 pairs

- [x] 5.1 In `server/src/vault-import/run.ts` and `report.ts`: read the other Event of each pair; list a pair still to merge with the Event to keep and a spouse's person page address, flag a pair merged the other way, and leave out one merged into the Event to keep. Verify with `server/test/vault-import-rerun-followups.test.ts` (listed, merged, merged the other way), and locally against the Owner's import copy with the stub tools in `~/rodokmen-import-tools/`, output to `~/rodokmen-import-tools/out/` only, counts in the PR
- [x] 5.2 Update the scenario "Marriage imported twice" of `add-vault-import` to point to this change. Verify with `openspec validate add-vault-import --strict`

## 6. Docs

- [x] 6.1 Reference: `docs/reference/api.md` (the merge route, the 308, `mergeableEvents`), `docs/reference/mcp-tools.md` (`get_record`, merges are Editors'), `docs/reference/roles-and-actions.md` (merging Events). How-to: `docs/how-to/import-the-vault.md` (merge the pairs from the report, keeping the suggested Event). Explanation: `docs/explanation/proposals-and-review.md` (merges change no facts; why the merged Event is deleted). `README.md` (what works). No new page, so no index line. Verify with `pnpm lint:docs`

## 7. Everything together

- [ ] 7.1 Run `pnpm check` and `pnpm verify`, the server tests touched and the app's unit tests; verify they pass, and that CI is green on the PR
