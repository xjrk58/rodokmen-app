# Spec Delta

## Purpose

Give Editors one place, usable on a phone, to check each Proposal against its evidence and decide on it.

## ADDED Requirements

### Requirement: Review queue
Editors SHALL see pending Proposals oldest first. Each shows its author, whether the author is an Agent, every change it makes compared with the current Tree, and its Citations with images.

#### Scenario: Opening the queue
- **WHEN** an Editor opens the review queue with three pending Proposals
- **THEN** they see the three, oldest first, each with its author and a summary of its changes

### Requirement: Decide on the whole Proposal
An Editor SHALL accept or reject a Proposal as a whole and MAY add a note either way. Before accepting, the Editor MAY correct the Proposal; the corrections are recorded as the Editor's.

#### Scenario: Accept with a correction
- **WHEN** an Editor fixes a misread year in a Proposal and accepts it
- **THEN** the Tree changes with the corrected year, and the history shows both the author's and the Editor's part

#### Scenario: Reject with a note
- **WHEN** an Editor rejects a Proposal with the note "wrong parish, see 1820 register"
- **THEN** nothing in the Tree changes and the author sees the note

### Requirement: Conflicts are resolved by the Editor
When a Proposal is based on an older version of a record, the Editor SHALL see the Proposal's version and the current version side by side and choose per field before accepting.

#### Scenario: Two Proposals for the same date
- **WHEN** a second Proposal changes a birth date that an accepted Proposal already changed
- **THEN** the Editor sees both values and picks one before the second Proposal can be accepted

### Requirement: Merging duplicate Persons
An Editor SHALL be able to merge two Persons into one, during review or at any other time. All Names, Events, Roles, Family links and Citations move to the remaining Person. The merge SHALL be logged and SHALL be undoable.

#### Scenario: Same man added twice
- **WHEN** an Editor merges two records of the same man, one from his baptism and one from his marriage
- **THEN** one Person remains with both Events, and the other record no longer appears in search

### Requirement: Contributors never accept or merge
Contributors and Agents SHALL NOT accept, reject or merge anything.

#### Scenario: Contributor tries to accept
- **WHEN** a Contributor's request tries to accept a Proposal
- **THEN** the API refuses it with 403
