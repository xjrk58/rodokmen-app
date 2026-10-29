# Spec Delta

## Purpose

Define what the Tree records about people, places and evidence, and the rules those records follow, independent of how they are stored or shown.

## ADDED Requirements

### Requirement: Persons have Names
A Person SHALL have one or more Names, exactly one of them primary. Each Name SHALL hold given names, a surname, a type (birth, married, Latin form, German form, nickname or other), and the spelling exactly as found.

#### Scenario: Latin and German forms
- **WHEN** a Person was baptised as "Joannes Nowak" and later recorded as "Johann Nowak"
- **THEN** both are kept as Names next to the primary Name "Jan Novák"

### Requirement: Families link partners and children
A Family SHALL link at most two partners and any number of children. A Person MAY be a partner in several Families. A Person MAY be a child in more than one Family, and each child link SHALL say whether it is a birth, adoptive, foster or step relationship.

#### Scenario: Second marriage
- **WHEN** a widower remarries
- **THEN** he is a partner in two Families, and each Family keeps its own children

#### Scenario: Adopted child
- **WHEN** a child was adopted and the birth parents are known
- **THEN** the child is linked to the birth Family as "birth" and to the adoptive Family as "adoptive"

### Requirement: Events with Roles
Every dated fact SHALL be an Event with a type (birth, baptism, marriage, death, burial, residence, census or other), a date, an optional Place or House, and its Citations. Persons SHALL take part in an Event with a Role: child, father, mother, partner, godparent, witness, priest, deceased, informant or other.

#### Scenario: Baptism with godparents
- **WHEN** a baptism entry names the child, both parents, two godparents and the priest
- **THEN** one baptism Event links all six Persons, each with their Role

### Requirement: Dates allow uncertainty
Event dates SHALL use an EDTF subset: exact day, month, year, about (`1801~`), uncertain (`1801?`), between (`1801/1803`), before (`../1805`) and after (`1790/..`). The system SHALL order Events by the earliest date each could be.

#### Scenario: Approximate and open dates
- **WHEN** one Event is dated `1801~` and another `../1805`
- **THEN** both are stored as written and both can be sorted and filtered by year

### Requirement: Places, Houses and Municipalities
A Place SHALL have names with periods and languages (Czech, German, Latin), an optional location, and a link to the Municipality it lies in today. A House SHALL belong to one Place and carry its house numbers (čp.) with periods.

#### Scenario: Renumbered house
- **WHEN** a House was čp. 12 until 1805 and čp. 15 afterwards
- **THEN** an 1801 Event at čp. 12 and an 1850 Event at čp. 15 refer to the same House

### Requirement: Parishes and Estates over time
A Place SHALL link to the Parishes it belonged to and the Estates it was part of, each with a period.

#### Scenario: Village changes parish
- **WHEN** a village belonged to one Parish until 1857 and to another afterwards
- **THEN** an 1840 Event in that village is attributed to the first Parish and an 1870 Event to the second

### Requirement: Sources and Citations with confidence
A Citation SHALL point to one entry in one Source: the page or frame, a transcription in the original language, and when it was read. It SHALL carry a confidence of very low, low, normal, high or very high. An Event or a Name MAY have several Citations. A Family account Source SHALL record who gave the account and when.

#### Scenario: Oral history as evidence
- **WHEN** the only evidence for a marriage is what a grandmother recalled in 2026
- **THEN** its Citation points to a Family account Source naming her and the date, with a confidence the contributor chose

### Requirement: Living people are computed
The system SHALL treat a Person as Living when they were born within the last 100 years and have no recorded death, or when neither birth nor death is recorded. Living status SHALL be derived from Events, never entered by hand.

#### Scenario: No dates at all
- **WHEN** a Person has no birth and no death Event
- **THEN** the Person is Living

#### Scenario: Born more than 100 years ago
- **WHEN** a Person was born in 1920 and has no recorded death, and the current year is 2026
- **THEN** the Person is not Living

#### Scenario: Born less than 100 years ago
- **WHEN** a Person was born in 1950 and has no recorded death
- **THEN** the Person is Living

### Requirement: Images stay private
A Citation MAY hold page images and a Person MAY hold portraits. Images SHALL be reachable only by Members and Agents, through links that expire within 10 minutes.

#### Scenario: Shared image link
- **WHEN** someone opens an image link copied from the app 30 minutes later
- **THEN** the link no longer works
