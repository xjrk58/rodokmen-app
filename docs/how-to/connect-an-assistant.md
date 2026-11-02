# How to connect an AI assistant through MCP

This guide shows the Owner how to give an AI assistant its own Agent account and token, and how to connect the assistant to Rodokmen's MCP server. An Agent may read the Tree and submit Proposals, and nothing else ([roles and actions](../reference/roles-and-actions.md)); its tools are listed in [MCP tools](../reference/mcp-tools.md).

## Create the Agent and its first token

1. Sign in as the Owner and open **Settings**. Under **Agents**, click **Add an Agent**.
2. Enter its name, which is shown next to its Proposals, such as `Register reader`, and optionally what the token is for, such as the computer the assistant runs on.
3. Click **Create the Agent and its token**.
4. The token, `rdk_ag_…`, is shown once. Click **Copy the token** and paste it into the assistant's settings (below), then click **Done, I have saved it**.

You will not see the token again: it is not kept on the device, and after a reload only its prefix shows. Keep it like a password: whoever has it can read the whole Tree. If it is lost, issue another token and revoke the lost one.

## Manage Agents and tokens

In **Settings**, under **Agents**, each Agent lists its tokens by prefix and label, when each was added and last used, and this hour's use of its limits (60 Proposals and 1,000 other requests).

- To give an Agent another token, for example for a second machine, click **Issue another token**, then **Issue the token**, and copy it as above.
- To stop one token at once, click **Revoke** next to it and confirm. The next request with it is refused.
- To stop an Agent with all its tokens, click **Disable**. **Enable again** lets its tokens that are not revoked work again.

The same can be done through the API, under `/api/agents` ([API](../reference/api.md)).

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

- "The Agent token was refused": the token is mistyped or revoked, or the Agent is disabled. In **Settings**, under **Agents**, issue another token, or click **Enable again**.
- A refusal with a time to retry after: the Agent reached its hourly limit. It may go on after that time.
