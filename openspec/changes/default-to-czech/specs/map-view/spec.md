# Spec Delta

## ADDED Requirements

### Requirement: Czech by default
The app SHALL open in Czech unless the reader has chosen English on that device, or, for a signed-in Member, their account's language is English. The browser's language SHALL NOT decide it.

#### Scenario: English phone, first visit
- **WHEN** someone opens the app for the first time on a phone set to English
- **THEN** all labels, buttons and messages appear in Czech, and the language switch offers English

#### Scenario: Choice remembered
- **WHEN** a reader switches to English and opens the app again later on the same device
- **THEN** the app opens in English

#### Scenario: Member's setting
- **WHEN** a signed-in Member whose account language is English opens the app on a new device
- **THEN** the app opens in English
