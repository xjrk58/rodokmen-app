# Spec Delta

## ADDED Requirements

### Requirement: A merged Event answers with the kept one
Reading an Event that was merged into another SHALL answer with a redirect to the Event it was merged into, as reading a merged Person does. When that Event was merged again since, the redirect SHALL name the Event that remains. An Event whose merge was undone SHALL answer as itself again.

#### Scenario: Old link to a merged marriage
- **WHEN** an Agent reads by id a marriage Event that an Editor merged into another
- **THEN** the API answers with a redirect to the remaining marriage Event, and following it returns that Event with the Roles and Citations of both
