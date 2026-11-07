# Spec Delta

## Purpose

Bring the Owner's Vault into the Tree once, faithfully and reviewably, without inventing anything and without the Vault ever entering the public repo.

## ADDED Requirements

### Requirement: Importer reads the Vault format
The importer SHALL read a Vault laid out as the earlier spec defined: `people/`, `houses/`, `places/`, `parishes/`, `registers/`, `sources/` and `attachments/`, with one Markdown note per record, YAML frontmatter and `[[id]]` links. It SHALL ignore `data/` and any folder it doesn't know, and say so in its report.

#### Scenario: Unknown folder
- **WHEN** the Vault contains a folder `data/`
- **THEN** the importer skips it and the report lists it as not imported

### Requirement: Research logs and plans become Research leads
Each note in `plans/` SHALL become an open Research lead. Each search a `log/` note records SHALL become a search record on a Research lead, found or not found as the log says. Lead text keeps the note's wording, and the lead links the Persons and Places the note links.

#### Scenario: Negative search in a log
- **WHEN** a log note says registers N 1784–1820 pages 1–60 were searched for a baptism and nothing was found
- **THEN** a Research lead exists, closed as not found, with that search record

#### Scenario: Long log note
- **WHEN** a log note holds 10,000 characters
- **THEN** its Research lead's reason holds all of them

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

#### Scenario: A Source note too big for one Proposal
- **WHEN** the Proposal of a Source note would hold more operations than the API allows in one Proposal
- **THEN** the importer submits it as consecutive Proposals under the limit, cut between Persons, each with a Citation: the note's Citation is created in the first and attached by a batch reference in the others

#### Scenario: Baptism entry note
- **WHEN** a Source note is cited by a child's birth and baptism and by both parents' notes
- **THEN** one Proposal creates the baptism Event with child, father and mother Roles, links the parents' Family, and attaches the Citation with its scan

### Requirement: Every imported fact has provenance
Every fact the importer submits SHALL carry a Citation. A fact with its own Source note cites that Source. A fact without one cites a Family account Source for the Vault, given by the Owner and dated with the Vault commit, and the Citation's page names the note path.

#### Scenario: Fact from the note body only
- **WHEN** a Person note has a death date but no `source` for it
- **THEN** the death Event cites the Vault Source with the page `people/<id>.md` and low confidence

#### Scenario: A marriage both spouses record without a Source note
- **WHEN** two spouses' Person notes both record their marriage with the same date and Place and no Source note
- **THEN** one marriage Event has both partner Roles and cites the Vault Source once with each note's path

#### Scenario: Spouses who disagree
- **WHEN** two spouses' Person notes record their marriage without a Source note and with different dates or Places
- **THEN** each note gives a marriage Event of its own, and the dry run lists the pair

### Requirement: A fact citing a register note cites the register
A fact whose `source` links a register note instead of an entry note SHALL cite that register's Source as well as the Vault Source. There SHALL be one such Citation per register and Person note, with no page, the note path in its note, the Person note's frontmatter as transcription, and the Person's confidence.

#### Scenario: Fact citing a register note
- **WHEN** a Person note with `confidence: probable`, a father and a mother has a baptism whose `source` is the register note `[[n-vrbice-1784-1820]]`, not an entry note
- **THEN** the baptism cites that register's Source with normal confidence and no page, beside its Citation of the Vault Source, and the parent links that rest on the baptism are strong

### Requirement: Confidence is carried over
The importer SHALL set each Citation's confidence from the Vault: confirmed becomes high, probable becomes normal, and hypothesis becomes low. When Persons citing the same Source note disagree, the Citation SHALL get the lowest of their values, and the dry run SHALL list the disagreement.

#### Scenario: Probable Person
- **WHEN** a Person with `confidence: probable` cites a register entry, and no other Person cites it
- **THEN** that Citation is imported with normal confidence

### Requirement: Tags become Labels or are derived
Vault tags that the Tree derives SHALL NOT be imported as Labels: `obec/…` follows from Places, and `nepribuzny` / `mozny-pribuzny` follow from the relation to the family. All other tags SHALL become Labels on the Person. The dry run SHALL list every Person whose computed relation differs from their Vault tag.

#### Scenario: Line tag
- **WHEN** a Person has the tags `obec/dolni-lhota`, `line/novak` and `nepribuzny`
- **THEN** the Person gets the Label `line/novak` only

### Requirement: Note bodies become research notes
The body of each Vault note SHALL become the research notes of the record it describes, unchanged. The body of a Source note SHALL also become its Citation's transcription. Below the body, under "From the Vault, not mapped:", the research notes SHALL keep each field the Tree has no place for, one line each as written. A register entry has no research notes, so its lines SHALL go in its Citation's note, below the note path.

#### Scenario: Transcription kept
- **WHEN** a Source note body holds the Latin text of a baptism entry
- **THEN** the Citation's transcription and the Source record's research notes both hold that text

#### Scenario: Field the Tree has no place for
- **WHEN** a Person note has `occupation: [sedlák]` and a body
- **THEN** the Person's research notes hold the body unchanged and, below it, the line `occupation: sedlák`, and the dry run still lists the field

