# Spec Delta

## ADDED Requirements

### Requirement: The Owner is told when an invitation is accepted
When a relative accepts an invitation, the system SHALL email the Owner once, in the Owner's language. The email SHALL name the display name the relative chose, the invited address and when it was accepted, and SHALL link to Settings, where the Owner can disable the new Member. It SHALL go to whoever is the Owner when the invitation is accepted.

#### Scenario: A cousin accepts
- **WHEN** a cousin accepts an invitation and chooses the name Marta
- **THEN** the Owner gets one email in the Owner's language that names Marta, the invited address and the time, with a link to Settings

#### Scenario: Link sent both ways
- **WHEN** a relative accepts the link that came through WhatsApp, and later opens the same invitation's link from the email
- **THEN** the second link is refused, and the Owner has got one email, not two

#### Scenario: Two invitations to one address
- **WHEN** the Owner invited the same address twice and the relative accepts one invitation, then tries the other
- **THEN** the other is refused as already a Member, and the Owner has got one email

#### Scenario: Ownership handed over
- **WHEN** the Owner who sent an invitation has handed ownership to another Member before the relative accepts
- **THEN** the email goes to the new Owner

### Requirement: Accepting does not wait on the Owner's email
The email to the Owner SHALL go out only after the acceptance is stored. Failing to send it SHALL NOT undo the acceptance or refuse the relative.

#### Scenario: The email cannot be sent
- **WHEN** a relative accepts an invitation while the email to the Owner cannot be sent
- **THEN** the relative is a Contributor and signed in, and the failure is logged
