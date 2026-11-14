# Spec Delta

## ADDED Requirements

### Requirement: The Owner corrects a Member's address
Only the Owner SHALL change a Member's email address. The new address SHALL take effect only once it is confirmed through a link emailed to it, in the Member's language. The link SHALL be valid once, for 7 days. Until the new address is confirmed, sign-in links SHALL go to the old one.

#### Scenario: Correcting a mistyped address
- **WHEN** the Owner corrects a cousin's mistyped address
- **THEN** a confirmation link goes to the new address in the cousin's language, and sign-in links still go to the old address until the new one is confirmed

#### Scenario: An Editor tries to change an address
- **WHEN** an Editor or a Contributor asks to change a Member's address
- **THEN** the request is refused and no email is sent

### Requirement: Confirming a new address
Opening the confirmation link SHALL change nothing; only confirming it on its page SHALL make the change. The link SHALL stop working once it is used, after 7 days, when the Owner withdraws the change, and when the Owner asks for another change for the same Member. Confirming SHALL not sign anyone in.

#### Scenario: Confirmed
- **WHEN** the cousin opens the link from the new address and confirms
- **THEN** the new address is the cousin's address, and the next sign-in link goes there

#### Scenario: Opened but not confirmed
- **WHEN** a mail program or a link preview opens the confirmation link
- **THEN** the address stays as it was, and the cousin can still confirm

#### Scenario: Expired or replaced link
- **WHEN** a confirmation link is used after 7 days, after the Owner withdrew the change, or after the Owner asked for another address
- **THEN** it is refused, the address stays as it was, and the page says to ask the Owner for a new link

### Requirement: An address belongs to one Member
A new address SHALL be refused when it belongs to another Member, when an invitation to it is pending, or when it is the Member's current address. If another Member has the address by the time it is confirmed, the confirmation SHALL be refused and the address SHALL stay as it was.

#### Scenario: Another Member's address
- **WHEN** the Owner gives a Member an address that another Member already has
- **THEN** it is refused, and no email is sent

#### Scenario: An invited address
- **WHEN** the Owner gives a Member an address that a pending invitation went to
- **THEN** it is refused, and the Owner is told to withdraw the invitation first

#### Scenario: Taken before confirming
- **WHEN** the address waiting for confirmation becomes another Member's before the link is used
- **THEN** confirming is refused, and the Member keeps their old address

### Requirement: After an address is corrected
When a new address takes effect, the old address SHALL be told in the Member's language that Rodokmen no longer uses it, without naming the new one. The Member's unused sign-in links SHALL stop working. The Member's sessions and passkeys SHALL be kept.

#### Scenario: Old sign-in link
- **WHEN** a sign-in link sent to the old address is used after the new address took effect
- **THEN** it is refused

#### Scenario: The old address is told
- **WHEN** the new address takes effect
- **THEN** the old address gets one email that says Rodokmen no longer uses it, and the email does not name the new address

#### Scenario: Signed in on a phone
- **WHEN** the Member is signed in on their phone with a passkey while the address changes
- **THEN** they stay signed in, and their passkey still signs them in
