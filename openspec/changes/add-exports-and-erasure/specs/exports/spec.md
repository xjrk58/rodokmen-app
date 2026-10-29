# Spec Delta

## Purpose

Keep a readable, portable copy of the Tree outside the server, and protect Living people in every copy that leaves it.

## ADDED Requirements

### Requirement: Nightly Export to rodokmen-data
Every night the system SHALL write an Export of the Tree to the private `rodokmen-data` repo. The Export holds one Markdown note per Person, Family, Place, House, Parish, Estate and Source, plus one GEDCOM 5.5.1 file. It SHALL commit only when something changed.

#### Scenario: Night without changes
- **WHEN** no Proposal was accepted since the last Export
- **THEN** no new commit is made

#### Scenario: Night after changes
- **WHEN** Proposals were accepted during the day
- **THEN** one commit updates the affected notes and the GEDCOM file

### Requirement: The Export is one-way
Changes made directly in `rodokmen-data` SHALL never flow back into the Tree. The next Export SHALL overwrite them.

#### Scenario: Someone edits a note in the repo
- **WHEN** a note in `rodokmen-data` is edited by hand
- **THEN** the Tree is unaffected and the next Export restores the note

### Requirement: Living people are reduced in every Export
In every Export, a Living person SHALL appear with name, sex, relationships to other Persons and birth year only. Exact birth dates, all other Events, Places, Houses, Citations, notes and images SHALL be left out.

#### Scenario: Living grandchild in GEDCOM
- **WHEN** the Export includes a Person born in 2010
- **THEN** the GEDCOM file holds the name, sex, family links and `BIRT DATE 2010`, with no place and no other facts

### Requirement: No images in any Export
No Export SHALL contain image files or links to images.

#### Scenario: Citation with a page image
- **WHEN** a Citation with a page image is exported
- **THEN** the Export holds the Citation's text and confidence, and no image

### Requirement: GEDCOM download for the Owner
The Owner SHALL be able to download a GEDCOM file of the Tree at any time, reduced in the same way as the nightly Export.

#### Scenario: Sharing with a relative's program
- **WHEN** the Owner downloads the GEDCOM file
- **THEN** it imports into a standard genealogy program with Living people reduced
