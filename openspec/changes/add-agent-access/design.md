# Design

## Context

The write path (Proposals) and review exist after `add-proposals-and-review`. Agents are another kind of author on that path, with stricter limits.

## Goals / Non-Goals

**Goals:**
- An assistant can do useful research work through MCP alone.
- The Owner can see and stop any Agent at once.

**Non-Goals:**
- No autonomous scheduling of Agents by the server; Agents run elsewhere and call in.

## Decisions

### Agents are accounts with their own role
An Agent is an account with role `agent`. Its permissions are a fixed subset of a Contributor's, with no email and no sessions. Reusing the account table keeps authorship in Proposals and the log uniform.

### Tokens
A token is a random 256-bit value with a short visible prefix (for example `rdk_ag_7f3a…`). Only its SHA-256 hash is stored. The prefix is shown in the Owner's token list, so the Owner can tell which token to revoke.

### MCP server as a thin client
`server/mcp` uses the official TypeScript MCP SDK and calls the public API with the Agent's token; it has no database access of its own. That makes "nothing beyond the API" true by construction. It runs over stdio for local assistants and over streamable HTTP on the same domain, under `/mcp`.

### Rate limiting
A fixed-window limit is kept per Agent in Postgres, shared by all of its tokens, so a second token gives no more than the spec's limits. That is enough at family scale and avoids running a separate store.

### Seeding
The research done so far lives in the Owner's Vault and enters the Tree through `add-vault-import`, which uses an Agent token from this change.

### Rules proved with LemmaScript
Two pure rules in `shared/src/rules.ts`, next to `mayDecide`, are proved with `lsc check` (ADR 0009). Each lives in one file with everything its proof calls, and keeps optionals out of ordering comparisons (docs/verification.md, known issues).
- **What a role may do** (agent-access: Read and propose only): one function from a role and an action to allowed or refused. Proved: the `agent` role may read and submit Proposals and nothing else; accepting, rejecting, merging, undoing, direct edits and account management are refused; an Agent is never allowed what a Contributor is refused. Every route asks this function; that wiring is tested, not proved.
- **The fixed-window limit** (agent-access: Rate limits): a function from the window start, the count in the window, the limit and the time now to "allow" or "refuse until". Proved: one window never allows more than the limit, so the 61st Proposal within the hour is refused, and the retry time is the end of the window, later than now. The clock and the counter update in Postgres are the trust boundary.

## Risks / Trade-offs

- [An Agent floods the queue] → rate limits, and the Owner can revoke the token.
- [An Agent invents facts] → the evidence rule, confidence on every Citation, the Agent badge, and review.

## Open Questions

None that change the specs.
