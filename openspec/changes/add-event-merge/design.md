# Design

## Context

See `proposal.md` for why. How the Tree works today:

- **Events.** An Event is a row of `event`: type, type detail, EDTF date with its derived range, a Place or a House (never both, constraint `event_place_or_house`), a description of up to 4,000 characters and research notes of up to 50,000. Only two tables point at an Event: `event_role` (unique per Event, Person and Role) and `event_citation` (unique per Event and Citation). Images hang off Citations (`image.citation_id`) and Persons (`image_person`), never off an Event.
- **The Person merge** (`mergePersons`) is a direct change by an Editor. It goes through `submitProposal` with `direct: true`, so it is logged like any accepted Proposal.
  - `apply.ts` moves each dependent row with `rows.update`, or removes a twin with `rows.remove`, and points the merged Person at the kept one (`merged_into_id`).
  - `GET /api/persons/{id}` answers 308 for a merged Person.
  - An undo replays the log backwards with `restoreRecord`.
  - The operation is in `EDITOR_ONLY_OPERATIONS`, refused in `checkOne` for anyone who is not an Editor, and fact-free in the proved evidence rule.
- **The 25 pairs** come from an importer before #149, which gave a marriage both spouses record without a Source note one Event per spouse.
  - The importer's map keys the first as `key` and the second as `earlierKey` (`plan.mergedMarriages`). Since #149 the plan refers only to `key`.
  - The run since #158 attaches the second note's Citations to the `key` Event and lists the pairs: the `key` Event as "keep", the other by record id.
  - On the Owner's import copy all 25 agree on date and Place (PR #158).
- **The importer** is an Agent. `submitProposal` checks a Proposal with `editor: canReview(author)`, so it can submit no Editor-only operation.

## Goals / Non-Goals

**Goals:**

- A merge of Events that loses nothing silently: every fact, Role, Citation, description and note of the merged Event ends up on the kept one, or the merge is refused.
- The same shape as the Person merge: one operation, a direct change, logged, undone by the usual undo.
- The 25 pairs can be merged by the Owner in the app in a few minutes, and the importer stops listing them once they are.

**Non-Goals:**

- No migration and no new column: the merged Event is deleted, not kept as a redirect row.
- No merge proposed by Contributors, Agents or the importer.
- No choice of values when the Events disagree: the merge refuses, and the Editor corrects one Event first.

## Decisions

### 1. The operation and the route

`mergeEvents { keepId, mergeId, keepBaseVersion, mergeBaseVersion }`, with `keepId ≠ mergeId`, beside `mergePersons` in the closed operation set. `POST /api/events/{id}/merge` takes the same body as the Person merge (`MergeBody`: `mergeId`, both base versions, an optional note). It submits a direct Proposal of that one operation, as `mergePersons` in `service.ts` does. An Editor may also put the operation in a Proposal for review, like `mergePersons`. The operation set stays at version 1: a new operation leaves every stored Proposal valid, as `setNotes` and the Label operations did.

### 2. What moves, what is filled, what is refused

| Of the merged Event | Onto the kept Event |
| --- | --- |
| type | must be the same, else refused (`type`) |
| type detail | the kept one's; filled from the merged one when the kept has none; both set and different: refused (`type`) |
| date | the kept one's; filled when the kept has none; both set and different: refused (`date`) |
| Place or House | as one slot: the kept one's; filled (Place or House, whichever the merged has) when the kept has neither; both set and different: refused (`place`) |
| description | the kept one's, then a blank line and the merged one's, unless they are equal or one is empty; refused (`description`) if longer than 4,000 characters |
| research notes | joined the same way; refused (`notes`) if longer than 50,000 |
| Roles | each moves (`event_id` changes), except one the kept Event has already (same Person and Role): that twin is removed. A twin keeps the kept Event's role detail. Refused (`roles`) when the Events disagree on a principal Role (below) |
| Citations | each link moves, except one the kept Event has already: that twin link is removed. The Citation itself, its images and its other links are untouched |
| images | nothing to move: they belong to Citations and Persons |

