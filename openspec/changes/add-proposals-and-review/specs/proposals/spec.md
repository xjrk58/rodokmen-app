# Spec Delta

## Purpose

Let Members and Agents put a finding into the Tree as one reviewable Proposal, with its evidence, whether they are online or not.

## ADDED Requirements

### Requirement: A Proposal carries one whole finding
A Proposal SHALL hold every change that one finding implies: new records, edits to existing records and new links between them. It SHALL be submitted, accepted or rejected as one unit.

#### Scenario: Baptism entry
- **WHEN** a Contributor records a baptism entry that names a new child, two known parents and two godparents
- **THEN** one Proposal adds the child and the baptism Event, links the parents' Family and the godparents with their Roles, and attaches the Citation with its page image

### Requirement: Evidence is required
A Proposal SHALL include at least one Citation. A Citation to a Family account Source counts as evidence.

#### Scenario: Missing evidence
- **WHEN** a Contributor tries to submit a Proposal without any Citation
- **THEN** the app refuses and asks for the register entry, a document or a Family account

### Requirement: Proposals record what they were based on
A Proposal SHALL record the version of every existing record it changes, as the Member saw it.

#### Scenario: Record changed in the meantime
- **WHEN** a record in a Proposal was changed by another accepted Proposal after the Member read it
- **THEN** the Proposal is marked as conflicting for the Editor, and nothing is overwritten silently

### Requirement: Drafts work offline
Members SHALL be able to write Drafts without network. Drafts SHALL survive closing the app, and a Draft SHALL be submitted only when the Member chooses to submit it while online.

#### Scenario: In the reading room
- **WHEN** a Member writes two Drafts in an archive without signal and later opens the app at home
- **THEN** both Drafts are still there and the app offers to submit them

### Requirement: Pending Proposals stay private
Until a Proposal is accepted, only its author and the Editors SHALL see it. Its author SHALL see its status: pending, accepted or rejected, with the Editor's note.

#### Scenario: Another Contributor looks
- **WHEN** a Contributor views a Person who has a pending Proposal from someone else
- **THEN** they see the Person as accepted so far, with no trace of the pending change

### Requirement: Editors' own changes are logged the same way
An Editor's direct change SHALL take effect at once and SHALL be logged exactly like an accepted Proposal, Citations included.

#### Scenario: Editor fixes a typo
- **WHEN** an Editor corrects a misspelt Name
- **THEN** the correction is visible immediately and appears in the record's history under the Editor's name
