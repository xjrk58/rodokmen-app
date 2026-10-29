# Spec Delta

## Purpose

Make the map installable on a phone and usable without network, so it works in archive reading rooms and villages with poor signal.

## ADDED Requirements

### Requirement: Installable
The system SHALL be installable from Android Chrome as an app with its own icon and name, opening without browser controls.

#### Scenario: Install
- **WHEN** the reader chooses "Install app" in Android Chrome
- **THEN** a Rodokmen icon appears on the home screen and opens the map full screen

### Requirement: Works offline after one visit
After one online visit, the app shell, search, archive lookup, archive regions and borders SHALL work without network.

#### Scenario: Airplane mode
- **WHEN** the reader opens the installed app in airplane mode
- **THEN** the map opens, search and place sheets work, and only uncached map tiles are missing

### Requirement: Only viewed tiles are cached
The system SHALL cache map tiles only as the reader views them, keep at most 2,000 tiles, and never download tiles in bulk.

#### Scenario: Tile cache limit
- **WHEN** the reader has viewed more than 2,000 tiles
- **THEN** the least recently used tiles are dropped first

### Requirement: Updates never interrupt reading
When a new version is available, the system SHALL tell the reader and update only when the reader agrees.

#### Scenario: New version
- **WHEN** a new version is deployed while the app is open
- **THEN** the app shows "New version, reload" and keeps the current page until the reader taps it
