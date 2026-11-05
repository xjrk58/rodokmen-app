# Spec Delta

## ADDED Requirements

### Requirement: Kinship on the person page
For a Member with an own Person, the person page SHALL show near its top how the Person is related to them: the closest path's term, marked when possible, its line and degree, its common ancestors and the number of other paths, with a way to list every path. A page the Member has loaded SHALL show its kinship offline.

#### Scenario: A cousin's page
- **WHEN** a Member opens the page of his first cousin Marie Nováková
- **THEN** the page says "sestřenice" in Czech ("first cousin" in English), in the collateral line, of the 4th degree, and names their common grandparents with links to their pages

#### Scenario: Listing every path
- **WHEN** the page says that they are related in 2 more ways and the Member asks to see them
- **THEN** all 3 paths are listed in their order, each with its term, line, degree, marks and every Person on the way

#### Scenario: Offline
- **WHEN** a Member opens in airplane mode a person page they viewed yesterday
- **THEN** the page shows yesterday's kinship with the "as of" time of the page

### Requirement: Kinship in search results
For a Member with an own Person, search results and the people list SHALL show each Person's closest kinship term next to the life years, marked when possible. A Person with no kinship to the Member SHALL show none.

#### Scenario: Searching a surname
- **WHEN** a Member searches for "novak" and the results hold her grandfather and a man the Tree does not relate to her
- **THEN** her grandfather's result says "děd" ("grandfather"), and the other result shows no kinship
