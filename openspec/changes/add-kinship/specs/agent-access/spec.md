# Spec Delta

## ADDED Requirements

### Requirement: Kinship through MCP
The MCP server SHALL offer a tool that returns the kinship between two Persons the assistant names, as the API gives it: every path in order with its Persons, links, line, degree, marks and terms in every Interface language. It SHALL return no Member's own Person, and each call SHALL count as a read request toward the Agent's rate limits.

#### Scenario: How two Persons are related
- **WHEN** an assistant asks how Jan Novák is related to Marie Nováková
- **THEN** it receives every path between them in order, the closest first, with its common ancestors, line, degree, marks and terms

#### Scenario: Same answer as the app
- **WHEN** an assistant asks for the kinship of a Member's own Person and a cousin on the day the Member opens the cousin's page
- **THEN** it receives the same paths, in the same order, with the same terms and marks
