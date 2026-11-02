# MCP tools

The Rodokmen MCP server (`server/mcp/`) lets an AI assistant with an Agent token read the Tree and submit Proposals. It is a client of the [API](api.md): every tool is one API call made with the Agent's token, so it can do nothing the token may not do there.

## Server

| Property     | Value                                                                                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name         | `rodokmen`, version `0.1.0`                                                                                                                                                                                         |
| HTTP         | `https://<domain>/mcp` (streamable HTTP), with `Authorization: Bearer <Agent token>` on every request                                                                                                               |
| stdio        | `node server/mcp/dist/stdio.js` with `RODOKMEN_URL` and `RODOKMEN_TOKEN` ([Configuration](configuration.md#mcp-server))                                                                                             |
| Instructions | tells the assistant it acts as an Agent, that a Proposal bundles one finding with at least one Citation, to search before proposing and refer to existing records by id, that dates are EDTF, and its hourly limits |

Over HTTP, each request first checks the token with the API, which counts as one of the Agent's requests. Over stdio, the server checks the token once when it starts, and exits with the API's answer if it is refused.

## Tools

| Tool                | Inputs                                                                                                                                                        | Calls                                                                                                                      | Changes anything                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `search_persons`    | `q` (any part of any Name; case and diacritics ignored), `placeId`, `from`, `to` (years), `relation` (`relative`, `possible`, `unrelated`), `limit`, `offset` | `GET /api/persons`                                                                                                         | no                                                                  |
| `search_places`     | `q` (any name of the Place over time, in Czech, German or Latin), `limit`, `offset`                                                                           | `GET /api/places`                                                                                                          | no                                                                  |
| `search_sources`    | `q` (part of the title), `type` (such as `parish_register`), `limit`, `offset`                                                                                | `GET /api/sources`                                                                                                         | no                                                                  |
| `get_record`        | `kind` (`person`, `family`, `event`, `place`, `house`, `parish`, `estate`, `source`, `citation`), `id`                                                        | the record's route, such as `GET /api/persons/{id}` or `GET /api/families/{id}`; a merged Person answers with the kept one | no                                                                  |
| `get_ancestors`     | `personId`, `generations` (1 to 12, default 6, the Person counting as the first)                                                                              | `GET /api/persons/{id}/ancestors`                                                                                          | no                                                                  |
| `get_descendants`   | `personId`, `generations` (1 to 12, default 6)                                                                                                                | `GET /api/persons/{id}/descendants`                                                                                        | no                                                                  |
| `submit_proposal`   | `note` (for the reviewing Editor), `operations` (1 to 300, in order), `idempotencyKey` (optional; made up when left out)                                      | `POST /api/proposals`                                                                                                      | submits a Proposal; the Tree changes only when an Editor accepts it |
| `list_my_proposals` | `status` (`pending`, `accepted`, `rejected`), `limit`                                                                                                         | `GET /api/proposals?mine=true`                                                                                             | no                                                                  |

Paging: `limit` is 1 to 200 (default 50), `offset` skips that many results. Ids are UUIDs.

`submit_proposal` takes the same operations as `POST /api/proposals` (the `Operation` schema in the [OpenAPI description](api.md#the-openapi-description)). New records get temporary ids (`tmp:…`) that later operations of the same Proposal refer to; changes to existing records name the version that was read. A Proposal needs at least one Citation (`createCitation` or `attachCitation`). Retrying with the same `idempotencyKey` returns the same Proposal.

## Errors

A refused call returns an error result the assistant can read:

| API answer | Text                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| 401        | The Agent token was refused: it is not valid, was revoked, or the Agent was disabled. Ask the Owner for a new token. |
| 429        | the API's message, with the time to retry after                                                                      |
| other      | The API refused the request (status and code): the API's message                                                     |
| no answer  | The Rodokmen API could not be reached. Try again later.                                                              |
