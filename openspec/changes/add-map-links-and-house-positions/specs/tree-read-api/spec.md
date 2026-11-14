# Spec Delta

## ADDED Requirements

### Requirement: Map lines in one request
The API SHALL return, in one request, the Map lines of a year range, or of every range a play passes through when a step is given: each line with its two ends, and for each range the lines shown with their number of births or marriages, width step and colour strength. Every answer SHALL name the state of the Tree it was computed from.

#### Scenario: A whole play
- **WHEN** the app asks for the lines from 1600–1629 with a step of 5 years
- **THEN** one response holds every line that appears up to 1950 and, for each range of the play up to 1921–1950, the lines shown with their width step and strength

#### Scenario: One range
- **WHEN** the app asks for the lines of 1820–1850 without a step
- **THEN** the response holds one range

#### Scenario: The Tree changed
- **WHEN** a Proposal is accepted between two requests
- **THEN** the second response names a newer state of the Tree

### Requirement: Map lines follow fixed rules
The same Tree and the same request SHALL give the same Map lines, ranges, widths and strengths, byte for byte, whatever order the records are read in.

#### Scenario: Records in another order
- **WHEN** the same Tree is read with its rows in another order
- **THEN** the answer is the same
