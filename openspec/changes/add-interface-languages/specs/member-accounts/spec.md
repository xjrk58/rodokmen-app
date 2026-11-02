# Spec Delta

## ADDED Requirements

### Requirement: Emails in every Interface language
A Member's account and an invitation SHALL each have one Interface language: Czech, Slovak, German or English, Czech when none is given. Invitations and sign-in emails SHALL be written in the recipient's language. Any other language SHALL be refused. This replaces "Emails in the Member's language", which allowed only Czech or English.

#### Scenario: Slovak invitation
- **WHEN** the Owner invites a relative and picks Slovak
- **THEN** the invitation email is in Slovak, and the relative's account starts with Slovak as its language

#### Scenario: German sign-in link
- **WHEN** a Member whose account language is German asks for a sign-in link by email
- **THEN** the email is in German

#### Scenario: Language not offered
- **WHEN** a request sets a Member's language to Polish
- **THEN** it is refused, naming the language field, and the account keeps its language
