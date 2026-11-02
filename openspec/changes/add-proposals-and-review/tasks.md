# Tasks

## 1. Operations and Proposals

- [x] 1.1 Define the typed operations in `shared/` with validation and human-readable summaries in Czech and English; verify each operation's summary in a snapshot test
  - Note: `shared/src/schemas/proposals.ts` (closed set, `OPERATIONS_VERSION` 1, `checkOperations`, `describeOperations`); snapshot in `shared/test/__snapshots__/operation-summaries.txt`. Czech sentences use the "verb: object" form so names need no declension. `restoreRecord` is the server's own operation (undo) and is refused from Members; `mergePersons` is refused from Contributors.
- [x] 1.2 Add Proposal tables (Proposal, operations, base versions, status, notes) and the submit route that enforces the evidence rule; verify that a Proposal without a Citation is refused and one with a Family account is accepted
  - Note: migration `0004_proposals`; `POST /api/proposals`, verified in `server/test/proposals.test.ts` (refusal in the author's language, Family account accepted, idempotent retry). The evidence rule is `satisfiesEvidenceRule` in `shared/src/rules.ts`. Assumption: Proposals made only of merges or undo steps change no facts and need no Citation.
- [x] 1.3 Implement apply-in-one-transaction with base-version checks and log snapshots; verify with a test that a failing last operation leaves the Tree unchanged
  - Note: verified with a failing last operation (a duplicate Role) and with a rule checked at commit (a Name without given name or surname); counts and the log are unchanged and the Proposal stays pending.
- [x] 1.4 Make Editors' direct changes auto-accepted Proposals; verify the typo scenario shows in the record history under the Editor

## 2. Review

- [x] 2.1 Build the review queue route and screen (oldest first, author, Agent badge, readable changes, images); verify on a phone-sized Playwright viewport with three pending Proposals
  - Note: `GET /api/review` (paged, oldest first) and the review screen at `#work/review`; verified in `server/test/app-proposals.e2e.test.ts` (Chromium, 390×844, real server and database). The Agent badge is shown for accounts with role `agent`, which arrives with add-agent-access; until then no author is an Agent.
- [x] 2.2 Implement accept, reject with note, and accept after correction; verify the two scenarios in the review spec
  - Note: API scenarios in `server/test/proposals.test.ts`; the one-tap accept is also exercised in the browser test. Corrections replace an operation with one of the same kind and are stored next to the author's, with the Editor.
- [x] 2.3 Implement conflict display and per-field choice; verify the two-Proposals-same-date scenario
  - Note: per-field choice is stored as an Editor correction (with the base version moved to the current one). The rule is `detectConflict` in `shared/src/rules.ts`.
- [x] 2.4 Implement `mergePersons` with redirects; verify the same-man-twice scenario and that search no longer shows the merged record
  - Note: `POST /api/persons/:id/merge` (an Editor's direct change); the merged Person stays as a redirect (`308` on every `/api/persons/:id…` route) and is left out of search.
- [x] 2.5 Refuse accept, reject and merge for Contributors and Agents; verify the 403 scenario
  - Note: verified for Contributors (accept, reject, merge, merge operation in a Proposal, undo, direct change). Agents do not exist yet (add-agent-access); `mayDecide` in `shared/src/rules.ts` refuses role `agent` and is unit-tested.

## 3. History and undo

- [x] 3.1 Add the record history route and screen; verify the Person history scenario
  - Note: `GET /api/history/:kind/:id` and the History screen (`#work/history/person/<id>`); the scenario is verified through the API (`server/test/merge-undo.test.ts`) and on the screen in `server/test/app-history.e2e.test.ts` (Chromium at 390×844 and 1280×800, real server and database): opened from the person page, each accepted change newest first with its author, the accepting Editor and the date. Once an undo has removed records, the history names them by id (#74).
- [x] 3.2 Implement undo from logged snapshots, including the later-edits check; verify the wrong-merge and after-later-edits scenarios
  - Note: verified through the API, plus: undo is refused (409 `undo_blocked_by_dependents`) while later accepted Proposals attach records to ones it would delete (`undoBlockers` in `shared/src/rules.ts`), and an undo can itself be undone. The undo screen is verified in `server/test/app-history.e2e.test.ts` at phone and desktop size: an undo from the screen, the wrong merge, the choice per field after later edits (refused until every field is chosen; the fields are named in the reader's language), the refusal while a later Proposal depends on it and the undo once that one is undone, and no undo control for Contributors. The refusal says how many later Proposals to undo first, not which (#73).

## 4. Proposal forms and Drafts in the app

- [x] 4.1 Build the "Propose" flows for the common findings (baptism or birth, marriage, death or burial, a new Name, a correction) with Citation entry; verify the baptism-entry scenario end to end
  - Note: verified end to end in `server/test/app-proposals.e2e.test.ts`: the form in Chromium at phone size creates one Proposal with the child, the baptism, parent and godparent Roles, the link to the parents' existing Family, the Citation and its page image; accepted, the Tree holds all of it.
- [x] 4.2 Store Drafts and their photos in IndexedDB with persistent storage requested, and submit with an idempotency key; verify the reading-room scenario in Playwright offline mode, including a retried submit that creates one Proposal
  - Note: verified with Playwright offline mode (`context.setOffline`) in `server/test/app-proposals.e2e.test.ts`, including a submit whose answer is lost and a retry that leaves one Proposal. Drafts are written offline in an app opened online first; opening the app itself offline relies on the service worker from add-map-core and is not part of this test. Photos are stored as taken (no compression on the device).
- [x] 4.3 Show authors their Proposals with status and Editor notes; verify the rejected-with-note scenario from the author's side

## 5. Images

- [x] 5.1 Implement presigned uploads to `pending/`, the move on accept, and deletion of rejected images after 30 days; verify the rejected-image scenario
  - Note: verified with an in-memory store behind the `ImageStorage` interface (`MemoryImageStorage`); the S3 implementation signs PUT links for the exact type and size (unit-checked), but no S3-compatible endpoint was reachable here (MinIO images could not be pulled), so presigned PUT, CopyObject and DeleteObject against a real bucket remain to be checked. After an undo the files are kept 30 days in case the undo is undone, then deleted.
- [ ] 5.2 Generate WebP display copies, keep originals, and convert HEIC; verify with JPEG, PNG, WebP and HEIC fixtures and a 25 MB limit test
  - Note: done: WebP display copies (2,000 px) and kept originals, verified with generated JPEG, PNG and WebP fixtures and the 25 MB limit (`server/test/uploads.test.ts`). Remains: converting real HEIC. The prebuilt sharp/libvips here decodes HEIF only with AV1 (AVIF), not HEVC, so every real iPhone HEIC is refused with the clear message (verified with a synthetic HEIC container; no real HEIC fixture could be made here). Accepting HEIC as the evidence-media spec requires needs a libvips built with libde265 (or a separate HEIC decoder) on the server.
- [x] 5.3 Serve images only by expiring links to the author, Editors or, after acceptance, all Members; verify that another Contributor cannot open a pending image

## 6. Notifications

- [x] 6.1 Send the daily Editor digest at 18:00 Prague time, skipping empty days; verify the quiet-day and busy-day scenarios with a fake clock
  - Note: `DailyScheduler` (`server/src/jobs/daily.ts`), run every minute by `main.ts`; verified with a fake clock, including DST, per-recipient delivery so a retry never sends twice, stale claims after a crash, and shutdown waiting for a running tick.
- [x] 6.2 Send outcome emails in the author's language, with an opt-out; verify the rejected and muted scenarios
  - Note: `PUT /api/me/notifications` and the switch on "My Proposals". Direct changes, merges and undos send no outcome email (the Editor is the author).

## Workflow follow-up

- Archive this change after it ships so its specs move to `openspec/specs/`.
