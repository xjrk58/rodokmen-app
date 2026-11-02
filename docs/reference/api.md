# The API

The app, the MCP server and Agents all use one HTTP API under `/api/`, on the same origin as the app. Its full description is an OpenAPI 3.1 document, generated from the same Zod schemas in `shared/` that check every request and response.

## The OpenAPI description

- **In the repo:** [`server/openapi.json`](../../server/openapi.json). `pnpm --filter @rodokmen/server openapi` writes it; CI (`server-ci`) fails when it differs from the routes or a route has no schema.
- **From a running server:** `GET /api/openapi.json`, for a signed-in Member or an Agent token:

  ```sh
  curl -s -H "Authorization: Bearer rdk_ag_…" https://rodokmen.dev/api/openapi.json
  ```

Open either in any OpenAPI 3.1 viewer.

## Who may call it

Every route except `GET /api/health` and the sign-in steps (`/api/auth/…`) needs one of:

- the session cookie `rdk_session`, set when a Member signs in with a passkey, an emailed link or an invitation. A session ends after `SESSION_IDLE_DAYS` days without use (default 90), or when the Member ends it;
- an Agent token in the header `Authorization: Bearer rdk_ag_…`.

Each route needs an action that the caller's role may do ([Roles and actions](roles-and-actions.md)). A write with the session cookie must come from the app's own origin: a request whose `Origin` header names another site is refused with 403. A request with a token is judged by the token alone.

## Routes

The OpenAPI tags, and the routes in each:

| Tag       | Routes                                                                                                                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| System    | `GET /api/health` (public), `GET /api/openapi.json`                                                                                                                                                                                                     |
| Persons   | `GET /api/persons` (search), `GET /api/persons/{id}`, `…/ancestors`, `…/descendants`, `…/hourglass`; `GET /api/family-roots`, `PUT /api/persons/{id}/family-root`                                                                                       |
| Families  | `GET /api/families/{id}`                                                                                                                                                                                                                                |
| Events    | `GET /api/events/{id}`                                                                                                                                                                                                                                  |
| Map       | `GET /api/map/events`                                                                                                                                                                                                                                   |
| Places    | `GET /api/places` (search), `GET /api/places/{id}`, `…/events`, `…/houses`; `GET /api/houses/{id}`, `GET /api/parishes/{id}`, `GET /api/estates/{id}`                                                                                                   |
| Sources   | `GET /api/sources` (search), `GET /api/sources/{id}`, `GET /api/citations/{id}`, `GET /api/images/{id}`                                                                                                                                                 |
| Proposals | `POST /api/proposals`, `GET /api/proposals`, `GET /api/proposals/{id}`                                                                                                                                                                                  |
| Review    | `GET /api/review`, `POST /api/proposals/{id}/accept`, `POST /api/proposals/{id}/reject`, `POST /api/persons/{id}/merge`                                                                                                                                 |
| History   | `GET /api/history/{kind}/{id}`, `GET /api/proposals/{id}/undo` (what an undo would do), `POST /api/proposals/{id}/undo`                                                                                                                                 |
| Images    | `POST /api/uploads`, `POST /api/uploads/{id}/complete`, `GET /api/uploads/{id}`                                                                                                                                                                         |
| Account   | `GET`, `PATCH /api/me`; `GET`, `PUT /api/me/notifications`; `GET /api/me/sessions`, `DELETE /api/me/sessions/{id}`; `GET /api/me/passkeys`, `DELETE /api/me/passkeys/{id}`                                                                              |
| Members   | `GET /api/members`, `PUT /api/members/{id}/role`, `POST /api/members/{id}/disable`, `…/enable`, `PUT /api/members/{id}/person`; `GET`, `POST /api/invitations`, `DELETE /api/invitations/{id}`                                                          |
| Agents    | `GET`, `POST /api/agents`, `GET /api/agents/{id}`, `POST /api/agents/{id}/tokens`, `DELETE /api/agents/{id}/tokens/{tokenId}`, `POST /api/agents/{id}/disable`, `…/enable`                                                                              |
| Sign-in   | `POST /api/auth/invitation/check`, `…/invitation/accept`, `…/email-link`, `…/email-link/verify`, `…/passkey/authentication/options`, `…/passkey/authentication/verify`, `…/passkey/registration/options`, `…/passkey/registration/verify`, `…/sign-out` |

Every record carries a `version` that changes whenever the record changes. A Proposal names the version of each record it was based on, and review shows a conflict when the record has changed since.

## Errors

Errors are JSON:

```json
{ "statusCode": 403, "error": "Forbidden", "message": "Only Editors can do this.", "code": "forbidden" }
```

| Status | When                                                                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------------------------- |
| 400    | the request does not match its schema (`code` `validation`)                                                             |
| 401    | no valid session or token; it reveals nothing about whether a record exists                                             |
| 403    | the role may not do this, or a write with the session cookie came from another site                                     |
| 404    | no such record or route                                                                                                 |
| 409    | the request conflicts with the Tree as it is, such as marking a Person merged into another                              |
| 429    | an Agent reached its hourly limit (`code` `rate_limited`); `retryAt` and the `Retry-After` header say when to try again |

## Agent limits

Each Agent may submit 60 Proposals and make 1,000 other requests an hour, counted in fixed hourly windows over all its tokens.
