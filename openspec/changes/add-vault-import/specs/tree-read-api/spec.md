# Spec Delta

## ADDED Requirements

### Requirement: Filter by relation to the family
Person search and the map Events query SHALL accept a filter on the relation to the family (Relatives, Possible relatives, Unrelated people, in any combination). Without the filter, all Persons SHALL be returned, and each result SHALL state its relation.

#### Scenario: Family only
- **WHEN** the app searches "novák" with the filter Relatives and Possible relatives
- **THEN** no Unrelated person is in the results

#### Scenario: Everyone in a village
- **WHEN** an Agent asks for map Events in one village without a filter
- **THEN** Events of Unrelated people are included, each marked with its relation

### Requirement: Filter by Label
Person search SHALL accept one or more Labels and return only Persons carrying all of them.

#### Scenario: Two Labels
- **WHEN** a Member searches with the Labels "line/novak" and "emigrated"
- **THEN** only Persons with both Labels are returned
