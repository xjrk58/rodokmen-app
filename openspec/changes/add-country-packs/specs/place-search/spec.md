# Spec Delta

## ADDED Requirements

### Requirement: Search across Country packs
The system SHALL search the Municipalities and Localities of every Country pack on the device. Each result SHALL show its name, its Municipality when it is a Locality, its first-level unit (district, Land or voivodeship) and, outside the Czech lands, its country.

#### Scenario: Same name in two countries
- **WHEN** the reader types "Neustadt" with the Czech, Bavaria and Saxony packs on the device
- **THEN** the results list every Neustadt in those packs, each labelled so that they can be told apart

#### Scenario: Village inside a larger Municipality
- **WHEN** the reader searches a Polish village that is part of a larger gmina
- **THEN** the result shows the village and its gmina, and choosing it centres the map on the village, not on the gmina's seat

### Requirement: Search other packs on request
When the Country packs on the device give no result, the system SHALL offer to search the packs that are not on the device yet. Accepting SHALL load them and show their results.

#### Scenario: No local hit
- **WHEN** the reader types "Tarnów" with only the Czech pack on the device and the network on
- **THEN** the app says there is no match in the Czech lands and offers to search the other packs, and accepting lists Tarnów from the Poland pack

### Requirement: Polish and German letters fold
Matching SHALL fold letters that have no diacritic mark to remove, so that ł matches l and ß matches ss. A query SHALL also match when the reader writes ä, ö or ü as ae, oe or ue.

#### Scenario: Polish ł
- **WHEN** the reader types "lodz"
- **THEN** the results include "Łódź"

#### Scenario: German umlaut written out
- **WHEN** the reader types "muenchen"
- **THEN** the results include "München"
