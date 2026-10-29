# Spec Delta

## Purpose

Let a Living relative leave the Tree completely when they ask, even though the log is otherwise append-only.

## ADDED Requirements

### Requirement: Owner erases a Living person
The Owner SHALL be able to erase a Living person after a confirmation that names them. Erasure SHALL remove the Person, their Names, their Roles in Events, their Family links, and images where they are the only subject. Events that only they took part in SHALL also be removed.

#### Scenario: A cousin asks to be removed
- **WHEN** the Owner erases a Living cousin and confirms
- **THEN** search, person pages, pedigrees and family pins no longer show the cousin

#### Scenario: Not Living
- **WHEN** the Owner tries to erase a Person who is not Living
- **THEN** the system refuses and explains that only Living people can be erased

### Requirement: Erasure reaches the log
Erasure SHALL replace every log entry about the erased Person with a marker that says a record was erased and when, without their data. This is the only rewrite of the log the system allows.

#### Scenario: History after erasure
- **WHEN** a Member opens the history of the cousin's parents' Family
- **THEN** entries that involved the cousin show "erased record" and none of the cousin's data

### Requirement: Erasure reaches Exports
After an erasure, the next Export SHALL omit the Person and SHALL replace the history of `rodokmen-data` with a single fresh commit.

#### Scenario: Export history after erasure
- **WHEN** the Export runs after an erasure
- **THEN** `rodokmen-data` has a single commit, and no earlier commit containing the cousin remains reachable

### Requirement: Restores keep erased people erased
The system SHALL keep a list of erased record ids, without any personal data, and SHALL reapply every erasure after restoring a Backup. Backups older than the erasure SHALL be deleted when they reach the end of the 12-month retention.

#### Scenario: Restore from an old Backup
- **WHEN** a Backup taken before an erasure is restored
- **THEN** the erased Person is removed again before the system accepts any request
