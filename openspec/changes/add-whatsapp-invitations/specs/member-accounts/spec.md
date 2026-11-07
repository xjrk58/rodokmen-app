# Spec Delta

## ADDED Requirements

### Requirement: Invitation link for the Owner's own WhatsApp
The answer that creates an invitation SHALL hold its link and a message for the Owner to send from their own WhatsApp. The invitation email SHALL still go out as before. The server SHALL send nothing through WhatsApp and SHALL store no phone number. The link and the message SHALL be in that answer only, never in the list of invitations or in any other answer, since the server keeps only the token's hash.

#### Scenario: The link comes back once
- **WHEN** the Owner invites a cousin
- **THEN** the answer holds the link that the invitation email holds, and the list of invitations shows the invitation as pending without the link

#### Scenario: The link is lost
- **WHEN** the Owner closes Settings before sending the link through WhatsApp
- **THEN** no answer shows the link again, the emailed link still works, and the Owner can withdraw the invitation and invite the cousin again

### Requirement: The WhatsApp message in the invitation's language
The message SHALL be written in the invitation's language, Czech or English, and SHALL name the inviter, hold the link, say that it is valid for 7 days and works only once, ask the relative not to forward it, and name the address the invitation email went to.

#### Scenario: Czech message
- **WHEN** the Owner invites a relative and picks Czech
- **THEN** the message is in Czech, names the Owner, holds the link, says that it is valid for 7 days, and names the relative's address

### Requirement: One invitation, whichever way its link travels
An invitation SHALL have one link, whether it reached the relative by email, through WhatsApp or both. It SHALL work once, expire after 7 days and stop working when the Owner withdraws it, as an emailed link does.

#### Scenario: Accepted through WhatsApp
- **WHEN** a relative accepts the link that came through WhatsApp, and later opens the invitation email
- **THEN** the emailed link is refused as already used

#### Scenario: Withdrawn after sending
- **WHEN** the Owner withdraws an invitation after sending its link through WhatsApp
- **THEN** the link is refused, and the relative is told to ask the Owner for a new one

#### Scenario: Expired WhatsApp link
- **WHEN** a link that came through WhatsApp is opened after 7 days
- **THEN** it is refused, and the relative is told to ask the Owner for a new one

### Requirement: Opening an invitation link uses nothing up
Opening the invitation page, checking an invitation, and a link preview SHALL leave the invitation pending. Only accepting it with a display name SHALL use it. The token SHALL travel only in the link's fragment, which browsers and link previews do not send to the server.

#### Scenario: Link preview in a chat
- **WHEN** a chat app fetches the invitation link to show a preview
- **THEN** the server never receives the token, the invitation stays pending, and the relative can still accept it

#### Scenario: Opened twice
- **WHEN** a relative opens the invitation link, closes it, and opens it again
- **THEN** the invitation is still pending and can be accepted

### Requirement: The invited address is named before accepting
The check of a pending invitation SHALL name the address the invitation went to, so that the relative can see it before accepting. The check of an invitation that is no longer pending SHALL not name it.

#### Scenario: Checking a pending invitation
- **WHEN** a relative's phone checks a pending invitation
- **THEN** the answer names the invited address

#### Scenario: Checking a used invitation
- **WHEN** someone checks an invitation that was already accepted
- **THEN** the answer says so and names no address
