# Spec Delta

## Purpose

Show where the family lived, married and died across the Czech lands and beyond, and how that changed over time.

## ADDED Requirements

### Requirement: Family pins
For signed-in Members, the map SHALL show a pin for every Place or House with Events in the Tree, grouping nearby pins at low zoom.

#### Scenario: Zooming in
- **WHEN** a Member zooms from the whole country into one district
- **THEN** grouped pins split into one pin per Place or House

### Requirement: Year slider
The map SHALL offer a year range from 1600 to 1950 that limits the pins to Events in that range, and a play control that steps through the decades.

#### Scenario: One generation
- **WHEN** a Member sets the range to 1820–1850
- **THEN** only pins with Events in those years remain

### Requirement: Life path
From a person page, the map SHALL show that Person's Events in date order, joined by a line, each labelled with its year.

#### Scenario: Moving between villages
- **WHEN** a Member shows the life path of a man born in one village, married in a second and buried in a third
- **THEN** the map draws three labelled points joined in that order

### Requirement: Family here
For signed-in Members, the place sheet SHALL list the Events in the Tree at that Place and its Houses, grouped by Person, with years and links to the person pages.

#### Scenario: Tapping a family village
- **WHEN** a Member taps a Place where three generations lived
- **THEN** the place sheet lists those Persons with their Events and years, next to the archive and map links

### Requirement: Places outside the Czech lands
Family pins SHALL appear for Places anywhere in the world. Archive lookup and historical overlays SHALL remain limited to the Czech lands.

#### Scenario: A line from abroad
- **WHEN** a Member taps a family pin in another country
- **THEN** the place sheet shows the family Events and says that archive lookup covers only the Czech lands
