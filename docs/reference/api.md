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

| Tag            | Routes                                                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| System         | `GET /api/health` (public), `GET /api/openapi.json`                                                                                                                                                                                                     |
| Persons        | `GET /api/persons` (search), `GET /api/persons/{id}`, `…/ancestors`, `…/descendants`, `…/hourglass`; `GET /api/family-roots`, `PUT /api/persons/{id}/family-root`                                                                                       |
| Families       | `GET /api/families/{id}`                                                                                                                                                                                                                                |
| Events         | `GET /api/events/{id}`                                                                                                                                                                                                                                  |
| Map            | `GET /api/map/events`                                                                                                                                                                                                                                   |
| Places         | `GET /api/places` (search), `GET /api/places/{id}`, `…/events`, `…/houses`; `GET /api/houses/{id}`, `GET /api/parishes/{id}`, `GET /api/estates/{id}`                                                                                                   |
| Sources        | `GET /api/sources` (search), `GET /api/sources/{id}`, `GET /api/citations/{id}`, `GET /api/documents/{id}` (a PDF document), `GET /api/images/{id}`                                                                                                     |
| Proposals      | `POST /api/proposals` (with `answersLeads`, the Research leads it answers), `GET /api/proposals`, `GET /api/proposals/{id}`                                                                                                                             |
| Review         | `GET /api/review`, `POST /api/proposals/{id}/accept`, `POST /api/proposals/{id}/reject`, `POST /api/persons/{id}/merge`                                                                                                                                 |
| History        | `GET /api/history/{kind}/{id}`, `GET /api/proposals/{id}/undo` (what an undo would do), `POST /api/proposals/{id}/undo`                                                                                                                                 |
| Images         | `POST /api/uploads`, `POST /api/uploads/{id}/complete`, `GET /api/uploads/{id}`                                                                                                                                                                         |
| Import batches | `POST`, `GET /api/batches`, `GET /api/batches/{id}`, `GET`, `POST /api/batches/{id}/proposals`, `POST /api/batches/{id}/accept` (the Owner), `POST /api/batches/{id}/uploads`, `…/uploads/{uploadId}/complete`; `GET`, `PUT /api/import-map`            |
| Leads          | `GET`, `POST /api/leads`, `GET`, `PATCH /api/leads/{id}`, `POST /api/leads/{id}/searches`, `…/close`; `GET /api/lead-suggestions`, `POST /api/lead-suggestions/{id}/accept`, `…/dismiss` ([Research leads](research-leads.md))                          |
| Scan reading   | `GET /api/readings/status`, `POST /api/readings`, `GET /api/readings/{id}`; `GET`, `PUT /api/settings/scan-reading` (the Owner) ([Scan reading](scan-reading.md))                                                                                       |
| Account        | `GET`, `PATCH /api/me`; `GET`, `PUT /api/me/notifications`; `GET /api/me/sessions`, `DELETE /api/me/sessions/{id}`; `GET /api/me/passkeys`, `DELETE /api/me/passkeys/{id}`                                                                              |
| Members        | `GET /api/members`, `PUT /api/members/{id}/role`, `POST /api/members/{id}/disable`, `…/enable`, `PUT /api/members/{id}/person`; `GET`, `POST /api/invitations`, `DELETE /api/invitations/{id}`                                                          |
| Agents         | `GET`, `POST /api/agents`, `GET /api/agents/{id}`, `POST /api/agents/{id}/tokens`, `DELETE /api/agents/{id}/tokens/{tokenId}`, `POST /api/agents/{id}/disable`, `…/enable`                                                                              |
| Sign-in        | `POST /api/auth/invitation/check`, `…/invitation/accept`, `…/email-link`, `…/email-link/verify`, `…/passkey/authentication/options`, `…/passkey/authentication/verify`, `…/passkey/registration/options`, `…/passkey/registration/verify`, `…/sign-out` |

Every record carries a `version` that changes whenever the record changes. A Proposal names the version of each record it was based on, and review shows a conflict when the record has changed since. A change to a Research lead names the version it read too, and is refused with 409 when the lead changed since.

