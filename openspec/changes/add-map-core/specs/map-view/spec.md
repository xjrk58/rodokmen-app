# Spec Delta

## Purpose

Show the Czech lands as a full-screen, touch-friendly map that the reader can pan and zoom, with archive regions and a place sheet for whatever they tap.

## ADDED Requirements

### Requirement: Full-screen map
The system SHALL open on a full-screen map of the Czech Republic with a modern base map, usable with touch on a phone and with mouse on a desktop.

#### Scenario: First open on a phone
- **WHEN** the reader opens the app on an Android phone
- **THEN** the whole Czech Republic is visible and can be panned and zoomed with fingers

### Requirement: Archive regions layer
The system SHALL offer a layer that tints each district by the archive that holds its registers, with a legend naming the archives.

#### Scenario: Show archive regions
- **WHEN** the reader turns on the archive regions layer
- **THEN** each district is tinted by its archive and the legend lists every archive shown

### Requirement: Place sheet on tap
Tapping the map or choosing a search result SHALL open a place sheet for that location. The sheet shows the nearest Municipality and its district, and the archive lookup result. It also lists the historical map links for the location.

#### Scenario: Tap a village
- **WHEN** the reader taps a spot in the countryside
- **THEN** a sheet slides up with the nearest Municipality, its district, its archive with an "Open scans" link, and historical map links

### Requirement: Borders without network
The district boundaries and the national border SHALL draw even when map tiles cannot load.

#### Scenario: No tiles
- **WHEN** the tile server cannot be reached
- **THEN** the map still shows district boundaries, the national border and the archive regions layer

### Requirement: Czech and English interface
All interface text SHALL be available in Czech and English, chosen from the browser language with English as the fallback, and switchable by the reader.

#### Scenario: Czech phone
- **WHEN** the reader opens the app on a phone set to Czech
- **THEN** all labels, buttons and messages appear in Czech
