# Research leads

Research leads, their search records, suggested leads, the register coverage of a Source that the gap finder reads, and when the gap finder runs. The schemas are in `shared/src/schemas/leads.ts`; their full form is in the [OpenAPI description](api.md#the-openapi-description), tag `Leads`. How to use them: [as a Member](../how-to/work-with-research-leads.md), [as an Agent](../how-to/record-research-as-an-agent.md). Why they work this way: [Research leads](../explanation/research-leads.md).

## Routes

| Route                                     | Action              | Body                 | Answer                                                | Refused with                                                 |
| ----------------------------------------- | ------------------- | -------------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| `GET /api/leads`                          | `read`              | query below          | 200 `LeadList`                                        | 400                                                          |
| `POST /api/leads`                         | `writeLeads`        | `CreateLeadBody`     | 201 `LeadDetail`                                      | 400 (`unknown_record`, `search_needed`)                      |
| `GET /api/leads/{id}`                     | `read`              |                      | 200 `LeadDetail`                                      | 404                                                          |
| `PATCH /api/leads/{id}`                   | `writeLeads`        | `UpdateLeadBody`     | 200 `LeadDetail`                                      | 400 (`unknown_record`, `search_needed`), 404, 409 `conflict` |
| `POST /api/leads/{id}/searches`           | `writeLeads`        | `SearchRecordBody`   | 201 `LeadDetail`                                      | 400 (`unknown_record`), 404                                  |
| `POST /api/leads/{id}/close`              | `writeLeads`        | `CloseLeadBody`      | 200 `LeadDetail`                                      | 400 (`search_needed`), 404, 409 `conflict`                   |
| `GET /api/lead-suggestions`               | `read`              | query below          | 200 `SuggestionList` (open suggestions only)          | 400                                                          |
| `POST /api/lead-suggestions/{id}/accept`  | `decideSuggestions` |                      | 201 `LeadDetail`, the new lead                        | 404, 409 `already_decided`                                   |
| `POST /api/lead-suggestions/{id}/dismiss` | `decideSuggestions` |                      | 200 `LeadSuggestion`                                  | 404, 409 `already_decided`                                   |
| `POST /api/proposals` with `answersLeads` | `propose`           | `SubmitProposalBody` | 201 `ProposalView`, with `answersLeads` as `LeadRef`s | 400 `unknown_lead`                                           |

Every route also answers 401 without a session or token, 403 when the role may not do the action ([Roles and actions](roles-and-actions.md)), and 429 when an Agent reached its hourly limit. Writes change the lead at once: there is no review.

`GET /api/leads` takes `status` (a comma-separated list, such as `open,in_progress`), `personId`, `placeId`, `archive` (the lead's archive, or the repository of its register), `assigneeId`, `limit` (1 to 200, default 50) and `offset`. It lists open and in-progress leads first, then the rest, newest change first. `GET /api/lead-suggestions` takes `personId`, `placeId`, `limit` and `offset`.

## A lead

| Field                              | Type                                         | Notes                                                                 |
| ---------------------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| `question`                         | text, 1 to 1,000 characters                  | required                                                              |
| `reason`                           | text, 1 to 4,000 characters                  | required: why, and what is known so far                               |
| `archive`                          | text up to 400, or null                      | the archive to look in                                                |
| `sourceId` (shown as `source`)     | id of a Source, or null                      | the register to check                                                 |
| `years`                            | `{ from, to }`, or null                      | years 1 to 9999, `from` ≤ `to`; one year has `from` equal to `to`     |
| `pages`                            | text up to 200, or null                      | such as `1–60`                                                        |
| `personIds` (shown as `persons`)   | up to 50 Person ids, each once               | a Person merged into another shows as the kept one                    |
| `placeIds` (shown as `places`)     | up to 50 Place ids, each once                |                                                                       |
| `assigneeId` (shown as `assignee`) | a Member's or an Agent's account id, or null | who works on it; a disabled account is refused                        |
| `status`                           | `open`, `in_progress`, `found`, `not_found`  | default `open`                                                        |
| `outcome`                          | text up to 4,000, or null                    | what came of it                                                       |
| `version`                          | number                                       | changes with every change; edits and closing name it as `baseVersion` |
| `author`                           | `AuthorRef`                                  | who wrote it, with the Agent badge for an Agent                       |
| `foundBy`                          | Proposal id, or null                         | the accepted Proposal that answered it                                |
| `fromSuggestion`                   | key, or null                                 | the suggested lead it was accepted from                               |
| `searches`                         | `SearchRecordView[]`                         | newest first                                                          |
| `history` (`LeadDetail` only)      | `LeadChange[]`                               | newest first                                                          |

`CreateLeadBody` takes the fields above (all but `question` and `reason` may be left out) and `searches`, up to 50 search records made already. `UpdateLeadBody` takes `baseVersion` and at least one field. `CloseLeadBody` takes `baseVersion`, `status` (`found` or `not_found`), `outcome` and an optional `search` recorded with the closing.

### Status rules

- A lead has status `not_found` only with at least one search record: creating, changing or closing it to `not_found` without one is refused with 400 `search_needed` (`mayHaveStatus`, proved).
- Accepting a Proposal that names the lead in `answersLeads` sets it to `found` with `foundBy`, in the same transaction. Undoing that Proposal sets it back to `open`, unless someone closed it otherwise since. Rejecting the Proposal changes nothing (`leadsOnAccept`, `leadsOnUndo`, proved).
- An edit or a close whose `baseVersion` is not the lead's version is refused with 409 `conflict`.

### Search records

| Field        | Type                      | Notes                                     |
| ------------ | ------------------------- | ----------------------------------------- |
| `sourceId`   | id of a Source, or null   | the register looked at                    |
| `archive`    | text up to 400, or null   | required when `sourceId` is null          |
| `years`      | `{ from, to }`, or null   | the years looked at                       |
| `pages`      | text up to 200, or null   |                                           |
| `searchedOn` | EDTF date                 | default today                             |
| `searchedBy` | text up to 200            | default the author's name                 |
| `found`      | boolean                   | required                                  |
| `note`       | text up to 4,000, or null | what was found, or what was there instead |

A search record is kept with its `author` and `createdAt`. No route changes or removes one.

### History

Each change is a `LeadChange` with `at`, `author`, `kind` and the `fields` it changed (`before`, `after`):

| `kind`     | When                                                      |
| ---------- | --------------------------------------------------------- |
| `created`  | the lead was written, or accepted from a suggestion       |
| `edited`   | fields changed through `PATCH`                            |
| `searched` | a search record was added                                 |
| `closed`   | closed as found or not found                              |
| `answered` | a Proposal naming it was accepted (`proposalId` names it) |
| `reopened` | that Proposal was undone (`proposalId` names it)          |

## Suggested leads

The gap finder suggests a lead for a gap of a Relative. Suggestions are stored apart from the leads, as `LeadSuggestion`:

| `kind`     | The gap                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `birth`    | a Relative with no birth or baptism Event with a Citation                                                                     |
| `parents`  | a Relative who is the child of no Family with a known partner, while the Parish and years of their birth or baptism are known |
| `marriage` | a marriage of a Relative (a Family's two partners and the Events where both are partners) with no Citation on either          |

Each suggestion names the register Source that fits (the Parish's register of that kind whose years overlap), with the years both cover; or, when none fits, the archive of the Place's Municipality and no register. A gap with two fitting registers is two suggestions.

- **Key:** `<kind>:<Person or Family id>:<Source id>`, with an empty Source id when no register fits. Stable across runs.
- **Status:** `open`, then `accepted` (it became a lead; `leadId` names it) or `dismissed`. A Member decides; an Agent cannot (403).
- **Decided keys never come back**: the gap finder never suggests a key that was accepted or dismissed (`suggestGaps`, proved).
- **Years:** the years of the birth, baptism or marriage Events from their EDTF dates, widened by one year on each side (`SEARCH_MARGIN_YEARS`), then cut to the register's years. Born about 1801 (`1801~`, 1799 to 1803) with a register for 1784 to 1820 gives 1798 to 1804. Without a dated Event, no years.
- **`question` and `reason`** come in Czech and English.

### When the gap finder runs

- In the transaction of every accepted Proposal, an undo included, for the Persons it touched and those whose relation to the family it changed. When the Owner accepts a whole Import batch, once at the end, for everyone the batch touched.
- Every night at 02:30 Prague time, over everyone: the daily job `lead-suggestions`, run by the API server's daily scheduler like the other daily jobs (`editor-digest` at 18:00, `delete-unused-images` at 03:30). It also removes open suggestions whose gap is gone. A failed run is tried again 10 minutes later, at most 5 times a day.

## Register coverage of a Source

A Source of type `parish_register` may say which register it is, in its `register` field:

| Field      | Type                                         | Notes                                      |
| ---------- | -------------------------------------------- | ------------------------------------------ |
| `parishId` | id of a Parish                               | the Parish that kept the register          |
| `kinds`    | one to three of `birth`, `marriage`, `death` | each once                                  |
| `from`     | year, or null                                | null when unknown: then it covers any year |
| `to`       | year, or null                                | at least `from`                            |

Any other type of Source has `register: null`. The field is part of the Tree and changes only through Proposals: `createSource` with `register` (its `parishId` may be a temporary id or a batch reference), and `setField` on a `source` with `register` in `set`. It is logged and undone like any other field. Read it with `GET /api/sources/{id}`.

## Storage

Migration `0009_research_leads` adds the tables `lead`, `lead_link` (its Persons and Places), `lead_search`, `lead_event` (its history), `proposal_lead` (the leads a Proposal answers) and `lead_suggestion`, and the columns `source.register_parish_id`, `register_kinds`, `register_from` and `register_to`.

Leads are not part of the Tree's log of accepted Proposals: their history is in `lead_event`. For the Export and erasure ([#19](https://github.com/xjrk58/rodokmen-app/issues/19)), `leadsForExport` (`server/src/leads/export.ts`) leaves out every link to a Living person and every lead that concerns only Living people (`exportedPersonLinks`, proved), and `eraseFromLeads` (`server/src/leads/erasure.ts`) removes a Person from the leads. Neither is called yet.
