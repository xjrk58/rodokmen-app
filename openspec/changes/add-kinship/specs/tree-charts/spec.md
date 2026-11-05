# Spec Delta

## ADDED Requirements

### Requirement: Kinship on Chart cards
On screen, a Member with an own Person SHALL be able to switch on kinship for a Chart, and each card SHALL then show its Person's closest kinship term to that own Person, marked when possible. The switch SHALL be off by default and remembered on the device. A Sheet, its print and its SVG and PNG files SHALL NOT show kinship.

#### Scenario: Switched on
- **WHEN** a Member switches on kinship for a Descendant chart of his great-grandparents
- **THEN** each card shows its Person's kinship to him, such as "děd", "strýc" or "sestřenice"

#### Scenario: Printing
- **WHEN** the Member prints the same Chart or downloads it as SVG with kinship switched on
- **THEN** the Sheet shows no kinship, and the SVG file is the same as with kinship switched off
