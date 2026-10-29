# Tasks

## 1. Reader

- [ ] 1.1 Define the reading result schema in `shared/` (entries, Persons, Names, Roles, EDTF dates, Houses, illegible markers, lead hints); verify with valid and invalid examples
- [ ] 1.2 Benchmark reading on 10 invented-or-public sample pages (Latin, Kurrent, Czech) with two Claude models, and set the default model; verify the benchmark results are recorded in design.md
- [ ] 1.3 Add the reading job (`POST /api/readings`, queue, Anthropic Messages API with structured output, schema check, failure state); verify the baptism-page scenario against a recorded API response and the illegible-house-number scenario
- [ ] 1.4 Add the Owner's switch, the daily limit and the usage view; verify the switched-off and daily-limit scenarios
- [ ] 1.5 Refuse portal URLs as input and keep them as Citation links; verify the portal-link scenario

## 2. Draft, marking and matching

- [ ] 2.1 Turn a reading into Draft operations with `source: 'reader'` marks, and cap reader-drafted Citation confidence at normal on the server; verify the Member-confirms scenario and that a submitted high confidence is lowered
- [ ] 2.2 Write match scoring as a pure function in `shared/` and the candidate query; verify the known-father scenario
- [ ] 2.3 Prove match scoring with `lsc check` and add its `//@ contract scan-reading: Names are matched, not duplicated`; verify `lsc check` passes and `docs/verification.md` lists it
- [ ] 2.4 Build the check screen (entries, transcription beside the scan, match choices, "read by AI" marks) at 390 px; verify the baptism-page flow end to end in Playwright with a recorded reading

## 3. Leads and Agents

- [ ] 3.1 Turn reader hints into suggested leads with real Sources; verify the parents'-marriage scenario
- [ ] 3.2 Add the MCP tool to request a reading, producing an Agent Proposal; verify the Agent-reads-a-scan scenario

## Workflow follow-up

- Archive this change after it ships so its specs move to `openspec/specs/`.