Dates and Places compare as written, by value and by id: `1801` and `1801-11-20` differ, and so do a Place and a House in it. Treating the more precise one as agreeing is question 2.

**Principal Roles** are child, father, mother, deceased and partner: the Roles that say whose Event it is.

- For each, the Persons one Event has in that Role must all be in it in the other Event too, or the other way round. So two different children, or partners A and B against A and C, are refused, while partners A and B against A alone merge.
- A Person may also not end up in two different principal Roles, for example child in one Event and father in the other.
- Partners A against B alone are refused too, although they would make only two. They share no Person, so the person page never offers that pair; an Editor adds the partner Role to one Event first.
- Godparent, witness, priest, informant and other Roles add up freely: one entry may name the godparents, another the witnesses.

The rule is one pure function, `mergeEventFacts` in `shared/src/event-merge.ts`, proved (below). The server reads both Events and their Roles under lock, asks it, and refuses with 409 `merge_conflict`. The answer (`MergeRefused`) lists the facts in `facts`, comma-separated (`date,place`). The app keys its text on that code and those names, so the refusal shows in Czech too. The function is symmetric in what it refuses: swapping keep and merge changes only the order of joined text.

### 3. Delete the merged Event, redirect from the log

The Person merge keeps the merged row with `merged_into_id`, and every query of Persons filters it out. Doing the same for Events would add a column and a filter to every Event query: person and family pages, the map, Places, Houses, Exports, the gap finder, relation, kinship and charts. So the merged Event is deleted, as #154 says.

Its address still answers. `GET /api/events/{id}` finds an Event that no longer exists in the log: the latest accepted `mergeEvents` operation that names it as `mergeId`, in a Proposal not undone (`proposal_operation.target_table = 'event'` and `target_id`, kept for every operation). It answers 308 to the kept Event, following later merges up to 10 steps, as `GET /api/persons/{id}` does for a merged Person. An Event deleted by an undo of its creation finds no merge and stays 404. The same lookup lets an operation on a merged Event fail with 409 `event_merged` ("propose against the remaining Event"), next to `person_merged`, both when it is applied and when accepting finds it in conflict. A pending Proposal written against the merged Event therefore cannot be accepted as it is: the Editor rejects it, or corrects it to the kept Event.

### 4. Order of the changes, and undo

Apply, in `apply.ts`:

1. Check both base versions (`checkBase`) and lock both rows.
2. Read both Events and their Roles; ask `mergeEventFacts`; refuse on any conflict.
3. Move or remove the Roles.
4. Move or remove the Citation links.
5. Update the kept Event's fields where they change, through `setFieldColumns`, so the date's range columns follow. The kept Event's version goes up even when no field of its own changes (its `updated_at` is set), because it took in the other: a Proposal written against it before shows as a conflict, and the merge is in its history even when every Role and Citation was a twin.
6. Remove the merged Event (`rows.remove`, which refuses while anything still points at it).

Removing twins first matters: the imported pairs are all twins once the #158 run is accepted. Moving a twin would break `unique (event_id, person_id, role)` and answer 23505.

The undo needs nothing new. It replays the logged changes newest first: the merged Event comes back first (`rows.restore` re-inserts it from its snapshot), then the kept Event's fields, then the Citation links and Roles, moved back or re-inserted. Later edits of a moved Role or of the kept Event's fields ask the Editor per field, as for any undo. No undo blocker arises, because the undo deletes nothing.

### 5. Rights and evidence

- **Rights.** A new proved function `mayUseOperation(editor, op)` in `rules.ts` replaces the list check in `checkOne`. Only Editors may use `mergePersons` and `mergeEvents`. The message names the operation ("only Editors merge Events"). The route has `action: 'merge'`, so `mayDo` already refuses Contributors and Agents before the body is read.
- **Evidence.** `isFactFreeOperation` adds `mergeEvents`. The Tree holds the same facts, Roles and Citations before and after. A date or Place filled in was on the merged Event with its Citations, which move along. The proof of `satisfiesEvidenceRule` gains the scenario "An Event merge needs no Citation".

