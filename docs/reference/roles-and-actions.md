# Roles and actions

Every account has one role. Every API route names the action it performs, and the server asks `mayDo(role, action)` (`shared/src/rules.ts`) before it does anything else; a refused request gets 403. `mayDo` is proved with LemmaScript ([verification](../verification.md)); that each route names the right action is tested, not proved.

## Roles

| Role          | Who                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| `contributor` | a Member who submits Proposals but does not change the Tree directly; every new Member starts here       |
| `editor`      | a Member who reviews Proposals and may change the Tree directly                                          |
| `owner`       | the one Member who invites Members, assigns roles, manages Agents and marks Family roots; also an Editor |
| `agent`       | an AI assistant's account, created by the Owner, signed in with a token                                  |

The Owner changes a Member's role in **Settings** (or `PUT /api/members/{id}/role`). Making another Member the Owner hands the role over: the previous Owner becomes an Editor.

## What each role may do

| Action            | Agent | Contributor | Editor | Owner |
| ----------------- | :---: | :---------: | :----: | :---: |
| `read`            |  yes  |     yes     |  yes   |  yes  |
| `propose`         |  yes  |     yes     |  yes   |  yes  |
| `ownAccount`      |  no   |     yes     |  yes   |  yes  |
| `review`          |  no   |     no      |  yes   |  yes  |
| `accept`          |  no   |     no      |  yes   |  yes  |
| `reject`          |  no   |     no      |  yes   |  yes  |
| `merge`           |  no   |     no      |  yes   |  yes  |
| `undo`            |  no   |     no      |  yes   |  yes  |
| `directEdit`      |  no   |     no      |  yes   |  yes  |
| `manageAccounts`  |  no   |     no      |   no   |  yes  |
| `markFamilyRoots` |  no   |     no      |   no   |  yes  |

Any other role or action is refused.

## Actions

| Action             | Covers                                                                    | Routes                                                                                                   |
| ------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `read`             | reading the Tree, your own Proposals, history and images, and who you are | every `GET` route not listed below, such as `GET /api/me`                                                |
| `propose`          | submitting Proposals and uploading their images                           | `POST /api/proposals`, `POST /api/uploads`, `POST /api/uploads/{id}/complete`                            |
| `ownAccount`       | your own name, language, sessions, passkeys and email settings            | `PATCH /api/me`, `/api/me/sessions…`, `/api/me/passkeys…`, `/api/me/notifications`, passkey registration |
| `review`           | seeing the review queue                                                   | `GET /api/review`                                                                                        |
| `accept`, `reject` | deciding on a Proposal as a whole, with corrections and a note            | `POST /api/proposals/{id}/accept`, `…/reject`                                                            |
| `merge`            | merging two Persons                                                       | `POST /api/persons/{id}/merge`                                                                           |
| `undo`             | undoing a whole accepted Proposal                                         | `GET` and `POST /api/proposals/{id}/undo`                                                                |
| `directEdit`       | changing the Tree at once: a Proposal accepted as it is submitted         | `POST /api/proposals` with `direct: true`                                                                |
| `manageAccounts`   | Members, invitations, roles, links to Persons, Agents and their tokens    | `/api/members…`, `/api/invitations…`, `/api/agents…`                                                     |
| `markFamilyRoots`  | marking and unmarking Family roots, and undoing a Proposal that did       | `PUT /api/persons/{id}/family-root`                                                                      |

The health check and the sign-in steps (`/api/auth/…`) need no role.

## Agent limits

An Agent may submit 60 Proposals and make 1,000 other requests an hour; beyond that the API answers 429 with the time to retry ([API](api.md#agent-limits)). Everything an Agent submits is labelled as an Agent's in review and history.
