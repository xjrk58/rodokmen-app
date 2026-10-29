# Spec Delta

## Purpose

Let AI agents read the Tree and submit Proposals under accounts the Owner controls, and never let them change the Tree directly.

## ADDED Requirements

### Requirement: Agent accounts belong to the Owner
Only the Owner SHALL create Agent accounts. Each Agent SHALL have a name and one or more tokens. A token SHALL be shown in full only once, when it is created, and the Owner SHALL be able to revoke it at any time.

#### Scenario: Revoking a token
- **WHEN** the Owner revokes an Agent's token
- **THEN** the next request with that token is refused with 401

### Requirement: Read and propose only
An Agent token SHALL allow reading the Tree and submitting Proposals, and nothing else. Accepting, rejecting, merging, undoing, direct edits and account management SHALL be refused.

#### Scenario: Agent tries to accept its own Proposal
- **WHEN** an Agent sends an accept request for a Proposal
- **THEN** the API refuses it with 403 and the Proposal stays pending

### Requirement: Agent work is labelled
Proposals from an Agent SHALL show the Agent's name and an Agent badge in the review queue and in record history.

#### Scenario: Reviewing an Agent Proposal
- **WHEN** an Editor opens a Proposal submitted by an Agent
- **THEN** the Agent's name and badge appear next to the author

### Requirement: MCP server
An MCP server SHALL let an assistant, authenticated with an Agent token, search Persons and Places, read records, read ancestors and descendants, and submit Proposals. It SHALL offer nothing the Agent token is not allowed to do through the API.

#### Scenario: Assistant submits a finding
- **WHEN** an assistant connected through the MCP server submits a baptism Proposal with its Citation
- **THEN** the Proposal appears in the review queue labelled with the Agent's name

### Requirement: Rate limits
Each Agent SHALL be limited to 60 submitted Proposals and 1,000 read requests per hour. Requests over the limit SHALL be refused with a retry time.

#### Scenario: Runaway agent
- **WHEN** an Agent submits its 61st Proposal within one hour
- **THEN** the API answers 429 with the time after which it may submit again
