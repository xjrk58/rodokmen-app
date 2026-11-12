# Spec Delta

## Purpose

Tell Editors when there is something to review, and tell Contributors what happened to their work, without flooding anyone's inbox.

## ADDED Requirements

### Requirement: Daily digest for Editors
Once a day, the system SHALL email each Editor a digest of Proposals pending review. It SHALL send nothing on days with none pending.

#### Scenario: Quiet day
- **WHEN** no Proposals are pending at digest time
- **THEN** no digest email is sent

#### Scenario: Busy day
- **WHEN** four Proposals are pending at digest time
- **THEN** each Editor receives one email listing the four with links into the review queue

### Requirement: Outcome for the author
When a Proposal is accepted or rejected, the system SHALL email its author the outcome and the Editor's note, in the author's language. Agents receive outcomes through the API instead of email. Outcome emails SHALL go only to the authors of Proposals submitted for review: an Editor's own changes, merges and undos, and a submitted Proposal its author decided, SHALL send none.

#### Scenario: Rejected Proposal
- **WHEN** an Editor rejects a Contributor's Proposal with a note
- **THEN** the Contributor receives an email in their language with the outcome and the note

#### Scenario: Editor's own changes
- **WHEN** an Editor makes a direct change, merges two Persons, undoes a Proposal, or accepts a Proposal they submitted themselves
- **THEN** no outcome email is sent to anyone

### Requirement: Members can mute outcome emails
A Member SHALL be able to turn off outcome emails. Editors' digest emails SHALL stay on while they are Editors.

#### Scenario: Muted Contributor
- **WHEN** a Contributor who turned off outcome emails has a Proposal accepted
- **THEN** no email is sent, and the outcome still shows in the app
