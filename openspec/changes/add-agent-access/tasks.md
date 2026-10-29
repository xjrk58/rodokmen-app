# Tasks

## 1. Agent accounts and tokens

- [ ] 1.1 Add the `agent` role, Agent creation by the Owner, and token issue, list and revoke (hashed, shown once, visible prefix); verify the revoke scenario
- [ ] 1.2 Enforce read-and-propose-only for Agent tokens on every route; verify the accept-own-Proposal scenario and a direct edit attempt both return 403
- [ ] 1.3 Show the Agent badge in the review queue and record history; verify with a Playwright screenshot of an Agent Proposal

## 2. Limits

- [ ] 2.1 Add per-token fixed-window limits (60 Proposals and 1,000 reads per hour) with retry time; verify the 61st-Proposal scenario with a fake clock

## 3. MCP server

- [ ] 3.1 Create `server/mcp` with tools for searching Persons and Places, reading records, reading ancestors and descendants, and submitting Proposals, calling the API with the Agent token; verify each tool against the fixture tree in an integration test
- [ ] 3.2 Serve it over stdio and over streamable HTTP at `/mcp`; verify a client can connect both ways and that a tool call without a valid token fails

## 4. Seeding

- [ ] 4.1 Run a private seeding session in which an Agent submits the existing research as Proposals with Citations or Family accounts; verify that every seeded Proposal is in the queue, labelled as Agent work, and passes the evidence rule
- [ ] 4.2 Owner reviews the seeded Proposals; verify the Tree contains the accepted findings and the log names the Agent as author

## Workflow follow-up

- Archive this change after it ships so its specs move to `openspec/specs/`.
