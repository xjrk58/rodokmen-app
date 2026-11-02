# Tasks

## 1. Leads

- [x] 1.1 Add the lead, lead link, search record and lead history tables with routes to create, edit, list and close; verify the writing-a-lead and Contributor-adds-a-lead scenarios
  - Note: migration `0009_research_leads` (`lead`, `lead_link`, `lead_search`, `lead_event`, `proposal_lead`, `lead_suggestion`). Routes: `GET`/`POST /api/leads`, `GET`/`PATCH /api/leads/:id` (an edit names the version read; a stale one answers 409), `POST /api/leads/:id/searches`, `POST /api/leads/:id/close`. Writing needs the action `writeLeads` (Members and Agents), so no Proposal and no log entry. A link to a Person merged into another shows, and is found under, the Person kept. Verified in `server/test/leads.test.ts`.
- [x] 1.2 Require a search record before closing as not found; verify the negative-result scenario
  - Note: every way a lead gets a status (written, edited, closed) asks the proved `mayHaveStatus`; `POST …/close` takes the closing search in the same step. A search record keeps its Source's title, so it still says what was searched if an undo removes the Source. Verified in `server/test/leads.test.ts` (refused without a search, then shown to someone planning the same search).
- [x] 1.3 Add `answersLeads` to Proposals, mark leads found on accept and reopen them on undo; verify the lead-answered scenario and its undo
  - Note: stored in `proposal_lead`, refused with 400 when a lead does not exist, and shown in every `ProposalView`. Accepting (also a direct change) marks the leads found in the accepting transaction; undoing reopens those it marked found, and undoing that undo finds them again; a rejection changes nothing. Verified in `server/test/leads.test.ts`.
- [ ] 1.4 Drop links to Living people in Exports and remove them on erasure; verify with a fixture lead linked to a Living person
  - Note: not done, because the Export and erasure do not exist yet (`add-exports-and-erasure`, #19). Built for them: the proved rule `exportedPersonLinks`, `leadsForExport` (`server/src/leads/export.ts`), the entry the Export will use for leads, and `eraseFromLeads` (`server/src/leads/erasure.ts`), which erasure is to call before it deletes the Person (it deletes a lead about only them, unlinks them from the rest, turns history entries that name them into a marker, and removes their suggested leads). Both are verified with a fixture lead linked to a Living person in `server/test/leads.test.ts`. Tick this when #19 calls them.
- [x] 1.5 Prove closing as not found, the leads answered by a Proposal and leads in an Export with `lsc check`, with `//@ contract research-leads: What was searched is recorded`, `research-leads: Findings link back to leads` and `exports: Living people are reduced in every Export`; verify with `pnpm verify` and `pnpm verify:trace`, and that closing without a search record makes `lsc check` fail
  - Note: `mayHaveStatus`, `leadsOnAccept`, `leadsOnUndo` and `exportedPersonLinks` in `shared/src/leads.ts`; `docs/verification.md` lists them with their scope. Mutation checked: letting not found close with no search record (`searches >= 0`) fails `lsc check`.

## 2. Gap finder

- [x] 2.1 Write the gap rule as a pure function in `shared/` (missing birth or baptism, unknown parents with known Parish and years, uncited marriage); verify each gap kind with unit tests
  - Note: `suggestGaps` in `shared/src/gaps.ts`; `shared/test/gaps.test.ts`. To name a register the Tree needs to know which registers a Parish has: a Source gains its register coverage (Parish, kinds, years), see design.
- [x] 2.2 Prove the gap rule with `lsc check` and add its `//@ contract research-leads: Gap finder suggests leads`, with ensures for the missing-baptism and dismissed-suggestion scenarios; verify with `pnpm verify` and `pnpm verify:trace` (`docs/verification.md` lists it), and that suggesting a dismissed key makes `lsc check` fail
  - Note: proved sound (every suggestion a real gap with a register that fits), complete (every gap suggested, with each fitting register and the years both cover) and that no decided key is suggested; scope in `docs/verification.md`. Mutations checked: suggesting a dismissed key, and suggesting for someone who is no Relative, each fail `lsc check`.
- [x] 2.3 Compute suggestions nightly and after each accepted Proposal, with stable dismissal keys; verify the missing-baptism and dismissed-suggestion scenarios
  - Note: `server/src/leads/gaps.ts` runs in the transaction of every accepted change for the Persons it touched or whose relation it changed, and in the daily job `lead-suggestions` (02:30 Prague) over everyone. Keys are `kind:subject:source`; a dismissed or accepted key keeps its row and never comes back. Routes: `GET /api/lead-suggestions`, `POST …/accept` (it becomes a lead in the Member's language) and `POST …/dismiss`, Members only (action `decideSuggestions`). Verified in `server/test/gap-finder.test.ts`.

## 3. App and Agents

- [x] 3.1 Add the Leads list with filters, leads on person pages and place sheets, and "Start from this lead" into the Proposal forms; verify the village-sheet scenario at a 390 px viewport
  - Note: a Leads tab (`#leads`, `#leads/place/<id>`, `#leads/<id>`, `#leads/new`), the suggested leads apart from the leads, a lead's page with searches, closing and history, and `#work/lead/<id>/<kind>`, whose Proposal names the lead. Verified at 390 px and 1280 px in `app/tests/e2e/leads.spec.js` (mocked API) and in `server/test/family-view.e2e.test.ts` against the real server under its Content-Security-Policy.
- [x] 3.2 Add MCP tools for listing, creating, updating and closing leads; verify an Agent can close a lead as not found with a search record
  - Note: `list_leads`, `create_lead`, `update_lead`, `add_search_record`, `close_lead`, `get_record` for a lead, and `answersLeads` on `submit_proposal`; still no tool to decide on Proposals or suggested leads. Verified in `server/mcp/test/tools.test.ts`.

## Workflow follow-up

- Archive this change after it ships so its specs move to `openspec/specs/`.