### 6. Conflicts at accept

`targetsOf` (views) names both Events with their base versions, so review shows a conflict when either changed since. Resolving it refreshes both base versions, as for `mergePersons`. That is safe because apply asks `mergeEventFacts` again on the Events as they are then.

### 7. History and Export

- **History.** The merge is one log entry, a direct change by the Editor, with its note, and no Citations of its own. It shows:
  - in the history of the kept Event, through its own change and the moved rows that now point at it;
  - in the history of the merged Event (`record_id`);
  - in the history of every Person whose Role moved or was removed, through `person_id` in the snapshots.
  
  For the imported pairs both partner Roles are twins and are removed, so the merge shows in both spouses' histories, and either one's history screen offers the undo. The sentence is "merges the marriage of 1801-11-20 into the marriage of 1801-11-20" ("slučuje událost … do události …"). The merged Event's label comes from the log, as labels of removed records already do.
- **Export.** The Exports are written from the Tree as it is, so the next nightly Export and the GEDCOM file show one Event, with the Roles and Citations of both. Events have no note of their own in the Markdown Export, so no slug or file goes away. The log is not exported.

### 8. Where it appears

- **The app has no Event page.** An Event is a card on the person page of each Person in it. So the offer is there.
  - `PersonDetail.mergeableEvents` lists the pairs of the Person's Events that look like one, each `{ keepId, mergeId }`, worked out by the proved `mergeOffer`: of one type, the Person in the same Role in both, and `mergeEventFacts` finds no conflict. The suggested Event to keep has more Citations, else the earlier `created_at`.
  - For the imported pairs that is the `key` Event, which carries both notes' Citations once the #158 run is accepted. Before that the two tie, and the `key` Event is the older, since the batch is accepted in order.
  - Every Member gets the field. Only an Editor sees the offer.
- **The panel.** Under the second Event of a pair an Editor sees "Same Event?". It opens a panel with both Events side by side, loaded with `GET /api/events/{id}`: their Roles, date, Place or House, description and Citations. A choice says which one stays, with the suggested one chosen. A note field and "Merge" follow. After the merge the page reloads; a refusal is shown in the Member's language. When one Event changed since the panel read it (409 `conflict`), the panel says so and reads both again, so the Editor sees what changed before trying again. The undo is in the Person's history, as for every change.
- **MCP.** No new tool: Agents read and propose only.
  - `submit_proposal` takes the whole operation set, so it would carry `mergeEvents`, and the API refuses it with 403 like `mergePersons`.
  - `get_record` follows the redirect, so a merged Event's id answers with the kept one. Its description says so, as it does for Persons.
  - The instructions tell an Agent that finds an Event twice to say so in a Research lead, not to propose it again.

### 9. The 25 pairs: merged by hand, listed by the importer

The importer's Agent cannot submit `mergeEvents` (Context). Letting it, or letting any Contributor propose a merge for an Editor to accept, is a change of rights, so it is question 1, not built.

So the Owner merges the pairs in the app. The report helps:

- **What the run reads.** For each pair it reads the `key` Event and, while that is there, the other one (`GET /api/events/{id}`, which follows a merge): about 50 reads for 25 pairs, well under the Agent's 1,000 an hour.
- **Still two Events.** The pair is listed with the Event to keep and the address of the second spouse's person page, `<url>/#people/<id>` (`MergedMarriage.personKey`).
- **Merged into the `key` Event.** The `key` Event is there, and reading the other leads to it (or to nothing). The pair is left out.
- **Merged the other way.** Reading the `key` Event leads elsewhere, or nowhere. The pair is listed under its own heading: later runs refer to the `key` Event, which is gone, so a later fix to that marriage would fail. The Owner undoes the merge and merges the other way.

