# Spec Delta

## ADDED Requirements

### Requirement: Agents write Research leads
An Agent token SHALL allow creating and editing Research leads and adding search records, under the Agent's name. It SHALL still not allow accepting, rejecting, merging, undoing or direct edits of the Tree.

#### Scenario: Agent records a negative search
- **WHEN** an Agent checks a register and finds nothing
- **THEN** it closes the lead as not found with a search record, and the lead shows the Agent as author
