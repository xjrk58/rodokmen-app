# Design

## Context

Proposals, review and the log exist (`add-proposals-and-review`), and Agents have tokens (`add-agent-access`). Leads are the first records that change without review, so they sit beside the Tree, not in it: they don't count as evidence, they're never in a Citation, and the Living and relation rules don't apply to them.

## Goals / Non-Goals

**Goals:**
- One place where the next step of every open question is written down.
- A "not found" is recorded precisely enough to trust it.

**Non-Goals:**
- No task management (due dates, reminders, priorities beyond status).
- No AI suggestions yet.

## Decisions

### Leads live outside the review log
Leads have their own tables (`lead`, `lead_link`, `lead_search`) and their own change history (`lead_event`: who changed what, when). Running them through Proposals was considered; it would make writing a plan as slow as proving a fact, and plans need to be cheap.

### Erasure and Exports
A lead linked to a Living person is visible only to Members, like the rest of the Tree. Exports include leads, but drop links to Living people. Erasure of a Living person removes their links from leads, and deletes a lead that concerned only them.

### Gap finder is a pure rule plus a query
The server gathers, per Relative, which Events have Citations, their Parish over time, and the registers held for it. A pure function in `shared/` turns that into suggestions, and the rule is proved with LemmaScript (ADR 0009). Suggestions are computed nightly and after each accepted Proposal for the Persons it touched. A dismissal is stored by a stable key (gap kind + Person + Source), so the same gap doesn't come back.

### Link from Proposal to lead
A Proposal carries an optional `answersLeads` list. Accepting it marks those leads found in the same transaction; undoing it reopens them.

### Rules proved with LemmaScript
These pure functions in `shared/` are proved with `lsc check` (ADR 0009). Each lives in one file with everything its proof calls, and keeps optionals out of ordering comparisons (docs/verification.md, known issues). The queries that gather the inputs are the trust boundary.
- **The gap rule** (research-leads: Gap finder suggests leads): proved: every suggestion is a real gap of its kind (missing birth or baptism, unknown parents with known Parish and years, uncited marriage), every such gap is suggested, and a dismissed key is never suggested again.
- **Closing as not found** (research-leads: What was searched is recorded): proved: a lead closes as not found only with at least one search record.
- **Leads answered by a Proposal** (research-leads: Findings link back to leads): proved: accepting marks exactly the leads the Proposal answers as found, and undoing it reopens exactly those.
- **Leads in an Export** (exports: Living people are reduced in every Export): proved: an exported lead links to no Living person.

## As built (issue #16)

- **Who may write.** `mayDo` has two new actions: `writeLeads` (create and edit leads, add search records) for Members and Agents, and `decideSuggestions` (accept or dismiss a suggested lead) for Members only. Agents still never accept, reject, merge, undo or edit the Tree directly; the proof says so.
- **History.** `lead_event` keeps each change with author, time, kind (created, edited, searched, closed, answered, reopened) and the fields before and after. An edit names the version it was based on; a lead changed since answers 409, so two writers never overwrite each other unseen.
- **Registers in the Tree.** The gap finder names "the registers held for" a Parish, which the Tree did not know. A Source of type parish register now has an optional register coverage: its Parish, its kinds of entries (births, marriages, deaths) and its years, open where unknown (`source.register_*`, `register` in `createSource` and `setField`). It is a Tree field, so it changes through Proposals and is logged and undone with the Source. The Vault's `registers/` notes (kind, years) can map to it.
- **Gap finder inputs.** Only Relatives; a birth or baptism is an Event of that type with the Person as child; its years are those of its earliest and latest day, widened by one year on each side (a baptism may be entered the next year; "about 1801" gives 1798–1804); its Parishes are those of its Place in those years. A marriage is a Family's two partners and the Events where both are partners, read as the relation rule reads a partner link. A suggestion names each fitting register, else none; its archive is the register's holder, else the archive of the Place's Municipality (app/data/archives.json, by district).
- **When.** In the transaction of every accepted change, for the Persons it touched or whose relation it changed, and nightly over everyone (which also picks up a register added by a Proposal that touched no Person). The key is `kind:subject:source`, where the subject is the Person or, for a marriage, the Family.
- **Undo, merge, erasure.** A lead's link goes with its Person or Place, so an undo that removes a Person takes the link along. A link to a Person merged into another is read as the Person kept. Erasure and the Export use the entries in `server/src/leads/` (task 1.4).

## Risks / Trade-offs

- [Unreviewed text could hold mistakes] → leads hold plans, never facts; anything they find still goes through review.
- [Suggestion noise for large Trees] → only Relatives, never Unrelated people; dismissals stick.

## Open Questions

None that change the specs.
