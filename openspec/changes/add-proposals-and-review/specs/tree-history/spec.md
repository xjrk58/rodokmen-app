# Spec Delta

## Purpose

Keep a permanent account of who changed what in the Tree, when and on which evidence, and let Editors take back a whole change.

## ADDED Requirements

### Requirement: Append-only log of accepted changes
Every accepted Proposal, direct Editor change, merge and undo SHALL be logged with who made it, who accepted it, when, its Citations, and the value of every changed record before and after. Log entries SHALL never be edited. The only exception is erasure, defined in the erasure capability.

#### Scenario: Who changed a death date
- **WHEN** a Member asks who set a Person's death date
- **THEN** the log shows the Proposal, its author, the accepting Editor, the date and the Citation

### Requirement: History of a record
Members SHALL be able to see the full history of any record they can see, newest first.

#### Scenario: Person history
- **WHEN** a Member opens the history of a Person
- **THEN** they see each accepted change to that Person, newest first, with author and date

### Requirement: Undo a whole Proposal
An Editor SHALL be able to undo an accepted Proposal as a whole. The undo SHALL take effect at once, without a second review, and SHALL itself be logged. If later changes touched the same records, the Editor SHALL see those fields and decide on each before the undo applies.

#### Scenario: Undo a wrong merge
- **WHEN** an Editor undoes a merge of two different men
- **THEN** both Persons exist again with their own Events, and the log shows the undo

#### Scenario: Undo after later edits
- **WHEN** an Editor undoes a Proposal whose Person was edited again since
- **THEN** the Editor sees the later edits and chooses for each field before the undo completes
