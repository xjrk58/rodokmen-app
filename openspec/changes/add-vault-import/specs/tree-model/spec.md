# Spec Delta

## ADDED Requirements

### Requirement: Names carry a language tag
Each Name SHALL carry its type (birth, married, nickname or other) and, as a separate field, the language it is written in as a BCP 47 tag such as `cs`, `la`, `de` or `pl`, or no tag when the language is not known. There SHALL be no type per language: this replaces the Latin form and German form types of "Persons have Names" (`add-tree-backend`).

#### Scenario: Latin form at baptism
- **WHEN** a child with the primary Name "Jan Novák" was baptised as "Joannes Nowak"
- **THEN** the Latin spelling is kept as another Name with the tag `la`, the primary Name has the tag `cs`, and a search for "joannes" finds him

#### Scenario: Polish form without a new type
- **WHEN** a Member records the Polish spelling "Jan Nowak" of a Name
- **THEN** it is a Name of its type with the tag `pl`, and no new type is needed

#### Scenario: Language not known
- **WHEN** a Name is recorded and its language is not clear from the record
- **THEN** it is kept without a language tag

#### Scenario: Names recorded before the tags
- **WHEN** the Tree holds Names of the types "Latin form" and "German form" from before this change
- **THEN** they become Names of the type "other" with the tag `la` or `de`, their Proposals and history read the same way, and every other Name keeps its type without a tag

#### Scenario: Not a language tag
- **WHEN** a Name is proposed with the language "Latin" instead of a tag
- **THEN** the Proposal is refused, naming the language field

### Requirement: Research notes on records
Every Person, Family, Event, Place, House, Parish, Estate and Source SHALL be able to hold research notes in Markdown, changed through Proposals like any other field. Research notes and Labels state no fact about the family, so a Proposal that changes only them SHALL need no Citation.

#### Scenario: Open question kept
- **WHEN** a Member records "baptism not found 1801–1803, check the neighbouring parish" on a Person
- **THEN** the note is shown on the person page and appears in the Person's history

#### Scenario: A note needs no evidence
- **WHEN** a Contributor proposes only a research note and a Label for a Person
- **THEN** the Proposal is accepted for review without a Citation

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
