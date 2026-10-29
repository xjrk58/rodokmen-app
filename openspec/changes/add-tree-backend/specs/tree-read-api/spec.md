# Spec Delta

## Purpose

Let the app and Agents read the Tree through one documented API, with queries shaped for the map, the person page and the pedigree.

## ADDED Requirements

### Requirement: Members and Agents only
Every API request except the health check SHALL require a signed-in Member or a valid Agent token.

#### Scenario: Anonymous request
- **WHEN** a request without a session or token asks for a Person
- **THEN** the API answers 401 and reveals nothing about whether that Person exists

### Requirement: Described by OpenAPI
The API SHALL publish an OpenAPI description generated from the same shared schemas that validate its requests and responses.

#### Scenario: Description matches behaviour
- **WHEN** CI compares the published description with the running API's routes
- **THEN** every route appears in the description, and CI fails if one is missing

### Requirement: Search Persons
The API SHALL find Persons by any of their Names, ignoring case and diacritics. Results can be narrowed by Place and by year range.

#### Scenario: Search by a German form
- **WHEN** a Member searches for "nowak"
- **THEN** Persons whose primary Name is "Novák" and who have a Name "Nowak" are found

### Requirement: Ancestors and descendants in one request
The API SHALL return a Person's ancestors or descendants up to at least 6 generations in a single request.

#### Scenario: Pedigree
- **WHEN** the app asks for 6 generations of ancestors of one Person
- **THEN** one response holds every known ancestor with the links between them

### Requirement: Events for the map
The API SHALL return the Events located within a map area and a year range, with their Place or House and the Persons taking part.

#### Scenario: Map pins for a decade
- **WHEN** the app asks for Events between 1840 and 1850 inside the current map view
- **THEN** it receives only Events of that period whose Place or House lies in the view

### Requirement: Every record has a version
Every record SHALL carry a version that changes whenever the record changes. A Draft refers to these versions.

#### Scenario: Version after a change
- **WHEN** a Person is changed
- **THEN** reading it again returns a different version than before
