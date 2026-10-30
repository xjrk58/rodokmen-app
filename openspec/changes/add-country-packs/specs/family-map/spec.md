# Spec Delta

## ADDED Requirements

### Requirement: Places in every Country pack
Family pins SHALL appear for Places anywhere in the world. For a Place inside a Country pack, the place sheet SHALL show that pack's archive answer and historical map links next to the family Events, loading the pack if needed. For a Place outside every pack, it SHALL say that no archive lookup covers it yet.

#### Scenario: Family Place in Galicia
- **WHEN** a Member opens the place sheet of a family Place near Tarnów
- **THEN** the sheet lists the Persons with their Events and years, the Poland pack's archive answer and its historical map links

#### Scenario: Family Place in Canada
- **WHEN** a Member opens the place sheet of a family Place in Canada
- **THEN** the sheet shows the family Events and says that no archive lookup covers this location yet
