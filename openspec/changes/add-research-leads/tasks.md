# Tasks

## 1. Leads

- [ ] 1.1 Add the lead, lead link, search record and lead history tables with routes to create, edit, list and close; verify the writing-a-lead and Contributor-adds-a-lead scenarios
- [ ] 1.2 Require a search record before closing as not found; verify the negative-result scenario
- [ ] 1.3 Add `answersLeads` to Proposals, mark leads found on accept and reopen them on undo; verify the lead-answered scenario and its undo
- [ ] 1.4 Drop links to Living people in Exports and remove them on erasure; verify with a fixture lead linked to a Living person
- [ ] 1.5 Prove closing as not found, the leads answered by a Proposal and leads in an Export with `lsc check`, with `//@ contract research-leads: What was searched is recorded`, `research-leads: Findings link back to leads` and `exports: Living people are reduced in every Export`; verify with `pnpm verify` and `pnpm verify:trace`, and that closing without a search record makes `lsc check` fail

## 2. Gap finder

- [ ] 2.1 Write the gap rule as a pure function in `shared/` (missing birth or baptism, unknown parents with known Parish and years, uncited marriage); verify each gap kind with unit tests
- [ ] 2.2 Prove the gap rule with `lsc check` and add its `//@ contract research-leads: Gap finder suggests leads`, with ensures for the missing-baptism and dismissed-suggestion scenarios; verify with `pnpm verify` and `pnpm verify:trace` (`docs/verification.md` lists it), and that suggesting a dismissed key makes `lsc check` fail
- [ ] 2.3 Compute suggestions nightly and after each accepted Proposal, with stable dismissal keys; verify the missing-baptism and dismissed-suggestion scenarios

## 3. App and Agents

- [ ] 3.1 Add the Leads list with filters, leads on person pages and place sheets, and "Start from this lead" into the Proposal forms; verify the village-sheet scenario at a 390 px viewport
- [ ] 3.2 Add MCP tools for listing, creating, updating and closing leads; verify an Agent can close a lead as not found with a search record

## Workflow follow-up

- Archive this change after it ships so its specs move to `openspec/specs/`.
