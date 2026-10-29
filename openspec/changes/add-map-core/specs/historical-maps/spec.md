# Spec Delta

## Purpose

Let the reader see the landscape of the 19th century over today's map where public map services allow it, and reach the main historical map viewers for any location.

## ADDED Requirements

### Requirement: Historical overlays
The system SHALL offer the 2nd military survey (1836–1852) and the 3rd military survey special maps as switchable overlays, each with an opacity control. It SHALL offer each only if its public map service delivers correctly aligned images for the app's map projection.

#### Scenario: Overlay on
- **WHEN** the reader switches on the 2nd military survey overlay and lowers its opacity
- **THEN** the historical map appears aligned over today's map and today's roads show through

#### Scenario: Service not usable
- **WHEN** a historical map service cannot deliver aligned images
- **THEN** that overlay is not offered, and its viewer still appears among the historical map links

### Requirement: Historical map links
For every place sheet in the Czech lands, the system SHALL link to the ČÚZK Archiv application (imperial imprints of the stable cadastre), to OldMapsOnline for the Municipality's name, and to Arcanum Maps.

#### Scenario: Links on a place sheet
- **WHEN** the reader opens a place sheet
- **THEN** it lists the three historical map links, each opening outside the app

### Requirement: Layer health check
The settings SHALL offer a check that tries each historical overlay once and reports which ones currently work.

#### Scenario: Check map layers
- **WHEN** the reader runs "Check map layers"
- **THEN** the app lists each overlay as working or not working
