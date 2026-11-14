# Spec Delta

## ADDED Requirements

### Requirement: Correcting a Member's address in Settings
Under Members in Settings, the Owner SHALL be able to give any Member a new address, which sends the confirmation link. Settings SHALL say that the address changes only once it is confirmed, SHALL show an address waiting for confirmation next to the Member, and SHALL let the Owner withdraw it. Other Members SHALL see none of this.

#### Scenario: Owner corrects an address on a phone
- **WHEN** the Owner opens Settings on a phone, corrects a cousin's address and sends it
- **THEN** Settings says the confirmation link is on its way, shows the new address as waiting for confirmation next to the cousin's current one, and nothing is wider than the screen

#### Scenario: Owner withdraws a waiting address
- **WHEN** the Owner clicks Withdraw next to an address waiting for confirmation
- **THEN** the waiting address is gone from Settings, and its link no longer works

### Requirement: The address confirmation page
The confirmation link SHALL open a page that takes the token out of the address bar and changes nothing until the relative presses Confirm the address. The page SHALL then name the new address. A link that is used, expired or withdrawn SHALL get a message, in the reader's language, to ask the Owner for a new one.

#### Scenario: Confirming on a phone
- **WHEN** a relative opens the confirmation link on their phone and presses Confirm the address
- **THEN** the page says that Rodokmen now sends sign-in links to the new address

#### Scenario: Old link
- **WHEN** a relative opens a confirmation link that was already used
- **THEN** pressing Confirm the address shows that the link no longer works and that the Owner can send a new one
