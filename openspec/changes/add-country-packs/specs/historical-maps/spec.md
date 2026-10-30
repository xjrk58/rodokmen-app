# Spec Delta

## ADDED Requirements

### Requirement: Historical map links per pack
For every place sheet inside a Country pack, the system SHALL list the historical map viewers of that pack, each opening outside the app. The Czech lands pack SHALL keep its three links (ČÚZK Archiv, OldMapsOnline, Arcanum Maps).

#### Scenario: Links in Galicia
- **WHEN** the reader opens a place sheet near Kraków
- **THEN** it lists the historical map viewers of the Poland pack, including Arcanum Maps

### Requirement: Overlays only when aligned and permitted
A pack SHALL offer a historical overlay only if its service delivers correctly aligned images in the app's map projection and its licence allows showing it in the app. A service that fails either check SHALL appear only as a link.

#### Scenario: Licence not settled
- **WHEN** a map service delivers aligned tiles but its licence does not allow embedding
- **THEN** no overlay is offered for it, and its viewer is listed among the links

### Requirement: Overlays switch with the pack
The layers panel SHALL list the overlays of every pack on the device, grouped by pack, and the layer health check SHALL test all of them.

#### Scenario: Check layers with two packs
- **WHEN** the reader runs "Check map layers" with the Czech and Bavaria packs on the device
- **THEN** the report lists each overlay of both packs as working or not working
