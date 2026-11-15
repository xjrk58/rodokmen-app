# Spec Delta

## ADDED Requirements

### Requirement: Merging duplicate Events
An Editor SHALL be able to merge one Event into another of the same type, during review or at any other time, naming the version of each Event they saw. The merged Event's Roles and Citations SHALL move to the kept Event, except those it has already, and the merged Event SHALL then no longer exist. Contributors and Agents SHALL NOT merge Events. The merge SHALL be logged and undoable.

#### Scenario: Marriage recorded twice
- **WHEN** an Editor merges two marriage Events of Jan Novák and Marie Svobodová, each with both partner Roles and its own Citation, both dated 1801-11-20 at Kamenná Lhota
- **THEN** one marriage Event remains with both partner Roles once and both Citations, and the other Event no longer exists

#### Scenario: Undo an Event merge
- **WHEN** an Editor undoes the merge of two marriage Events
- **THEN** both Events exist again, each with its own Roles and Citations as before the merge, and the history shows the merge and the undo

#### Scenario: Contributor tries to merge Events
- **WHEN** a Contributor or an Agent submits a Proposal that merges two Events
- **THEN** the API refuses it with 403

### Requirement: A merged Event fills the gaps of the kept one
The kept Event SHALL keep its own date, Place or House and type detail, and SHALL take the merged Event's where it has none. The merged Event's description and research notes SHALL follow the kept Event's own, unless they are the same.

#### Scenario: Gaps are filled
- **WHEN** an Editor merges an undated burial at Kamenná Lhota into a burial of the same man dated 1850-03-02 with no Place
- **THEN** the remaining burial is dated 1850-03-02 at Kamenná Lhota, with the Citations of both

#### Scenario: Notes of both
- **WHEN** an Editor merges a baptism whose research notes say "Godmother's name hard to read" into one whose notes say "Entry checked against the index"
- **THEN** the remaining baptism's notes hold the second text, a blank line, then the first

### Requirement: Merging Events refuses disagreeing facts
A merge of Events SHALL be refused, naming each fact the two Events disagree on, and SHALL change nothing. They disagree when they are of different types; when both have a date, or both a Place or House, and these differ; when in any of the Roles child, father, mother, deceased and partner neither Event's Persons are all among the other's; when one Person would play two of these Roles; and when the joined description or research notes would be longer than the Tree allows.

#### Scenario: Different dates
- **WHEN** an Editor tries to merge a baptism dated 1812-02-11 into a baptism of the same child dated 1812-02-12
- **THEN** the merge is refused and names the date, and both Events stay as they were

#### Scenario: Two different children
- **WHEN** an Editor tries to merge the baptism of Matěj Zvonař into the baptism of his brother on the same day
- **THEN** the merge is refused and names the Roles

#### Scenario: Another partner
- **WHEN** an Editor tries to merge a marriage of Jan Novák and Anna Králová into his marriage to Marie Svobodová on the same day
- **THEN** the merge is refused and names the Roles
