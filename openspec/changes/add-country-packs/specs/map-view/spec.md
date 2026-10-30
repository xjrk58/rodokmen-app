# Spec Delta

## ADDED Requirements

### Requirement: Archive regions for every loaded pack
The archive regions layer SHALL tint the archive regions of every Country pack on the device by the archive that holds their Catholic registers, or their civil registers where the pack has no Catholic regions. Its legend SHALL be grouped by pack.

#### Scenario: Two packs
- **WHEN** the reader turns on archive regions with the Czech and Austria packs on the device
- **THEN** districts on both sides of the border are tinted, and the legend lists the Czech archives and the Austrian dioceses under their pack names

### Requirement: Place sheet names the country
The place sheet SHALL show the nearest Municipality or Locality, its first-level unit, and, outside the Czech lands, its country.

#### Scenario: Tap in Bavaria
- **WHEN** the reader taps a village in Bavaria
- **THEN** the sheet shows the village, its district, "Germany (Bavaria)", the archive answer and the historical map links

### Requirement: Borders of every loaded pack without network
The borders and archive regions of every Country pack on the device SHALL draw even when map tiles cannot load.

#### Scenario: No tiles, two packs
- **WHEN** the tile server cannot be reached and the Poland pack is on the device
- **THEN** the map shows Polish county boundaries and the Polish border next to the Czech ones
