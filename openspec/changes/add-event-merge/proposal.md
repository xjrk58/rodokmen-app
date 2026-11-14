# Proposal

## Why

The Tree can hold one happening twice as two Events, and nothing can make them one again (#154):

- `mergePersons` merges Persons only.
- `restoreRecord` is written only by an undo.
- Undoing the Proposal that created the second Event undoes the whole finding it came with.
- The app has no such action either.

The Owner's Tree holds 25 such pairs. An importer before #149 gave a marriage both spouses record without a Source note one Event per spouse. #158 stopped that for new imports, and its later run attaches the second note's Citation to the first Event and lists the pairs, but the second Event stays. Duplicates also arise when a Member proposes an Event the Tree already has. The Owner gave the go-ahead on 2026-11-14.

## What Changes

- **A new operation, `mergeEvents`**, Editors' only like `mergePersons`. It names the Event to keep, the Event to merge into it, and the base versions of both.
  - It moves to the kept Event the merged Event's Roles and Citations, except those the kept Event has already.
  - It fills the kept Event's date, Place or House and type detail where the kept Event has none, and adds the merged Event's description and research notes below the kept Event's own.
  - It then deletes the merged Event. Images hang off Citations and Persons, not Events, so they come along with their Citations.
- **Refused when the Events disagree on a fact.** The merge is refused, naming each fact, when:
  - the Events are of different types;
  - both have a date or a Place or House, and they differ;
  - they disagree on who the child, father, mother, deceased or partners are: in each of these Roles, the Persons of one Event must all be among those of the other, so two different children are refused, and so are partners A and B against A and C;
  - one Person would play two of those Roles;
  - the joined description or notes would be too long.
  The Editor corrects one Event first, with its evidence, and merges then.
- **No Citation needed.** A merge of Events changes no fact, so the evidence rule exempts it, as it exempts a merge of Persons. The proved rule changes with it.
- **Logged and undone like a Person merge.** One direct change, in the history of both Events and of every Person whose Role moved. An undo brings the merged Event back with its own Roles and Citations.
- **The merged Event's address answers with the kept one.** `GET /api/events/<merged id>` answers 308 with the kept Event, as a merged Person's does. Everything that reads a record by id gets the kept Event: the app, `get_record` in MCP, the importer.
- **API:** `POST /api/events/{id}/merge`, with the same body as the Person merge. `PersonDetail` gains `mergeableEvents`: pairs of the Person's Events that look like one, with the one to keep suggested.
- **App:** on the person page an Editor sees "Same Event?" under two Events that look like one. It opens both side by side: Roles, date, Place, Citations, which one stays. Merging there reloads the page; a refusal is shown in the Member's language.
- **The 25 pairs are merged by hand.** The importer can't merge, because its Agent may not. Its report lists each pair still to merge, with a link to a spouse's person page, and drops a pair once it is merged.

Out of scope:

- Contributors and Agents proposing a merge for an Editor to accept, the importer included (question 1 in `design.md`).
- Asking the Editor which date or Place to keep when the Events disagree, instead of refusing (question 2).
- A Tree-wide list of Events that look like one (question 4).
- An Event page in the app. The app has none: an Event is a card on the person page of each Person in it (question 5).
- Merging other records: Families, Places, Sources, Citations.

## Capabilities

### New Capabilities

### Modified Capabilities

Main specs are empty because no change is archived yet, so these deltas add requirements, as `add-acceptance-email` did. The evidence rule is edited in place in `add-proposals-and-review`, as #157 did.

- `review`: a new requirement, "Merging duplicate Events", next to "Merging duplicate Persons" (`add-proposals-and-review`).
- `proposals`: "Evidence is required" (`add-proposals-and-review`) also exempts an Editor's merge of two Events. Edited in place.
- `family-view`: a new requirement, "Merge duplicate Events from the person page".
- `tree-read-api`: a new requirement, "A merged Event answers with the kept one".
- `vault-import`: a new requirement, "Marriage Events imported twice are listed until merged". It narrows the scenario "Marriage imported twice" (`add-vault-import`): the report lists a pair only while both Events exist.

## Impact

- **Shared:**
  - a new proved file `shared/src/event-merge.ts`, for when two Events agree, what the kept one holds and which pairs the person page offers;
  - `shared/src/rules.ts` (fact-free merges, and a new proved `mayUseOperation`);
  - the `mergeEvents` operation and its check;
  - the `MergeEventsBody` and `mergeableEvents` schemas;
  - the sentence for review and history.
- **Server:**
  - applying, conflicts and views of the operation;
  - the route `POST /api/events/{id}/merge`, and the 308 on `GET /api/events/{id}`;
  - `mergeableEvents` in `getPerson`;
  - the importer's report;
  - `server/openapi.json`.
- **MCP:** no new tool. `submit_proposal` refuses `mergeEvents` for an Agent, and `get_record` answers a merged Event's id with the kept Event.
- **App:** `app/src/person-screen.js`, a new `app/src/event-merge.js`, `app/src/api.js`, the texts in Czech and English, `precache.js`.
- **Tests:**
  - the proofs;
  - shared unit tests;
  - API tests for merge, refusal, undo, redirect and rights;
  - the importer's report;
  - Playwright on the person page at phone and desktop size.
- **Docs:** reference (API, MCP tools, roles and actions), how-to (import the Vault), explanation (proposals and review), `README.md`.
- **Data:** no migration, no new setting, no new dependency. The operation set stays at version 1: a new operation leaves every stored Proposal valid.
