# Spec Delta

## ADDED Requirements

### Requirement: Research notes on records
Every Person, Family, Event, Place, House, Parish, Estate and Source SHALL be able to hold research notes in Markdown, changed through Proposals like any other field.

#### Scenario: Open question kept
- **WHEN** a Member records "baptism not found 1801–1803, check the neighbouring parish" on a Person
- **THEN** the note is shown on the person page and appears in the Person's history

### Requirement: Labels on Persons
A Person SHALL be able to carry any number of Labels. Labels SHALL be matched ignoring case and diacritics.

#### Scenario: Family line
- **WHEN** an Editor adds the Label "line/novak" to five Persons
- **THEN** a search filtered by that Label returns those five

### Requirement: Family roots
The Owner SHALL be able to mark Persons as Family roots. There SHALL be at least one Family root before the relation to the family is computed.

#### Scenario: First Family roots
- **WHEN** the Owner marks a couple as Family roots
- **THEN** every Person's relation to the family is computed from them

### Requirement: Relation to the family is computed
The system SHALL derive each Person's relation to the family (Relative, Possible relative or Unrelated person) from the Family links between them and the Family roots, as the glossary defines them, and SHALL never let it be entered by hand.

#### Scenario: Linked through a confirmed marriage
- **WHEN** a woman married a Family root's grandson and the marriage Citation has high confidence
- **THEN** she is a Relative

#### Scenario: Only a weak link
- **WHEN** a man is linked to the family only through a father link whose single Citation has low confidence
- **THEN** he is a Possible relative

#### Scenario: Godparent from the same village
- **WHEN** a Person appears only as godparent at a family baptism
- **THEN** that Person is an Unrelated person, because a Role at an Event is not a Family link

### Requirement: Relation follows the evidence
A link counts toward being a Relative only when at least one of its Citations has normal or higher confidence. The relation SHALL be recomputed whenever an accepted Proposal changes a Family link, a Citation's confidence or the Family roots.

#### Scenario: Evidence improves
- **WHEN** a Possible relative's only weak father link gets a second Citation of high confidence
- **THEN** the Person becomes a Relative after that Proposal is accepted
