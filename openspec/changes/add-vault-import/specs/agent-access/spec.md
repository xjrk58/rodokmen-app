# Spec Delta

## ADDED Requirements

### Requirement: Import batches have their own limit
An Agent's requests to its Import batches (opening a batch, submitting its Proposals, uploading their files and keeping the importer's id map) SHALL count against a separate hourly limit of 10,000 requests instead of the limits of "Rate limits", so that one run of the Vault importer fits. Requests over it SHALL be refused with a retry time. An Agent SHALL add Proposals only to batches it opened.

#### Scenario: Import of a large Vault
- **WHEN** the importing Agent submits its 61st Proposal within one hour into its Import batch
- **THEN** the Proposal is accepted for review, and the Agent's other Proposals in that hour are still limited to 60

#### Scenario: Another Agent's batch
- **WHEN** an Agent submits a Proposal into an Import batch another Agent opened
- **THEN** the system refuses it
