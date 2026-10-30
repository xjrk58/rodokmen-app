# Spec Delta

## ADDED Requirements

### Requirement: Images sent for reading
While scan reading is switched on, the system SHALL send to the reading service only the images of the reading a Member or Agent asked for: their display copy, or the crop the Member marked, never the original file. It SHALL never send portraits, other Citations' images or documents. With scan reading switched off, no image SHALL leave the server except to the people allowed to see it and to Backups.

#### Scenario: Reading one page
- **WHEN** a Member asks for a reading of one register page with a marked crop
- **THEN** only that crop is sent, and the rest of the Tree's images stay on the server

#### Scenario: Switched off
- **WHEN** scan reading is switched off
- **THEN** no request with an image goes to the reading service
