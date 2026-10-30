# Spec Delta

## Purpose

Group the map's public reference data (gazetteer, archive rules, historical map layers) by country or part of a country, so the map can answer for places beyond the Czech lands, one well-checked region at a time.

## ADDED Requirements

### Requirement: Available Country packs
The system SHALL offer these Country packs: Czech lands, Austria, Poland, Bavaria and Saxony. Each pack SHALL cover one area, named in Czech and English. Pack areas SHALL NOT overlap.

#### Scenario: Pack list
- **WHEN** the reader opens the list of Country packs in settings
- **THEN** it shows Czech lands, Austria, Poland, Bavaria and Saxony, each with its size and whether it is on the device

### Requirement: Pack chosen by location
For any location, the system SHALL use the one Country pack whose area contains it. For a location inside no pack's area, the system SHALL say that no pack covers it and SHALL still show the location's coordinates.

#### Scenario: Point in Austria
- **WHEN** the reader taps a location in Upper Austria
- **THEN** the place sheet answers from the Austria pack

#### Scenario: Point in Hesse
- **WHEN** the reader taps a location in Hesse
- **THEN** the place sheet says that no Country pack covers this location yet, and shows its coordinates

### Requirement: Czech pack always present
The Czech lands pack SHALL be part of the app shell, available on first open and offline after one online visit, exactly as the Czech reference data is today.

#### Scenario: First open
- **WHEN** someone opens the app for the first time
- **THEN** search, archive lookup and historical maps work for the Czech lands without loading any other pack

### Requirement: Other packs load on demand
A pack other than the Czech lands SHALL load the first time the reader needs it. That happens when the reader pans the map into its area, taps there, chooses it in search, or opens a family Place there. The map SHALL stay usable while a pack loads.

#### Scenario: Pan into Poland
- **WHEN** the reader pans the map from Moravia into Silesia with the network on
- **THEN** the Poland pack loads, and its borders and archive regions appear without a page reload

#### Scenario: Pack needed while offline
- **WHEN** the reader taps a location in Bavaria while offline and the Bavaria pack is not on the device
- **THEN** the place sheet says the pack needs one online visit to load, and shows the coordinates

### Requirement: Removing a pack
The reader SHALL be able to remove any pack other than the Czech lands from the device. A removed pack SHALL load again on demand.

#### Scenario: Remove Poland
- **WHEN** the reader removes the Poland pack in settings
- **THEN** its stored data is deleted, the pack list shows it as not on the device, and tapping a location in Poland while online loads it again

### Requirement: Pack data is data, not code
Everything a pack knows SHALL live in that pack's data files: its area, gazetteer, archive regions, archives and portals, and map layers. Adding a German Land SHALL need only new data files, no code change.

#### Scenario: Add a Land
- **WHEN** a pack for another German Land is added with its data files
- **THEN** search, archive lookup and historical maps work there with no change to the app's code

### Requirement: Pack build checks
The build of a pack SHALL fail when any archive region is unnamed or has no archive for a kind of register the pack declares. It SHALL fail when any gazetteer entry lies outside the pack's area, when two packs' areas overlap, or when a single data file exceeds 1 MB.

#### Scenario: Region without an archive
- **WHEN** a pack's archive list leaves one district without a Catholic register holder
- **THEN** the build fails and names the district and the missing kind of register

#### Scenario: Oversized gazetteer
- **WHEN** a gazetteer file would be larger than 1 MB
- **THEN** the build fails and names the file, so the gazetteer is split by first-level unit

### Requirement: Sources and licences are attributed
Each pack SHALL record the public sources it was built from, with their licence and retrieval date. The app SHALL show the attribution of every pack in use.

#### Scenario: Attribution
- **WHEN** the reader opens "About the data" with the Poland pack loaded
- **THEN** the sources of the Poland pack are listed with their licences, next to those of the Czech pack
