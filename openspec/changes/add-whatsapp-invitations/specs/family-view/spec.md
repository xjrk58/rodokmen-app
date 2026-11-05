# Spec Delta

## ADDED Requirements

### Requirement: Sending an invitation through WhatsApp
After the Owner sends an invitation in Settings, the app SHALL show its message once and offer to send it from the Owner's own WhatsApp: through the device's share sheet where there is one, and as a message to copy on every device. The app SHALL open no web address that holds the token. Settings SHALL say that the link is shown only now, and that to send it later the Owner withdraws the invitation and invites again.

#### Scenario: Phone with a share sheet
- **WHEN** the Owner has sent an invitation on a phone and taps Send through WhatsApp
- **THEN** the phone's share sheet opens with the message ready, and the Owner picks WhatsApp and the relative

#### Scenario: Computer without a share sheet
- **WHEN** the Owner has sent an invitation on a computer whose browser has no share sheet
- **THEN** the app offers no share button, shows the message, and copies it when the Owner clicks Copy the message, to paste into WhatsApp

#### Scenario: Leaving the message
- **WHEN** the Owner clicks Done or leaves Settings
- **THEN** the message and the link are gone from the screen and the device, and the invitation stays in the list as pending, with Withdraw

### Requirement: The invited address on the invitation page
Before a relative accepts an invitation, the invitation page SHALL show the address the invitation went to, say that sign-in links will go to it, and ask the relative not to accept when it is not theirs but to ask the Owner for a new invitation.

#### Scenario: Mistyped address
- **WHEN** a relative opens an invitation link that came through WhatsApp, and the invitation went to a mistyped address
- **THEN** the page shows that address before they accept, and tells them to ask the Owner for a new invitation instead of accepting
