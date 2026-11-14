# Spec Delta

## ADDED Requirements

### Requirement: Stable cadastre overlay only when permitted
The system SHALL offer the stable cadastre map (1824–1843) as a switchable overlay with an opacity control only where a service delivers it aligned in the app's map projection and its holder allows Rodokmen to show it, as recorded in the docs. Until then the stable cadastre SHALL be reached through the ČÚZK Archiv viewer only.

#### Scenario: No permission yet
- **WHEN** no stable cadastre service is both aligned and permitted
- **THEN** the layers panel offers no stable cadastre overlay, and the place sheet's ČÚZK Archiv link still opens the viewer

#### Scenario: Permission recorded
- **WHEN** the holder's permission and an aligned service are recorded, and the overlay is switched on
- **THEN** the stable cadastre appears over today's map with its credit to the Ústřední archiv zeměměřictví a katastru, and "Check map layers" tests it with the other overlays

### Requirement: Stable cadastre at the place
The ČÚZK Archiv link of a place sheet SHALL open the viewer at the location of the sheet, where the viewer accepts a location in its address, and at its start page otherwise.

#### Scenario: Opening the old map of a village
- **WHEN** a Member opens the ČÚZK Archiv link on the place sheet of Vrbinov
- **THEN** the viewer opens centred on Vrbinov, where the Member chooses the imperial imprint or the indication sketch

### Requirement: Today's aerial photograph for placing
The map SHALL offer today's aerial photograph of the Czech lands from ČÚZK as a layer, with its credit, for placing Houses and comparing with the old maps, for as long as ČÚZK serves it in the app's map projection under its open data terms.

#### Scenario: Comparing with the old map
- **WHEN** a Member switches on the aerial photograph at a village
- **THEN** today's buildings show at house level, with the credit "ČÚZK"
