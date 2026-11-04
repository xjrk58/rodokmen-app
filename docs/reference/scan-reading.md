# Scan reading

Scan reading has the server read uploaded scans of register pages with a Claude model, through Anthropic's API, into a transcription and structured entries. A reading becomes a Draft that a Member checks, or a Proposal an Agent submits; it never changes the Tree itself. Why it works this way: [Scan reading](../explanation/scan-reading.md) and [ADR 0011](../adr/0011-scan-reading-sends-scans-to-anthropic.md). The schemas below are in `shared/src/schemas/reading.ts` and in the [OpenAPI description](api.md#the-openapi-description) under the tag `Scan reading`.

## When it is available

Scan reading works only when both are true:

- the server has an Anthropic API key, `ANTHROPIC_API_KEY` ([Configuration](configuration.md#api-server));
- the Owner has switched it on, in **Settings → Scan reading** or with `PUT /api/settings/scan-reading`.

Otherwise every reading route answers 404 (`not_found`), and the app does not offer **Read a scan**. Switching it off stops new readings at once; a reading still `queued` then fails with `switched_off` and sends nothing.

## Routes

| Route                            | Action           | Who                     | What it does                                                                                                  |
| -------------------------------- | ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /api/readings/status`       | `read`           | Members and Agents      | the daily limit, the readings used today and those left (`ReadingStatusView`); 404 while off                  |
| `POST /api/readings`             | `propose`        | Members and Agents      | queues a reading of uploaded scans (`CreateReadingBody`); answers 202 with the `ReadingView`, status `queued` |
| `GET /api/readings/{id}`         | `read`           | its author, and Editors | the reading (`ReadingView`); 404 for anyone else, and while off                                               |
| `GET /api/settings/scan-reading` | `manageSettings` | the Owner               | the switch, the daily limit, whether a key is configured, the model, and the readings per author and day      |
| `PUT /api/settings/scan-reading` | `manageSettings` | the Owner               | `{ "enabled": true, "dailyLimit": 10 }`; 409 `not_configured` when switching on without a key                 |

The browser calls only these routes. The server alone calls Anthropic's API, from its reading queue.

## Asking for a reading

`POST /api/readings` takes:

| Field       | Meaning                                                                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uploadIds` | 1 to 5 upload ids of finished uploads (`POST /api/uploads`), in page order, each once: the caller's own uploads, or images already attached to a Citation |
| `crops`     | optional, at most one per scan: `{ uploadId, left, top, width, height }` as shares (0 to 1) of the image's width and height. Only the marked part is sent |
| `context`   | optional; every field may be left out or `null`: `sourceId`, `sourceTitle`, `page`, `placeId`, `years` (`{ from, to }`), `note`, `link`                   |

`context.link` is the archive viewer's address of the page. It is kept for the Citation's note and is never fetched or sent. An archive link given in `uploadIds` is refused with 400 and this message:

> This is a link to an archive viewer, not an image. Save the page as an image or take a photo of it, and add that; the link is kept as the Citation's link.

Refusals:

| Status | `code`        | When                                                                                                              |
| ------ | ------------- | ----------------------------------------------------------------------------------------------------------------- |
| 400    | `validation`  | the body does not match, such as a link instead of an upload id, a scan given twice, or a crop of a scan not read |
| 400    | `not_a_scan`  | the upload is a portrait; portraits are never sent                                                                |
| 404    | `not_found`   | scan reading is off; or no upload of the caller's, nor an image of a Citation, has this id                        |
| 409    | `not_ready`   | the upload is not finished yet                                                                                    |
| 429    | `daily_limit` | the caller has had as many readings today as the daily limit; `retryAt` is the next midnight, Europe/Prague       |

## The daily limit

Each Member and each Agent may ask for `dailyLimit` readings a day (default 10, 1 to 200), counted per author over the day in Europe/Prague. Every reading asked for counts, also one that fails. The limit applies on top of an Agent's [hourly limits](api.md#agent-limits).

## A reading

`GET /api/readings/{id}` answers with a `ReadingView`:

| Field                           | Meaning                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `status`                        | `queued`, `running`, `done` or `failed`                                                                                        |
| `author`                        | `id`, `displayName`, `isAgent`                                                                                                 |
| `uploadIds`, `crops`, `context` | as asked                                                                                                                       |
| `model`                         | the model that read it, once it has run                                                                                        |
| `createdAt`, `finishedAt`       | when it was asked for, and when it was done or failed                                                                          |
| `result`                        | what was read (below); `null` until `done`                                                                                     |
| `error`                         | `{ code, message }` when `failed`                                                                                              |
| `matches`                       | for each read person, by `key`: the existing Persons it may be (`candidates`, best first), each with its `score` and `reasons` |
| `houses`                        | for each entry, the id of the House of the Place that carried the read house number then, or `null`                            |
| `leads`                         | suggested Research leads (below)                                                                                               |

Readings run one at a time, oldest first, in the API process. When the server starts, a reading that a stopped process left `running` for over 15 minutes goes back to the queue, and so does every `queued` one.

### What was read

`result` is a `ReadingResult`, the JSON schema the model answers in. A value the reader does not have is `null`, an empty list or an empty text, never a guess.

- `pages`: for each scan, in order (`page` 0, 1, …): its `transcription` line by line, and its `languages`.
- `entries` (at most 30), each with:
  - `page`, `type` (an Event type, such as `baptism`, `marriage`, `burial`), `typeDetail`;
  - `date` in the EDTF subset, `dateAsWritten`, `house` (the čp. as digits, optionally one letter), `place`;
  - `transcription`: the entry in its own language and spelling;
  - `persons`: each with a `key` (`p1`, `p2`, … unique in the reading), `role`, `roleDetail`, `sex`, `names` (`given`, `surname`, `asWritten`, `language`), `description`, `house`, `residence`;
  - `illegible`: the values that could not be read (`date`, `house`, `place`, or a person's, such as `p3.house`) with a `note`. A value reported illegible is left empty;
  - `hints`: next steps the entry implies (`parents_marriage`, `godparent_house`, `earlier_entry`, `later_entry`, `other`).
- `note`: anything about the scans as a whole.

The server checks every answer against the schema, refinements included. An answer that does not match fails the reading (`invalid_result`); it is never repaired.

### Matches

Candidates come from the Tree, never from the model. The server finds Persons whose given name and surname, or their variants, match the read name (register spellings and Latin and German forms fold together: Joannes, Johann and Jan; Nowak and Novák; Nováková and Novák), and scores each one:

| Reason   | Points | True when                                                                   |
| -------- | -----: | --------------------------------------------------------------------------- |
| `name`   |     16 | a given name and the surname, or their variants, match a Name of the Person |
| `house`  |      8 | the Person has an Event at a House that carried the read house number then  |
| `years`  |      4 | the Person's birth falls in the years the role allows at the entry's date   |
| `place`  |      1 | the Person has an Event at the Place of the reading                         |
| `family` |      1 | a partner of the Person matches another person of the same entry            |

Only Persons whose name matches are offered.

### Suggested leads

`leads` lists `ReadingLeadSuggestion`s: a `key`, the `kind` and the `entry` it follows from, a `question` and a `reason` in Czech and English, the `personKeys` it concerns, `years`, the `parish`, the `archive` that holds its registers, and, when the Tree has a register of that Parish for those years, its `sourceId` and `sourceTitle`. A dated baptism or birth with both parents always suggests finding their marriage, in the 25 years before. A suggestion is not saved anywhere until a Member keeps it as a lead (`POST /api/leads`, [Research leads](research-leads.md)).

### Failures

| `error.code`         | Why                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------- |
| `switched_off`       | scan reading was switched off before the reading started; nothing was sent            |
| `image_missing`      | a scan of the reading is no longer stored                                             |
| `busy`               | a crop was to be cut while 8 uploads and crops were already waiting their turn        |
| `store_timeout`      | the image store did not answer within 30 seconds while a crop was cut                 |
| `refused`            | the model declined to read the scans                                                  |
| `too_long`           | the answer was cut off; read fewer pages, or mark a crop                              |
| `invalid_result`     | the answer was not JSON, did not match the schema, or had a different number of pages |
| `reader_busy`        | Anthropic's API was rate limited                                                      |
| `reader_request`     | Anthropic's API refused the request                                                   |
| `reader_unreachable` | Anthropic's API could not be reached                                                  |
| `reader_error`       | Anthropic's API failed                                                                |
| `internal`           | the server failed                                                                     |

## What is sent

For each reading, the server sends Anthropic's API:

- each scan asked for, in order: its display copy (WebP, at most 2,000 pixels on its longest side), or the part marked as a crop, cut from the original and sent the same way. Never the original file, a portrait, or another Member's upload;
- the context as text: the register (the Source's title, repository and reference, or the `sourceTitle`), the page, the Place and its Parishes, the years and the note;
- the given names and the surnames, as two separate lists, of Persons who are not Living and have Events in that Place or its Parishes (from at most 300 Persons);
- the fixed instructions and the `ReadingResult` schema.

The request uses the model in `RODOKMEN_SCAN_MODEL` (default `claude-opus-5-5`) with adaptive thinking, the effort in `RODOKMEN_SCAN_EFFORT` (default `high`), structured output, and Anthropic's server-side fallback model when the model declines. The SDK retries a failed request twice.

## Proposals from a reading

A Proposal drafted from readings carries `reader` in `POST /api/proposals`:

```json
{ "reader": { "readingIds": ["…"], "marks": [{ "position": 3, "fields": ["name.surname", "date"] }] } }
```

`readingIds` must name finished readings of the Proposal's author, and each mark an operation of the Proposal; otherwise it is refused with 400 (`unknown_reading`, `invalid_proposal`). `marks` names, by the index of the operation, the fields still as the reader produced them, not confirmed or changed by a person. The app shows them as "read by AI" in the Draft and on the Proposal in review and in **My Proposals**.

Every new Citation of a Proposal that carries `reader`, or that attaches an image that was read, has at most `normal` confidence: the server lowers `high` to `normal` whatever was sent.

The app builds one Citation per page, with the page's image and transcription, and the Events, Roles, new Persons, Names and Families of the entries kept. A new Person's first read name is their birth name if they are the child of a baptism or birth entry, else a Name of type `other`; every Name keeps its `language`.

## Settings

`GET /api/settings/scan-reading` answers with `ScanReadingSettings`:

| Field                    | Meaning                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `enabled`                | whether scans are sent to be read                                                             |
| `dailyLimit`             | readings per Member (or Agent) per day                                                        |
| `configured`             | whether the server has an API key; without one, scan reading cannot be switched on            |
| `model`                  | `RODOKMEN_SCAN_MODEL`                                                                         |
| `changedAt`, `changedBy` | the last change of the switch or the limit                                                    |
| `usage`                  | per day and author, the last 30 days, newest first: `readings`, and how many of them `failed` |

## The MCP tools

An Agent reads scans with `read_scan`, looks a reading up with `get_reading`, and submits one with `propose_reading` ([MCP tools](mcp-tools.md#scan-reading)).
