# Spec Delta

## Purpose

Turn a register page a Member has into a checked Proposal quickly, without ever letting the machine's reading enter the Tree unchecked.

## ADDED Requirements

### Requirement: The Owner switches it on
Scan reading SHALL be off until the Owner switches it on. The switch SHALL say that scans are sent to Anthropic's API to be read. The Owner SHALL set a daily limit of readings per Member and see how many readings were made.

#### Scenario: Switched off
- **WHEN** scan reading is off and a Member opens the Propose flow
- **THEN** "Read a scan" is not offered

#### Scenario: Daily limit
- **WHEN** a Member has used their daily limit
- **THEN** a further reading is refused until the next day, and the Member can still fill in the forms by hand

### Requirement: Only scans the Member supplies
The system SHALL read only images a Member uploads, or images already attached to a Citation. It SHALL never download pages from archive portals.

#### Scenario: Portal link
- **WHEN** a Member pastes an archive viewer URL instead of an image
- **THEN** the app asks for the image itself and keeps the URL as the Citation's link

### Requirement: Reading drafts a Proposal
Given one or more scans and what the Member knows (Source or register, page, Place, years), the system SHALL produce:
- a transcription in the original language and spelling
- the entries it finds, each with its Persons, Names, Roles, Events with EDTF dates, and Houses

The result SHALL land as a Draft owned by the Member and SHALL never be submitted without the Member.

#### Scenario: Baptism page
- **WHEN** a Member uploads a page with three baptism entries
- **THEN** a Draft appears with three entries, each with the child, parents, godparents and priest in their Roles, the dates and house numbers, and the transcription

### Requirement: The machine's reading is marked and modest
Every value the reader produced SHALL be marked "read by AI" until the Member confirms or changes it. Citations it drafts SHALL have at most normal confidence. Where the reader can't read a value, it SHALL leave it empty and say so, never guess it.

#### Scenario: Faded house number
- **WHEN** a house number is illegible on the scan
- **THEN** the entry has no house number and a note that it was illegible

#### Scenario: Member confirms
- **WHEN** a Member corrects a misread surname and confirms the entry
- **THEN** the corrected value is no longer marked "read by AI", and the transcription keeps what the page shows

### Requirement: Names are matched, not duplicated
For each Person in a reading, the system SHALL suggest existing Persons the name probably refers to, with the reasons (name and variants, years, House, Place, Family). The Member SHALL confirm a match or choose a new Person. A new Person SHALL be created only when the Member chooses so.

#### Scenario: Known father
- **WHEN** a reading names the father "Joannes Nowak, colonus N. 12" and the Tree has Jan Novák of čp. 12 born 1770
- **THEN** the entry suggests Jan Novák with the reasons, and the Member links him with one tap

### Requirement: Reading suggests next steps
A reading SHALL suggest Research leads that follow from what it found, such as the parents' marriage, a godparent's House, or a later entry the page refers to. The Member SHALL accept or dismiss each one.

#### Scenario: Parents' marriage
- **WHEN** a reading finds both parents of a child born in 1801
- **THEN** it suggests a lead to find their marriage in the same Parish before 1801

### Requirement: Agents can request a reading
An Agent SHALL be able to request a reading of an uploaded scan through the MCP server. The result SHALL become an Agent Proposal that waits for review, with the same marking and confidence limits.

#### Scenario: Agent reads a scan
- **WHEN** an Agent requests a reading of a scan it uploaded
- **THEN** the review queue shows an Agent Proposal with its values marked "read by AI"
