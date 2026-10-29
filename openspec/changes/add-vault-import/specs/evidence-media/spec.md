# Spec Delta

## ADDED Requirements

### Requirement: Documents on Sources
Members SHALL be able to attach PDF documents of up to 50 MB to a Source as part of a Proposal, such as a family chronicle or a certificate. Documents follow the same privacy rules as images: only Members and Agents can open them, only through links that expire, and never in an Export.

#### Scenario: Family chronicle
- **WHEN** a Member attaches a scanned family chronicle as a PDF to a Family account Source
- **THEN** after acceptance every Member can open it from the Source, and it is not part of any Export

#### Scenario: Not a PDF
- **WHEN** a Member tries to attach a DOC file in the app
- **THEN** the app refuses and asks for a PDF
