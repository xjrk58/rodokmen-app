# Tasks

## 1. Operations and Proposals

- [ ] 1.1 Define the typed operations in `shared/` with validation and human-readable summaries in Czech and English; verify each operation's summary in a snapshot test
- [ ] 1.2 Add Proposal tables (Proposal, operations, base versions, status, notes) and the submit route that enforces the evidence rule; verify that a Proposal without a Citation is refused and one with a Family account is accepted
- [ ] 1.3 Implement apply-in-one-transaction with base-version checks and log snapshots; verify with a test that a failing last operation leaves the Tree unchanged
- [ ] 1.4 Make Editors' direct changes auto-accepted Proposals; verify the typo scenario shows in the record history under the Editor

## 2. Review

- [ ] 2.1 Build the review queue route and screen (oldest first, author, Agent badge, readable changes, images); verify on a phone-sized Playwright viewport with three pending Proposals
- [ ] 2.2 Implement accept, reject with note, and accept after correction; verify the two scenarios in the review spec
- [ ] 2.3 Implement conflict display and per-field choice; verify the two-Proposals-same-date scenario
- [ ] 2.4 Implement `mergePersons` with redirects; verify the same-man-twice scenario and that search no longer shows the merged record
- [ ] 2.5 Refuse accept, reject and merge for Contributors and Agents; verify the 403 scenario

## 3. History and undo

- [ ] 3.1 Add the record history route and screen; verify the Person history scenario
- [ ] 3.2 Implement undo from logged snapshots, including the later-edits check; verify the wrong-merge and after-later-edits scenarios

## 4. Proposal forms and Drafts in the app

- [ ] 4.1 Build the "Propose" flows for the common findings (baptism or birth, marriage, death or burial, a new Name, a correction) with Citation entry; verify the baptism-entry scenario end to end
- [ ] 4.2 Store Drafts and their photos in IndexedDB with persistent storage requested, and submit with an idempotency key; verify the reading-room scenario in Playwright offline mode, including a retried submit that creates one Proposal
- [ ] 4.3 Show authors their Proposals with status and Editor notes; verify the rejected-with-note scenario from the author's side

## 5. Images

- [ ] 5.1 Implement presigned uploads to `pending/`, the move on accept, and deletion of rejected images after 30 days; verify the rejected-image scenario
- [ ] 5.2 Generate WebP display copies, keep originals, and convert HEIC; verify with JPEG, PNG, WebP and HEIC fixtures and a 25 MB limit test
- [ ] 5.3 Serve images only by expiring links to the author, Editors or, after acceptance, all Members; verify that another Contributor cannot open a pending image

## 6. Notifications

- [ ] 6.1 Send the daily Editor digest at 18:00 Prague time, skipping empty days; verify the quiet-day and busy-day scenarios with a fake clock
- [ ] 6.2 Send outcome emails in the author's language, with an opt-out; verify the rejected and muted scenarios

## Workflow follow-up

- Archive this change after it ships so its specs move to `openspec/specs/`.