## Errors

Errors are JSON:

```json
{ "statusCode": 403, "error": "Forbidden", "message": "Only Editors can do this.", "code": "forbidden" }
```

| Status | When                                                                                                                                                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | the request does not match its schema (`code` `validation`), or breaks a rule the schema cannot check, such as a Research lead closed as not found without a search record (`search_needed`)                                           |
| 401    | no valid session or token; it reveals nothing about whether a record exists                                                                                                                                                            |
| 403    | the role may not do this, or a write with the session cookie came from another site                                                                                                                                                    |
| 404    | no such record or route; every scan reading route while scan reading is off                                                                                                                                                            |
| 409    | the request conflicts with the Tree as it is, such as marking a Person merged into another; a Research lead changed since it was read (`conflict`); a suggested lead already decided (`already_decided`)                               |
| 429    | an Agent reached its hourly limit (`code` `rate_limited`), or a Member or Agent their scan readings of the day (`daily_limit`); `retryAt` and the `Retry-After` header say when to try again                                           |
| 503    | finishing an upload: 8 uploads are already waiting to be checked (`busy`), or the image store did not answer within 30 seconds (`store_timeout`); the `Retry-After` header says when to try again, and the upload can be finished then |

## Invitations

Only the Owner invites ([How to invite a Member](../how-to/invite-a-member.md)).

- `POST /api/invitations` with `email` and `language` (`cs` or `en`) sends the invitation email and answers 201 with a `CreatedInvitation`: the invitation (`id`, `email`, `language`, `status` `pending`, `createdAt`, `expiresAt`, `acceptedAt`) and:
  - `link`, the invitation link `<PUBLIC_ORIGIN>/#invite/<token>`, the same as in the email;
  - `shareText`, the invitation as a chat message in the invitation's language, for the Owner to send from their own WhatsApp. It names the inviter, holds the link on a line of its own, says that the link is valid for 7 days and works once, and names the invited address.

  Only this answer holds the link: the server stores only the token's hash. An address that already belongs to a Member answers 409 `already_member`.

- `GET /api/invitations` lists the invitations, newest first, without their links. `status` is `pending`, `accepted`, `expired` (after 7 days) or `revoked`.
- `DELETE /api/invitations/{id}` withdraws an open invitation: its link stops working, however it was sent. 404 when the invitation is not open.
- `POST /api/auth/invitation/check` with `token` (public) only reads. It answers `status`, `language`, `message` (what to do next, in the invitation's language) and `email`, the invited address while the invitation is pending and `null` otherwise. 404 `invitation_unknown` for a token that matches no invitation.
- `POST /api/auth/invitation/accept` with `token`, `displayName` and `language` (public) is the only call that uses an invitation. It creates a Contributor and signs them in (201). A used, expired or withdrawn invitation answers 410 (`invitation_accepted`, `invitation_expired`, `invitation_revoked`), and an address that has become a Member's meanwhile 409 `already_member`.

The token travels only in the link's fragment, which browsers and link previews do not send, so a `GET` of the link never reaches the server with the token.

## Finishing uploads

`POST /api/uploads/{id}/complete` (and its Import batch twin) checks uploads one at a time in each API process, images and documents in the same queue, from loading the file to writing its checked copy (and an image's display copy). A document is not decoded, so its turn is short. At most 8 may wait or be checked at once; one more is refused at once with 503 `busy` and `Retry-After: 10`, and goes through when sent again. An upload whose request is closed while it waits is skipped and stays as it was. Sending a `complete` again, or several at once, is safe: once the upload is finished, each answers with it.

## Agent limits

Each Agent may submit 60 Proposals and make 1,000 other requests an hour, counted in fixed hourly windows over all its tokens. Its requests to its own Import batches (opening one, submitting into it, its uploads and the import map) count instead against a window of 10,000 an hour of their own, so that the Vault import fits in one run. Every Proposal in a batch is still reviewed.
