# Spec Delta

## ADDED Requirements

### Requirement: Proposals in an Import batch build on each other
A Proposal in an Import batch MAY refer to records created by earlier Proposals of the same batch. Such a Proposal SHALL be accepted only after the Proposals it builds on. When one of them is rejected, every Proposal that builds on it SHALL be marked blocked, with the reason, until the Editor rejects it too or corrects it.

#### Scenario: Out of order
- **WHEN** an Editor tries to accept a batch Proposal whose Person is created by a pending earlier Proposal
- **THEN** the system refuses and names the earlier Proposal to decide first

#### Scenario: Rejected foundation
- **WHEN** the Owner rejects the Proposal that creates a Place
- **THEN** the batch Proposals with Events at that Place are marked blocked, naming the rejected Proposal

### Requirement: Accept a whole Import batch
The Owner SHALL be able to accept all pending Proposals of an Import batch in one action, after a confirmation that states how many Proposals and records it covers. The system SHALL apply them in batch order. Each Proposal is accepted or fails on its own, is logged as accepted by the Owner, and failures are listed at the end without stopping the rest.

#### Scenario: Batch with one conflict
- **WHEN** the Owner accepts an Import batch of 500 Proposals, one of which conflicts with an Editor's later change
- **THEN** 499 are accepted in order, the conflicting one and any that build on it stay pending, and the Owner sees the list

#### Scenario: Editor cannot accept a batch
- **WHEN** an Editor who is not the Owner tries to accept a whole Import batch
- **THEN** the system refuses; the Editor can still accept its Proposals one by one

### Requirement: Batch view in the review queue
The review queue SHALL show each Import batch as one entry with its author, size and progress (accepted, pending, blocked, rejected), and SHALL let a reviewer open its Proposals in batch order or sample them.

#### Scenario: Spot-checking
- **WHEN** the Owner opens an Import batch and asks for a sample
- **THEN** 20 Proposals chosen at random from the pending ones are shown, each openable in full
