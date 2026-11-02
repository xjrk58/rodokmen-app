# Design

## Context

Uploads, Drafts and Proposals exist (`add-proposals-and-review`), and so do leads (`add-research-leads`) and Agent access (`add-agent-access`). Reading happens on the server because relatives use phones, not agents. Sending scans to Anthropic is a deliberate privacy trade-off (ADR 0011).

## Goals / Non-Goals

**Goals:**
- A checked baptism entry takes a Member under a minute, from photo to submitted Proposal.
- A reading never invents a value, and never reaches the Tree unchecked.

**Non-Goals:**
- No fine-tuned model; prompts and the Tree's own context do the work.
- No bulk reading of whole register books.

## Decisions

### Server-side reading job
`POST /api/readings` takes upload ids and the Member's context, and queues a job. The job sends the scans (the display copies, or a crop when the Member marked one) with a structured-output prompt to the Anthropic Messages API. The model is configured by `RODOKMEN_SCAN_MODEL`. The prompt includes the context and the Tree's known names for that Place and Parish. The response must match a Zod schema from `shared/` (entries, Persons, Roles, EDTF dates, Houses, illegible markers); anything that doesn't match is rejected and shown as a failed reading, not repaired by guessing. The result is stored with the upload and turned into Draft operations on the device, so the existing Draft flow does the rest.

### Marking and limits are enforced in code, not only in the prompt
Every value from a reading carries `source: 'reader'` until the Member edits or confirms it. The server caps the confidence of a reader-drafted Citation at normal when the Proposal arrives. Empty-instead-of-guessed is asked of the model, and checked by refusing values the schema can't parse.

### Matching
Match candidates come from the Tree, not the model: a query by folded name and variants, a year window, House and Place. It scores each candidate with fixed rules, and the scoring is a pure function in `shared/`, proved with LemmaScript (ADR 0009). The model's output is only the read text; deciding who someone is stays a deterministic rule plus the Member's tap.

### Suggested leads
The reader returns hints ("parents married before 1801", "godparent from čp. 7"). Templates in `shared/` turn them into lead suggestions with the archive lookup and the Tree's registers, so the leads name real Sources.

### Switch, key and usage
The API key lives in the server's environment only. The Owner's switch and daily limit are settings in the database. Usage is counted per Member per day. With the switch off, the route answers 404 and the app hides the entry point.

### Rules proved with LemmaScript
These pure functions in `shared/` are proved with `lsc check` (ADR 0009). Each lives in one file with everything its proof calls, and keeps optionals out of ordering comparisons (docs/verification.md, known issues). The model's reading, the candidate query and the API call are the trust boundary.
- **Match scoring** (scan-reading: Names are matched, not duplicated): proved: a candidate with the read name, House and a year in the window scores above any candidate without them, and the score depends only on the read text and the Tree.
- **The switch and the daily limit** (scan-reading: The Owner switches it on; evidence-media: Images sent for reading): proved: with the switch off nothing is read and no image is sent, and a Member at their daily limit is refused.
- **The confidence cap** (scan-reading: The machine's reading is marked and modest): proved: a Citation the reader drafted has at most normal confidence, and a value the Member confirmed is no longer marked as read by AI.

## Risks / Trade-offs

- [Private scans leave our servers] → off by default, an Owner decision stated in the switch, display copies or crops only, never Citations' metadata about Living people beyond the names on the page (ADR 0011).
- [Misreadings look plausible] → "read by AI" marking, confidence capped, a Member check before submission, then Editor review.
- [Cost] → a daily limit per Member and a usage view for the Owner.

### Decided in implementation
- **Default reader:** `claude-opus-5-5` until the benchmark settles it (task 1.2), set by `RODOKMEN_SCAN_MODEL`, with adaptive thinking at effort `high` (`RODOKMEN_SCAN_EFFORT`), streaming, and the server-side fallback on a policy decline. It reads images and answers in a JSON schema (structured output), which a reading needs.
- **Structured output keeps enums:** the server sends the JSON Schema of `ReadingResult` with `enum` kept (roles, Event types, sex), objects closed, and the keywords structured output does not support moved into descriptions; the Zod schema checks everything afterwards.
- **One Citation per page:** a page's Citation carries its image and transcription and is attached to the Event of every entry read from it, since a Citation carries the image of its page (ADR 0002) and an upload becomes one image.
- **Marks travel with the Proposal:** `reader: { readingIds, marks }` names, per operation, the fields still as read; the server stores and shows them, and caps the confidence of every new Citation of a Proposal that names a reading or has an image that was read.
- **What goes out:** the display copy or a crop cut from the checked original (WebP, at most 2,000 pixels), the Member's context, and the names the Tree has for the Place and its Parishes, of people who are not Living. No dates, Houses or relations from the Tree.
- **Leads:** suggestions are computed with each reading view and can be dismissed; keeping them as Research leads waits for add-research-leads (#16).
- **Names in a language:** every read Name has its BCP 47 language (decision #64); until #17, `la` becomes the Latin form, `de` the German form and any other language `other`.

## Open Questions

- Which reader gives the best Kurrent and Latin reading at an acceptable cost is settled by a small benchmark during implementation (task 1.2): two Claude models against Transkribus's public Kurrent models. Claude stays the default unless Transkribus reads clearly better. If it does, the switch, limits, marking and Draft flow stay as specified, and ADR 0011 is revisited for the new service. Transkribus only transcribes, so entries would still need structuring.

## Benchmark results

Not run yet (task 1.2): it needs the Owner's Anthropic API key, a Transkribus account and the 10 sample pages. `pnpm --filter @rodokmen/server bench:scan` writes the table (`summary.md`) that goes here.
