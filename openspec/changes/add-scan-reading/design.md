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

## Risks / Trade-offs

- [Private scans leave our servers] → off by default, an Owner decision stated in the switch, display copies or crops only, never Citations' metadata about Living people beyond the names on the page (ADR 0011).
- [Misreadings look plausible] → "read by AI" marking, confidence capped, a Member check before submission, then Editor review.
- [Cost] → a daily limit per Member and a usage view for the Owner.

## Open Questions

- Which Claude model gives the best Kurrent and Latin reading at an acceptable cost is settled by a small benchmark during implementation (task 1.2). This changes configuration only.
