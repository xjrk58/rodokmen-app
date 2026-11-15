# Spec Delta

## ADDED Requirements

### Requirement: Marriage Events imported twice are listed until merged
For a marriage an earlier importer gave two Events, the report SHALL list the pair while both Events exist. It SHALL name the Event to keep, the one later runs refer to, and link a spouse's person page. The importer SHALL NOT merge the Events itself: a merge of Events is an Editor's. Once the other Event is merged into the one to keep, a later run SHALL no longer list the pair.

#### Scenario: After the Owner merged a pair
- **WHEN** an earlier import gave a marriage two Events, the Owner merged the other one into the one to keep, and the Owner runs the importer again
- **THEN** the report no longer lists that pair, and the run submits nothing for it
