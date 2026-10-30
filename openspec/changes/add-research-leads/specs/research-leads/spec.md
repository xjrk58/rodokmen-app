# Spec Delta

## Purpose

Keep the family's research plans and their results in the Tree, so open questions are visible, nobody repeats a search, and every finding can be traced back to the question that led to it.

## ADDED Requirements

### Requirement: Research leads
A Research lead SHALL hold a question and its reason. It MAY hold where to look (archive, register Source, years, pages), the Persons and Places it concerns, and who is working on it. Its status SHALL be open, in progress, found or not found.

#### Scenario: Writing a lead
- **WHEN** a Member writes "Find Jan's baptism: born about 1801 in Dolní Lhota, check N Horní Lhota 1784–1820"
- **THEN** a lead exists with that question, the register, the years and Jan linked, with status open

### Requirement: Leads need no review
Members and Agents SHALL create and edit Research leads directly. Changes to a lead SHALL be recorded with author and time, but SHALL NOT go through Proposals, because a lead states no fact about the family.

#### Scenario: Contributor adds a lead
- **WHEN** a Contributor writes a new lead
- **THEN** every Member sees it at once, with the Contributor as its author

### Requirement: What was searched is recorded
Each attempt on a lead SHALL be recorded as a search record: the Source or archive, the years and pages looked at, the date, who looked, and what was found. A lead SHALL close as "not found" only with at least one search record.

#### Scenario: Negative result
- **WHEN** a Member closes a lead as not found after checking pages 1–60 of a register for 1798–1805
- **THEN** the lead shows that search, and anyone planning the same search sees it was done

### Requirement: Findings link back to leads
A Proposal MAY name the leads it answers. When such a Proposal is accepted, those leads SHALL be marked found, linking to the Proposal. If it is rejected, they SHALL stay as they were.

#### Scenario: Lead answered
- **WHEN** an Editor accepts a baptism Proposal that names the lead for Jan's baptism
- **THEN** the lead shows found, with a link to the accepted Proposal

### Requirement: Gap finder suggests leads
The system SHALL suggest leads from gaps in the Tree: a Relative with no birth or baptism Citation, a Relative whose parents are unknown while their Parish and birth years are known, and a marriage without a Citation. Where the Parish and years allow it, a suggestion SHALL name the archive and register Source to check. Suggestions SHALL be shown separately until a Member accepts or dismisses them, and a dismissed gap SHALL not be suggested again.

#### Scenario: Missing baptism
- **WHEN** a Relative born about 1801 in a Place of a known Parish has no baptism Citation, and the Tree has that Parish's birth register for 1784–1820
- **THEN** a suggested lead names that register and the years 1798–1804

#### Scenario: Dismissed suggestion
- **WHEN** a Member dismisses a suggested lead
- **THEN** the gap finder does not suggest the same lead again

### Requirement: Leads where people look
Leads SHALL appear on the person pages and place sheets they concern, and in a list filterable by status, Place, archive and who is working on them.

#### Scenario: Village sheet
- **WHEN** a Member opens the place sheet of a village with two open leads
- **THEN** the sheet lists both leads with their questions and status
