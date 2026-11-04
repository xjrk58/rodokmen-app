# Spec Delta

## ADDED Requirements

### Requirement: Charts through MCP
The MCP server SHALL offer a tool that returns a Chart's content as the API gives it to Members: who is in it and in what order, each card's facts and marks, the Direct line, and a House chart's rows, periods, house numbers and links. It SHALL return no picture, and each call SHALL count as a read request toward the Agent's rate limits.

#### Scenario: Who lived at a House
- **WHEN** an assistant asks for the House chart of a House of Kamenná Lhota
- **THEN** it receives the rows in the order the app draws them, each with its period, house numbers and link to an earlier row

#### Scenario: Same answer as the app
- **WHEN** an assistant asks for the Descendant chart of Jan Novák with the options a Member used in the app on the same day
- **THEN** it receives the same Persons, in the same order, with the same marks
