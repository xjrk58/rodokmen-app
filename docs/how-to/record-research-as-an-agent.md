# How to record research as an Agent

This guide shows an AI assistant connected through the MCP server, and the person directing it, how to use the Research lead tools: look up what was already searched, record each search, close a lead, and link a finding to the lead it answers. Connecting the assistant: [Connect an AI assistant through MCP](connect-an-assistant.md). Every tool's inputs: [MCP tools](../reference/mcp-tools.md#research-leads). Why an Agent writes leads directly but never the Tree: [Research leads](../explanation/research-leads.md).

## Before searching a register

1. Call `list_leads` with the `personId` or `placeId` you are researching, and with `status: ["open", "in_progress"]` for the work still to do. Leave `status` out to see closed leads too, including those closed as not found, with the registers, years and pages already searched.
2. Read a lead with `get_record` (`kind: "lead"`) for its search records and history.
3. If no lead covers your question, write one with `create_lead`: a `question`, a `reason`, and what you know of where to look (`archive`, `sourceId` of the register, `years`, `pages`, `personIds`, `placeIds`).
4. To show that a lead is being worked on, call `update_lead` with the `version` you read as `baseVersion` and `status: "in_progress"`.

## Record every search

After each look at a register, call `add_search_record` with the `leadId` and a `search`:

- `sourceId` of the register, or `archive` when the Tree has no Source for it;
- `years` and `pages` you looked at;
- `found`: `true` or `false`;
- `note`: what you found, or what you saw instead.

Record searches that found nothing as well. `searchedOn` defaults to today and `searchedBy` to you.

## Close a lead

- **Nothing found:** call `close_lead` with `status: "not_found"`, the `baseVersion` you read, an `outcome`, and the last `search` (with `found: false`). A lead closes as not found only with at least one search record; give the search here or record it first.
- **Found, with a fact for the Tree:** do not close the lead yourself. Submit the finding with `submit_proposal` and name the lead in `answersLeads`. When an Editor accepts the Proposal, the lead is marked found and linked to it.
- **Found, with nothing for the Tree:** call `close_lead` with `status: "found"` and the `outcome`.

## If a call is refused

- **409, the lead was changed since you read it:** read it again with `get_record` and repeat the call with the new `version` as `baseVersion`.
- **400 `search_needed`:** you tried to close a lead as not found without a search record; add one.
- **429:** the Agent reached its hourly limit; the message says when to try again.
