# Spec Delta

## Purpose

Bring the Owner's Vault into the Tree once, faithfully and reviewably, without inventing anything and without the Vault ever entering the public repo.

## ADDED Requirements

### Requirement: Importer reads the Vault format
The importer SHALL read a Vault laid out as the earlier spec defined: `people/`, `houses/`, `places/`, `parishes/`, `registers/`, `sources/` and `attachments/`, with one Markdown note per record, YAML frontmatter and `[[id]]` links. It SHALL ignore `log/`, `plans/`, `data/` and any folder it doesn't know, and say so in its report.

#### Scenario: Unknown folder
- **WHEN** the Vault contains a folder `plans/`
- **THEN** the importer skips it and the report lists it as not imported

### Requirement: Dry run before anything is submitted
The importer SHALL offer a dry run that submits nothing. It reports how many records of each kind would be created and the planned Proposals. It also lists every field or value it can't map, every link to a missing note, every date that is not valid EDTF, and every image it can't read.

#### Scenario: Broken link
- **WHEN** a Person note's `father` points to `[[josef-novak-1770]]` and no such note exists
- **THEN** the dry run lists the note and the missing id, and the real run imports the Person without that father

#### Scenario: Nothing submitted
- **WHEN** the Owner runs the dry run
- **THEN** no Proposal, upload or Tree record is created

### Requirement: One Proposal per Source note
The importer SHALL submit one Proposal for each Source note. That Proposal holds the Citation and its images, and everything the entry supports: the Persons first seen there, their Names, the Events with their Roles, Places and Houses, and the Family links. Places with their Houses, Parishes, Estates and registers SHALL be submitted first, as their own Proposals.

#### Scenario: Baptism entry note
- **WHEN** a Source note is cited by a child's birth and baptism and by both parents' notes
- **THEN** one Proposal creates the baptism Event with child, father and mother Roles, links the parents' Family, and attaches the Citation with its scan

### Requirement: Every imported fact has provenance
Every fact the importer submits SHALL carry a Citation. A fact with its own Source note cites that Source. A fact without one cites a Family account Source for the Vault, given by the Owner and dated with the Vault commit, and the Citation's page names the note path.

#### Scenario: Fact from the note body only
- **WHEN** a Person note has a death date but no `source` for it
- **THEN** the death Event cites the Vault Source with the page `people/<id>.md` and low confidence

### Requirement: Confidence is carried over
The importer SHALL set each Citation's confidence from the Vault: confirmed becomes high, probable becomes normal, and hypothesis becomes low. When Persons citing the same Source note disagree, the Citation SHALL get the lowest of their values, and the dry run SHALL list the disagreement.

#### Scenario: Probable Person
- **WHEN** a Person with `confidence: probable` cites a register entry, and no other Person cites it
- **THEN** that Citation is imported with normal confidence

### Requirement: Tags become Labels or are derived
Vault tags that the Tree derives SHALL NOT be imported as Labels: `obec/…` follows from Places, and `nepribuzny` / `mozny-pribuzny` follow from the relation to the family. All other tags SHALL become Labels on the Person. The dry run SHALL list every Person whose computed relation differs from their Vault tag.

#### Scenario: Line tag
- **WHEN** a Person has the tags `obec/podulsany`, `line/novak` and `nepribuzny`
- **THEN** the Person gets the Label `line/novak` only

### Requirement: Note bodies become research notes
The body of each Vault note SHALL become the research notes of the record it describes, unchanged. The body of a Source note SHALL also become its Citation's transcription.

#### Scenario: Transcription kept
- **WHEN** a Source note body holds the Latin text of a baptism entry
- **THEN** the Citation's transcription and the Source record's research notes both hold that text

### Requirement: Scans and documents are uploaded
Images listed in a Source note's `scans` SHALL be uploaded as that Citation's images. PDF files SHALL be attached as documents to the Source. DOC files SHALL be converted to PDF once and attached the same way, keeping the original file as well. Files the importer can't read SHALL be listed in the report and skipped.

#### Scenario: Family document
- **WHEN** a family-document Source lists `RodRichteru.doc` and `RodRichteru.pdf`
- **THEN** the Source gets the PDF and the converted DOC as documents, with the original DOC kept

### Requirement: Living status is computed, not copied
The importer SHALL NOT copy the Vault's `living` field. The Tree computes Living status itself, and the dry run SHALL list every Person where the two differ.

#### Scenario: Vault says Living, dates say otherwise
- **WHEN** a Vault Person has `living: true` and a recorded death
- **THEN** the dry run lists the Person, and the Tree treats them as not Living

### Requirement: Re-runs submit only what is new
The importer SHALL keep a map from Vault ids to Tree ids. A second run SHALL submit only notes that are new or changed since the last accepted import, and SHALL never create a second Person for an id it has already imported.

#### Scenario: Second run after edits
- **WHEN** the Owner adds one Person note to the Vault and runs the importer again
- **THEN** one new Proposal is submitted and no existing Person is duplicated

### Requirement: Submitted as an Agent
The importer SHALL submit through the public API with an Agent token. Every imported Proposal is therefore labelled as Agent work, and all of them belong to one Import batch named after the run.

#### Scenario: Batch in the queue
- **WHEN** an import run finishes
- **THEN** the review queue shows one Import batch with its Proposal count and the Agent's name