#### Scenario: Evidence class of a register entry
- **WHEN** a Source note of a register entry has `evidence: A`
- **THEN** its Citation's note holds `Evidence class: A` below the note path

### Requirement: Scans and documents are uploaded
Images listed in a Source note's `scans` SHALL be uploaded as that Citation's images. PDF files SHALL be attached as documents to the Source. DOC files SHALL be converted to PDF once and attached the same way, keeping the original file as well. Files the importer can't read SHALL be listed in the report and skipped.

#### Scenario: Family document
- **WHEN** a family-document Source lists `RodNovaku.doc` and `RodNovaku.pdf`
- **THEN** the Source gets the PDF and the converted DOC as documents, with the original DOC kept

### Requirement: Living status is computed, not copied
The importer SHALL NOT copy the Vault's `living` field. The Tree computes Living status itself, and the dry run SHALL list every Person where the two differ.

#### Scenario: Vault says Living, dates say otherwise
- **WHEN** a Vault Person has `living: true` and a recorded death
- **THEN** the dry run lists the Person, and the Tree treats them as not Living

### Requirement: Presumed death when birth is provably long ago
A Person with no death or burial and no birth or baptism date of their own SHALL get a death Event without a date, citing the Vault Source, when a chain of these bounds proves them born more than 125 years before the run: at least 12 years before their own marriage; a parent at least 12 years before their child; a child at most a year after a parent's death and at most 60 years after their mother. Its description SHALL state the chain; the dry run SHALL list them.

#### Scenario: Married long ago, no dates of his own
- **WHEN** a Person note records a marriage in 1803 and no birth, baptism, death or burial
- **THEN** the Person gets a death Event without a date whose description says born by 1791 at the latest, and the Tree does not treat them as Living

#### Scenario: A child's birth tightens the bound
- **WHEN** that Person's son was born in 1801
- **THEN** the description says born by 1789 at the latest

#### Scenario: Married within 125 years
- **WHEN** a Person note records a marriage in 1925 and no other date
- **THEN** no death Event is added, and the Tree treats the Person as Living

#### Scenario: No dates, no relatives
- **WHEN** a Person note has no date and no parent, child or spouse
- **THEN** no death Event is added

#### Scenario: Presumed death after an earlier import
- **WHEN** an earlier import gave such a Person no death Event, and the Owner runs the importer again
- **THEN** the run submits the death Event for them if the Tree still treats them as Living, and leaves them out otherwise

### Requirement: Re-runs submit only what is new
The importer SHALL keep a map from Vault ids to Tree ids. A second run SHALL submit only notes that are new or changed since the last accepted import, and SHALL never create a second Person for an id it has already imported. A record a note gives that an earlier run did not import, such as a Citation an earlier version of the importer did not create, SHALL come in on the next run and refer to the records already imported.

#### Scenario: Second run after edits
- **WHEN** the Owner adds one Person note to the Vault and runs the importer again
- **THEN** one new Proposal is submitted and no existing Person is duplicated

#### Scenario: Register Citation after an earlier import
- **WHEN** an earlier import gave a baptism that cites a register note only its Citation of the Vault Source, and the Owner runs the importer again
- **THEN** it submits one Proposal for that Person note, which creates the register Citation and attaches it to the baptism already in the Tree and does nothing else; once it is accepted the parent links that rest on the baptism are strong, and a further run submits nothing

#### Scenario: Marriage imported twice
- **WHEN** an earlier import gave a marriage both spouses record without a Source note one Event per spouse, and the Owner runs the importer again
- **THEN** the second spouse's Citation is attached to the first Event, no Event is created or removed, and the report lists both Events for the Owner

### Requirement: Re-runs change only what an earlier run wrote
A record an earlier run wrote and a newer importer writes otherwise, such as a lead's reason an earlier importer cut short, SHALL be changed by a later run only while it holds exactly what that run wrote. Otherwise the record SHALL stay as it is, and the report SHALL list it for the Owner.

#### Scenario: Lead cut by an earlier import
- **WHEN** an earlier import gave the lead of a long log note the first 4,000 characters of the note, and the Owner runs the importer again
- **THEN** the lead gets the whole note if it still holds exactly those 4,000 characters, and otherwise the report lists it and the lead stays as it is

#### Scenario: Research notes imported before the fields not mapped
- **WHEN** an earlier import wrote a record's research notes without the fields the Tree has no place for, and the Owner runs the importer again
- **THEN** a Proposal adds them below the body if the notes still hold exactly what that import wrote; notes the Owner changed since, and the Citation notes of register entries, are listed in the report and stay as they are

### Requirement: Submitted as an Agent
The importer SHALL submit through the public API with an Agent token. Every imported Proposal is therefore labelled as Agent work, and all of them belong to one Import batch named after the run.

#### Scenario: Batch in the queue
- **WHEN** an import run finishes
- **THEN** the review queue shows one Import batch with its Proposal count and the Agent's name
