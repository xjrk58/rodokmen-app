# Spec Delta

## Purpose

Let the reader find any Municipality in the Czech Republic by typing part of its name, in any spelling with or without diacritics, and jump to it on the map.

## ADDED Requirements

### Requirement: Search Municipalities by name
The system SHALL search all Municipalities of the Czech Republic by name and show matches as the reader types, each with its district so that equal names can be told apart.

#### Scenario: Same name in several districts
- **WHEN** the reader types "Adamov"
- **THEN** the results list every Municipality named Adamov, each labelled with its district

### Requirement: Diacritics and case do not matter
Matching SHALL ignore letter case and diacritics in both the query and the names.

#### Scenario: Typing without diacritics
- **WHEN** the reader types "zdar"
- **THEN** the results include "Žďár nad Sázavou"

### Requirement: Jump to a result
Choosing a result SHALL centre the map on the Municipality and open its place sheet.

#### Scenario: Choose a result
- **WHEN** the reader taps a search result
- **THEN** the map centres on that Municipality and its place sheet opens

### Requirement: Search works offline
Search SHALL work without network once the app has been opened online once.

#### Scenario: Offline search
- **WHEN** the reader searches with the phone in airplane mode after an earlier online visit
- **THEN** results appear as they do online
