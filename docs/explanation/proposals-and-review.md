# Proposals and review

Nobody changes the Tree on their own word. A Member or an Agent submits a Proposal, and an Editor accepts it before anyone else sees it (ADR 0001). This page explains why, and what follows from it.

## Why review

The Tree is written by several relatives, most of them not technical, and by AI assistants. The usual failure of a shared family tree is not vandalism but well-meant mistakes: a baptism attached to the wrong Jan Novák, the same great-grandmother entered twice, a year misread from a register. Once such a mistake is in, others build on it.

Review puts one careful person between a finding and the Tree. The cost is speed: a finding waits until an Editor gets to it. For a family archive that should still be right in fifty years, that is a good trade. Open editing, as in a wiki, was the alternative; it publishes faster and spreads errors faster.

Agents are the strongest case. An assistant can read registers tirelessly and propose a great deal, but it has no direct write access at all: it can only submit Proposals, within hourly limits, and its work is labelled as an Agent's.

## One finding, one Proposal

A Proposal carries everything one finding implies, and is accepted or rejected whole. A baptism entry, for example, is the child, the Event, the parents' and godparents' Roles, the Family link, and the Citation of the register page. Taking only half of that would leave the Tree in a state nobody found.

Every Proposal needs evidence: at least one Citation of a Source, such as a register entry, a document or a Family account, with a transcription. An Editor can then check the claim against the page rather than against the author's memory. An Editor's merge or undo states no new fact, so it needs no Citation; it is logged like any other Proposal. That holds for a merge of two Events too: a date or Place it fills in was already on the merged Event, with the Citations that move along. Nor does a correction of a Citation's note: the note says where and how the entry was read, such as the evidence class of a register entry, not what the entry says. A change to the Citation's transcription, page, day or confidence changes what the evidence claims, so it needs a Citation of its own.

An Editor may correct a Proposal before accepting it, for example a misread year. The history keeps both parts: what the author proposed, and what the Editor changed.

## Pending changes stay private

Until it is accepted, a Proposal is visible to its author and the Editors, not to other Members. A Contributor looking at a Person sees the Tree as accepted so far. This keeps unchecked claims from spreading through the family before anyone has looked at the evidence.

## Conflicts instead of merges

Each Proposal records the version of every record it was based on. If a record changed in the meantime, the Editor sees the Proposal's value and the current one side by side and chooses. The server never merges two versions by itself.

This is also what lets Members work offline: a Draft written in an archive's reading room is submitted later and may meet a changed Tree. Rather than build synchronisation, the most expensive part of many offline systems, conflicts go to the Editor, who is already looking (ADR 0003, [Offline and the app](offline.md)).

## Editors' own changes take the same path

An Editor may change the Tree directly. Even then the change is a Proposal, created and accepted in one step. So there is one path into the Tree: every change, reviewed or direct, lands in the same log with who made it, when and on which evidence.

## History and undo

Every accepted Proposal is kept, with each record it touched before and after (ADR 0006). That answers who changed what, when and why, for any record. It also makes undo simple to reason about: undoing a whole Proposal applies its inverse as a new Proposal, so even an undo is in the history. An undo is refused while later Proposals still depend on what it would remove; those have to be undone first.

Merging two records of the same Person works the same way: the merged Person is marked as merged into the kept one rather than deleted, so old links still lead somewhere and the merge can be undone.

A merged Event, by contrast, is deleted. Keeping it as a redirect would mean leaving it out of every list of Events: on person and family pages, the map, Places, Exports, the relation to the family. The log already says where it went, so its old address still leads to the Event that remains, and an undo brings it back from its logged snapshot. A merge of Events refuses to choose between facts: when the two disagree on the date, the Place or who was the child or the partners, the Editor first corrects one of them, with its evidence. Otherwise the Tree would take a value without the Citation that gives it.

The one exception to the append-only log is erasure, still to be built: when a Living relative asks to be removed, the Owner erases them from the log as well. A relative's wish to be forgotten outweighs a complete audit trail ([Privacy](privacy.md)).

## Import batches

The Vault comes into the Tree once, as thousands of Proposals from one Agent (ADR 0010). One by one, they would bury the review queue, and many of them depend on each other: a Person's baptism cites a Source that an earlier Proposal creates.

So the importer submits them into an Import batch. Within a batch a Proposal may refer to a record an earlier one creates, so they are submitted in order, and one that builds on a rejected Proposal is blocked rather than accepted against a gap. The review queue shows the batch as one entry. An Editor reads it in order or as a random sample, and the Owner alone may accept the whole batch after a confirmation. Even then each Proposal is accepted on its own, in its own transaction, and logged as the importing Agent's like any other; those that fail stay pending with the ones that build on them.

Such a batch needs far more requests than an Agent's hourly limit allows, so an Agent's requests to its own batches count against a separate, larger window. The limit on what it may do is unchanged: it still only proposes.

Research leads from the Vault link Persons and Places that exist only once the batch is accepted, so the importer creates them on a later run. Leads are not Proposals at all; why: [Research leads](research-leads.md).

## Where the rules are

Who may accept, reject, merge and undo, who may accept a whole Import batch, that every Proposal carries evidence (merges, undos, Research notes, Labels and Citations' notes state no fact, so need none), when two Events may be merged and what the kept one holds (`shared/src/event-merge.ts`), how conflicts are detected and when an undo is blocked are pure rules in `shared/src/rules.ts`, proved with LemmaScript ([verification](../verification.md)). The requirements are in the OpenSpec change `add-proposals-and-review`.
