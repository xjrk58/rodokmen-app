# Spec Delta

## Purpose

Let the family place each House where it stood, with the stable cadastre map as the evidence, so that the map shows which house in a village and the Events in a House sit on it.

## ADDED Requirements

### Requirement: A House position is a fact with evidence
A House SHALL have at most one position of its own. Setting, moving or clearing it SHALL be a change to the Tree like any other: through a reviewed Proposal, or an Editor's direct change, that creates a Citation supporting it. The House SHALL keep the Citation its position came from, and its history SHALL show every change of position.

#### Scenario: Placing a House
- **WHEN** a Contributor places čp. 7 of Vrbinov on the map and cites the stable cadastre map sheet
- **THEN** a Proposal is submitted, and once an Editor accepts it the House has that position and that Citation

#### Scenario: No evidence
- **WHEN** a Member tries to submit a position without a Citation
- **THEN** the app refuses and asks for the map sheet or another Source

#### Scenario: Moving it later
- **WHEN** an Editor accepts a second Proposal that moves the House by 40 m with another Citation
- **THEN** the House's history shows both positions, and an undo of the second restores the first with its Citation

### Requirement: A map sheet as a Source
The system SHALL offer a Source of the kind map, for a map such as the stable cadastre map of one cadastral community, with the archive that holds it and its archival signature. When a Member places a House, the app SHALL offer the map Sources already cited for that Place first, and otherwise a new one filled in from the Place. The Citation SHALL name the sheet and say what it shows at the House.

#### Scenario: Citing the sheet
- **WHEN** a Member confirms a position in Vrbinov, where no map Source exists yet
- **THEN** the Citation step offers a new map Source "Stabilní katastr, Vrbinov" held by the Ústřední archiv zeměměřictví a katastru, and asks for the signature, the sheet and what the sheet shows there, such as "building plot 12, čp. 7"

#### Scenario: The same map again
- **WHEN** a Member places a second House of Vrbinov
- **THEN** the app offers the map Source created for the first one

### Requirement: The stable cadastre beside the map
While placing a House, the app SHALL let the Member see the stable cadastre map of the Place: as an overlay where one is offered (historical-maps spec), and otherwise by opening the ČÚZK Archiv viewer at the Place in another tab or window. Returning from the viewer SHALL bring the Member back to the same step with nothing lost.

#### Scenario: Two windows on a computer
- **WHEN** a Member places a House at 1280 px wide and no stable cadastre overlay is offered
- **THEN** "Open the stable cadastre" opens the ČÚZK Archiv viewer at Vrbinov in a new window, and the placing step stays as it was

#### Scenario: Switching on a phone
- **WHEN** a Member on a phone opens the stable cadastre, reads it, and comes back to the app
- **THEN** the placing step shows the map where they left it, with the cross where it was

### Requirement: Placing a House on a phone
On a phone, the Member SHALL place a House by moving the map under a fixed cross in the middle of the screen, over today's aerial photograph or the stable cadastre overlay with its opacity adjustable, and SHALL confirm with one button. The map SHALL open zoomed in on the House's present position, else its Place.

#### Scenario: One hand on a phone
- **WHEN** a Member opens čp. 7 of Vrbinov from the place sheet at 390 px wide and chooses "Place on the map"
- **THEN** the map zooms to Vrbinov over the aerial photograph, a cross stays in the middle while the Member pans, and "Use this position" goes on to the Citation

### Requirement: Placing a House on a computer
On a computer, the Member SHALL also be able to place a House by clicking the map, and to move the cross with the arrow keys.

#### Scenario: Clicking the building
- **WHEN** a Member clicks the building of čp. 7 on the aerial photograph
- **THEN** the cross moves there, and "Use this position" goes on to the Citation

### Requirement: Reviewing a House position
The review of a Proposal that sets a House position SHALL show the old and the new position, or the Place's point when there was none, on a small map with the aerial photograph, the distance between them, and the Citation with a link that opens the stable cadastre at the Place.

#### Scenario: An Editor checks a position
- **WHEN** an Editor opens a Proposal that places čp. 7 of Vrbinov 180 m from the village's point
- **THEN** the review shows both points, "180 m", the Citation and the link to the stable cadastre, next to the usual accept and reject

### Requirement: Houses without a position
A House without its own position SHALL keep its Events at its Place's point, as today, and SHALL never be shown as if it had been placed. The place sheet SHALL list the Place's Houses with their house numbers and say which have a position.

#### Scenario: An imported House
- **WHEN** a Member opens the place sheet of a village whose Houses came from the Vault import without positions
- **THEN** each House is listed as "not placed", and its Events count at the village's pin

### Requirement: Placing offline
A House position SHALL be kept in a Draft like any other finding, so that it survives going offline and is submitted later. The app SHALL say when the aerial photograph or the stable cadastre cannot load.

#### Scenario: Losing the signal
- **WHEN** a Member has chosen a position and loses the network before submitting
- **THEN** the Draft keeps the position and the Citation typed so far, and submits once online
