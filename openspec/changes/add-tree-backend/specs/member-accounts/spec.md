# Spec Delta

## Purpose

Let the Owner bring relatives in by invitation, let them sign in without a password, and give each Member one role.

## ADDED Requirements

### Requirement: Invitation only
Only the Owner SHALL create Members, by sending an invitation link by email. The link SHALL work once and expire after 7 days. There SHALL be no public sign-up.

#### Scenario: Accepting an invitation
- **WHEN** a relative opens a valid invitation link on their phone
- **THEN** they set their display name and language, register a passkey, and become a Contributor

#### Scenario: Expired invitation
- **WHEN** an invitation link is opened after 7 days
- **THEN** it is refused and the relative is told to ask the Owner for a new one

### Requirement: Sign-in without a password
Members SHALL sign in with a passkey. As a fallback they SHALL be able to request a sign-in link by email, valid once for 15 minutes.

#### Scenario: New phone
- **WHEN** a Member on a new phone has no passkey there
- **THEN** they request an emailed link, sign in with it, and can register a passkey on the new phone

### Requirement: One role per Member
Every Member SHALL have exactly one role: Contributor (the default), Editor or Owner. There SHALL be exactly one Owner, and only the Owner changes roles.

#### Scenario: Promoting an Editor
- **WHEN** the Owner makes a Contributor an Editor
- **THEN** that Member can review Proposals from their next request on

### Requirement: Sessions can be ended
A Member SHALL be able to see and end their own sessions. The Owner SHALL be able to disable a Member, which ends all of that Member's sessions at once.

#### Scenario: Disabling a Member
- **WHEN** the Owner disables a Member
- **THEN** that Member's open app sessions stop working on their next request

### Requirement: Emails in the Member's language
Invitations and sign-in emails SHALL be written in the recipient's language, Czech or English.

#### Scenario: Czech invitation
- **WHEN** the Owner invites a relative and picks Czech
- **THEN** the invitation email is in Czech
