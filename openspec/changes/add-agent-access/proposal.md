# Proposal

## Why

AI agents will do much of the slow work, such as reading register pages, transcribing them and spotting links. They must contribute through the same review as everyone else (ADR 0001), with their own accounts that the Owner controls. The first job for an Agent is to bring the research done so far into the Tree as Proposals.

## What Changes

- Agent accounts created by the Owner, each with revocable tokens.
- Agents may read and propose only, and their Proposals are labelled as Agent work.
- An MCP server over the same API, so assistants can search the Tree and submit Proposals.
- Rate limits for Agent tokens.

Out of scope: Agents accepting, merging or undoing anything; Agents without an Owner-issued token; importing the Owner's Vault (`add-vault-import`, ADR 0010).

## Capabilities

### New Capabilities
- `agent-access`: Agent accounts, tokens, permissions, limits and the MCP server.

### Modified Capabilities

## Impact

- New server routes for Agent accounts and tokens, token authentication on every route, and rate limiting.
- New package `server/mcp` (an MCP server using the official TypeScript SDK).
- Depends on `add-tree-backend` and `add-proposals-and-review`.
