# Spec Delta

## Purpose

Decide which archive holds the parish registers for any location in the Czech lands, and send the reader straight to that archive's online register viewer.

## ADDED Requirements

### Requirement: Archive by district
The system SHALL assign every location inside the Czech Republic to exactly one register-holding archive, based on the district (okres) the location lies in, using the archive regions listed in `app/data/archives.json`.

#### Scenario: Location in an East Bohemian district
- **WHEN** the reader asks for the archive of a location in the Pardubice district
- **THEN** the system answers SOA Zámrsk

#### Scenario: Districts that are easy to get wrong
- **WHEN** the reader asks for locations in the Havlíčkův Brod, Pelhřimov and Vsetín districts
- **THEN** the system answers SOA Zámrsk, SOA Třeboň and Zemský archiv Opava respectively

#### Scenario: Prague
- **WHEN** the reader asks for a location inside the city of Prague
- **THEN** the system answers Archiv hlavního města Prahy, not SOA Praha

#### Scenario: Outside the Czech Republic
- **WHEN** the reader asks for a location outside the Czech Republic
- **THEN** the system says that no archive lookup is available there and offers no archive link

### Requirement: Older districts win where districts moved
For a Municipality that moved to another district in 2021, the system SHALL answer with the archive of its earlier district, because registers are filed by the older regions. When that differs from the archive of today's district, it SHALL name today's archive as "also check".

#### Scenario: Harrachov
- **WHEN** the reader opens the place sheet for Harrachov
- **THEN** the system answers SOA Zámrsk and adds "also check SOA Litoměřice"

### Requirement: Link to the register viewer
For the archive it finds, the system SHALL show the archive's name and a link that opens the archive's online register viewer in a new browser context. Where the viewer supports a search by place, the link SHALL open that search for the Municipality's name.

#### Scenario: Open scans
- **WHEN** the reader taps "Open scans" on a place sheet
- **THEN** the archive's register viewer opens outside the app, and the map keeps its position

### Requirement: Near-border hint
When a location lies within 5 km of a boundary between two archive regions, the system SHALL name the neighbouring archive as well. Parishes are filed under the archive of the parish seat, which can lie across the line.

#### Scenario: Village near a regional boundary
- **WHEN** the reader opens the place sheet for a location 3 km from the boundary between SOA Zámrsk and MZA Brno
- **THEN** the sheet shows SOA Zámrsk as the archive and adds "also check MZA Brno"

### Requirement: Jewish registers
For every location in the Czech lands, the system SHALL also point to the National Archives (Národní archiv) as the holder of Jewish registers.

#### Scenario: Jewish registers note
- **WHEN** the reader opens any place sheet in the Czech lands
- **THEN** the sheet includes a secondary link to the National Archives for Jewish registers

### Requirement: Archive list is data, not code
Archive names, regions and portal URLs SHALL live only in `app/data/archives.json`, and a scheduled check SHALL report any portal URL that stops answering. The check SHALL fail only when a link is definitely broken (a missing page, a host that no longer exists, a refused connection). It SHALL warn, without failing, when a portal only can't be reached from the check's network (timeouts, certificate-chain problems, blocked or overloaded servers).

#### Scenario: Portal moves
- **WHEN** an archive portal URL answers 404 on the weekly check
- **THEN** the check fails and names the archive and URL, without changing the app

#### Scenario: Portal unreachable from the check's network
- **WHEN** an archive portal times out or presents an incomplete certificate chain on the weekly check
- **THEN** the check passes with a warning naming the archive and URL
