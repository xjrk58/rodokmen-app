# Tasks

## 1. Agent accounts and tokens

- [ ] 1.1 Add the `agent` role, Agent creation by the Owner, and token issue, list and revoke (hashed, shown once, visible prefix); verify the revoke scenario
- [ ] 1.2 Enforce read-and-propose-only for Agent tokens on every route; verify the accept-own-Proposal scenario and a direct edit attempt both return 403
- [ ] 1.2a Prove the role-and-action rule with `lsc check` in `shared/src/rules.ts`, with `//@ contract agent-access: Read and propose only` and ensures for each refused action and for the accept-own-Proposal scenario; verify with `pnpm verify` and `pnpm verify:trace`, and that allowing `accept` for Agents makes `lsc check` fail
- [ ] 1.3 Show the Agent badge in the review queue and record history; verify with a Playwright screenshot of an Agent Proposal

## 2. Limits

- [ ] 2.1 Add per-token fixed-window limits (60 Proposals and 1,000 reads per hour) with retry time; verify the 61st-Proposal scenario with a fake clock
- [ ] 2.2 Prove the fixed-window decision with `lsc check`, with `//@ contract agent-access: Rate limits` and ensures for the 61st-Proposal scenario and the retry time; verify with `pnpm verify` and `pnpm verify:trace`, and that allowing one request over the limit makes `lsc check` fail

## 3. MCP server

- [ ] 3.1 Create `server/mcp` with tools for searching Persons and Places, reading records, reading ancestors and descendants, and submitting Proposals, calling the API with the Agent token; verify each tool against the fixture tree in an integration test
- [ ] 3.2 Serve it over stdio and over streamable HTTP at `/mcp`; verify a client can connect both ways and that a tool call without a valid token fails

## Workflow follow-up

- Seeding the Tree from the Owner's Vault is done by `add-vault-import`, which needs the Agent tokens from this change.
- Archive this change after it ships so its specs move to `openspec/specs/`.
