# Research leads

A Research lead is a written next step of the research: a question, why it is worth asking, where to look, and what came of it. Leads sit beside the Tree, not in it. This page explains why, why they change without review, how the gap finder decides what to suggest, and which parts of this are proved. The fields and routes are in the [reference](../reference/research-leads.md); using them is in the how-to guides for [Members](../how-to/work-with-research-leads.md) and [Agents](../how-to/record-research-as-an-agent.md).

## Plans, not facts

The Tree holds what the evidence says about people, and every change to it is a reviewed Proposal with a Citation ([Proposals and review](proposals-and-review.md)). A lead says nothing about anyone: "Find Jan's baptism, probably in the Vrbice register, 1798 to 1804" is a plan. A wrong plan wastes an afternoon in an archive; it does not put a wrong grandparent into the family.

So leads skip review. Members and Agents write and change them at once, and every Member sees them straight away. What review gives the Tree, a record of who claimed what and when, a lead gets from its history instead: every change is kept with its author and time, and a search record is never edited afterwards.

Keeping leads out of the Tree also keeps the Tree's rules simple. The evidence rule, conflicts, history and undo are about facts; leads have their own, smaller rules.

Agents may write leads too. An assistant that reads registers for the family is most useful when it leaves notes of what it looked at, and a lead cannot change the Tree. The rule that an Agent never accepts, rejects, merges, undoes or edits the Tree directly is unchanged; writing leads is a separate action (`writeLeads`), and deciding on suggested leads (`decideSuggestions`) stays with Members.

## Negative results count

Most of genealogy is looking and not finding. A register searched page by page without result is worth as much to the next person as a find: it tells them where not to look again, or to look more carefully. In a notebook such results get lost.

A lead therefore keeps a search record for every look: which register or archive, which years and pages, when, who, and what was there. A lead can be closed as "not found" only with at least one search record, so "not found" always says what was searched.

## Findings go through the Tree's door

When a search finds something, the fact still enters the Tree as a Proposal, reviewed like any other. The Proposal names the leads it answers. Accepting it marks them found and links them to it, in the same transaction; undoing it later opens them again; rejecting it leaves them as they were. A lead is found only when the fact behind it is in the Tree, and stops being found when that fact is taken out.

## The gap finder

Some leads are obvious from the Tree itself: a great-grandmother with no baptism on record, a couple with no marriage entry. The gap finder looks for three such gaps:

- a Relative with no birth or baptism backed by a Citation;
- a Relative whose parents are unknown, where the Parish and years of the birth are known, so their baptism entry would name the parents;
- a Relative's marriage with no Citation.

It looks only at Relatives ([The relation to the family](relation-to-the-family.md)). Possible relatives and Unrelated people are often in the Tree because they stood as godparents or witnesses; their gaps are not the family's research, and suggesting them would bury the useful suggestions.

### Registers and years

A suggestion is useful when it says where to look. For that the gap finder has to know which registers a Parish kept, for which kinds of entries and which years. That is a fact about a Source, so it is in the Tree: a parish register's register coverage (its Parish, kinds and years), set through Proposals and logged like any other field.

For a gap, the gap finder takes the Parishes the Place belonged to at the time of the Event, and the registers of those Parishes that hold the right kind of entry. It widens the Event's years by a year on each side (a baptism may be entered the next year, and estimates are often off) and keeps the registers whose years meet them, naming the years both cover. A Relative born about 1801, with a register for 1784 to 1820, gets "check that register, 1798 to 1804". When no register in the Tree fits, the suggestion names the archive that holds the registers of the Place's Municipality, the same answer the map gives.

### When it runs, and what it never repeats

The gap finder runs in the transaction of every accepted Proposal, for the Persons it touched, so a new Relative's gaps appear when the Relative does. It also runs nightly over everyone, to catch what those runs cannot see, and to drop suggestions whose gap has gone.

Suggestions are kept apart from the leads until a Member decides. Each has a stable key made of the kind of gap, the Person or Family, and the register. A dismissed or accepted key is never suggested again, so a Member who decided once is not asked again every night.

## What is proved

The rules that must not quietly go wrong are proved with LemmaScript ([Proofs with LemmaScript](proofs.md)), and listed with their requirements in [verification](../verification.md):

- a lead may have the status "not found" only with a search record (`mayHaveStatus`);
- accepting a Proposal marks exactly the leads it names as found; undoing it reopens exactly those that nobody closed otherwise since; every other lead stays as it was (`leadsOnAccept`, `leadsOnUndo`);
- the gap finder suggests only real gaps of Relatives, with a register that fits or none when none fits, suggests every such gap whose key is undecided, and never a decided key (`suggestGaps`);
- in an Export, a lead keeps no link to a Living person (`exportedPersonLinks`), ready for when Exports exist;
- Agents and Members write leads, only Members decide on suggestions, and an Agent still never decides on the Tree (`mayDo`).

What the server gathers for these rules is tested, not proved: who is a Relative, which Events have Citations, the Parishes and years, the archive of a Municipality, and that the gap finder and the lead changes run when they should.