The how-to says to keep the Event the app suggests, which is the report's "keep".

Once the Owner has merged them, the dry run and the run list none.

### 10. Questions for the Owner

Built with the suggested answer; each can change later without a migration.

1. **May Contributors and Agents propose a merge of Events for an Editor to accept?** That would let the importer propose the 25 merges into an Import batch.
   - Suggested: **no**, like Persons. A merge rewrites what others wrote, and the Editor who sees two Events can merge them at once.
   - Built: Editors only; the importer lists the pairs and the Owner merges them by hand.
2. **When dates or Places differ, refuse or ask?** For example `1801` against `1801-11-20`, or a Place against a House in it.
   - Suggested: **refuse**. The Editor corrects one Event with its evidence first, so the Tree never takes a value without the Citation that gives it.
   - Built: refuse. Asking per fact, like conflicts at accept, is a later change.
3. **Description and research notes: join or refuse?**
   - Suggested: **join**, the kept Event's first, then a blank line and the merged one's, so nothing is lost and nothing needs a decision.
   - Built: join. Refused only when the result is too long.
4. **A Tree-wide list of Events that look like one, for Editors,** beside the Person merge tool?
   - Suggested: **not now**. The person page offers each pair, and the importer's report links the 25. A list is worth it if Members' duplicates turn up.
5. **An Event page in the app?** There is none; the merge panel shows the two Events side by side.
   - Suggested: **not for this**. It belongs with a wider change of how Events are shown.

## Rules proved with LemmaScript

| Rule | Requirement | File |
| --- | --- | --- |
| `mergeEventFacts`: when two Events agree, which facts they disagree on, and what the kept Event holds after the merge (type, type detail, date, Place or House, description, notes, principal Roles) | review: Merging duplicate Events; review: A merged Event fills the gaps of the kept one; review: Merging Events refuses disagreeing facts | `shared/src/event-merge.ts` (new, added to `shared/LemmaScript-files.txt`) |
| `mergeOffer`: whether the person page offers a pair, and which Event it suggests keeping | family-view: Merge duplicate Events from the person page | `shared/src/event-merge.ts` |
| `isFactFreeOperation` and `satisfiesEvidenceRule`: a merge of Events needs no Citation | proposals: Evidence is required | `shared/src/rules.ts` |
| `mayUseOperation`: only Editors use the merge operations | review: Contributors never accept or merge; review: Merging duplicate Events | `shared/src/rules.ts` |

Unknown values are the empty string, not `null`, so no optional is ever compared with `<` (the known swapped-comparison issue). The text limits are parameters, since constants are not emitted. Not proved, because they read the database or the network: applying the merge, the redirect lookup, the queries that gather the inputs, and the importer's report.

## Risks / Trade-offs

- **The merged Event's row is gone.** Anything that kept its id outside the Tree, such as a Draft on a device or a link in a Research lead's text, reads it through the redirect. A pending Proposal against it fails at accept with `event_merged`, and the Editor corrects or rejects it.
- **Merging the wrong way round breaks later imports of that marriage.** → The app suggests the importer's Event, the how-to says to keep it, and the report flags a pair merged the other way.
- **Strict agreement refuses some true duplicates.** Different precision of the date, or a Place against a House in it, is refused. → The refusal names the fact; the Editor corrects one Event first. Question 2 asks whether to relax it.
- **A refusal never shows on the person page,** since the page offers only pairs that agree. → The refusal path matters for the API, for a pair that changed since the page was loaded, and for Editors' Proposals in review; tests cover it there.

## Migration Plan

No migration. Deploy as usual. Then the Owner:

1. runs the importer's dry run, which lists the pairs still to merge with their links;
2. merges each in the app, keeping the suggested Event;
3. runs the dry run again: it lists none.

Rollback is a revert, but only before the first merge: the log then holds `mergeEvents` operations, which the code before this change cannot read in history or review. After a merge, fix forward instead.
