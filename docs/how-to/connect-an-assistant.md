# How to connect an AI assistant through MCP

This guide shows the Owner how to give an AI assistant its own Agent account and token, and how to connect the assistant to Rodokmen's MCP server. An Agent may read the Tree and submit Proposals, and nothing else ([roles and actions](../reference/roles-and-actions.md)); its tools are listed in [MCP tools](../reference/mcp-tools.md).

## Create the Agent and its first token

There is no screen for this yet; one is being added to Settings ([#45](https://github.com/xjrk58/rodokmen-app/issues/45)). Until then, sign in as the Owner, open the browser's developer console on the Rodokmen page, and run:

```js
await (
  await fetch('/api/agents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Register reader' }) })
).json();
```

The answer holds the new Agent with its id, and its first token, `rdk_ag_…`, which is shown only this once. Keep the token like a password: whoever has it can read the whole Tree.

Each Agent may submit 60 Proposals and make 1,000 other requests an hour.

## Manage Agents and tokens

In the same console:

```js
// List Agents, their tokens (by prefix) and this hour's use of their limits.
await (await fetch('/api/agents')).json();
// Give an Agent another token, for example one per machine.
await (await fetch('/api/agents/<agent id>/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
// Revoke one token at once.
await fetch('/api/agents/<agent id>/tokens/<token id>', { method: 'DELETE' });
// Stop an Agent with all its tokens, and let it go on again.
await fetch('/api/agents/<agent id>/disable', { method: 'POST' });
await fetch('/api/agents/<agent id>/enable', { method: 'POST' });
```

## Connect the assistant

### Over HTTP

Point the assistant at `https://<domain>/mcp` with the header `Authorization: Bearer <token>`. For example, in Claude Code:

```sh
claude mcp add --transport http rodokmen https://rodokmen.dev/mcp --header "Authorization: Bearer rdk_ag_…"
```

Every request there checks the token with the API first, which counts as one of the Agent's requests. Connections drop for a moment when Rodokmen is deployed.

### Over stdio, on the assistant's machine

1. In a checkout of this repo, run `pnpm install` and `pnpm build`.
2. Have the assistant start `node server/mcp/dist/stdio.js` with `RODOKMEN_URL` set to the Rodokmen address and `RODOKMEN_TOKEN` to the token. In Claude Code:

   ```sh
   claude mcp add rodokmen -e RODOKMEN_URL=https://rodokmen.dev -e RODOKMEN_TOKEN=rdk_ag_… -- node /path/to/rodokmen-app/server/mcp/dist/stdio.js
   ```

The server checks the token when it starts, and exits with the API's answer if the token is refused.

To try it against a local server (as in the [tutorial](../tutorials/first-proposal.md)), use `RODOKMEN_URL=http://localhost:3000`; `pnpm --filter @rodokmen/mcp stdio` runs the same server without a build.

## Check the connection

Ask the assistant which Rodokmen tools it has. It should list `search_persons`, `search_places`, `search_sources`, `get_record`, `get_ancestors`, `get_descendants`, `submit_proposal` and `list_my_proposals`. Then ask it to search for a Person you know.

Proposals it submits appear in the review queue with an **Agent** badge.

## If the assistant is refused

- "The Agent token was refused": the token is mistyped or revoked, or the Agent is disabled. Create a new token, or enable the Agent.
- A refusal with a time to retry after: the Agent reached its hourly limit. It may go on after that time.
