# Spec Delta

## Purpose

Keep the Tree reachable for the family, deployed safely, and recoverable after any loss.

## ADDED Requirements

### Requirement: One domain over HTTPS
The app and the API SHALL be served from one domain over HTTPS only. Plain HTTP SHALL redirect to HTTPS, and certificates SHALL renew without manual steps.

#### Scenario: Plain HTTP
- **WHEN** someone opens the domain over http://
- **THEN** they are redirected to https:// on the same path

### Requirement: Deploys from CI
A merge to `main` SHALL deploy automatically once all tests pass. A failed deploy SHALL leave the previous version running.

#### Scenario: Broken release
- **WHEN** the new version fails its health check after deployment
- **THEN** the previous version keeps serving requests and the Owner is alerted

### Requirement: Nightly encrypted Backups
The system SHALL take an encrypted Backup of the database and all images every night and store it with a second provider in the EU. It SHALL keep 30 daily and 12 monthly Backups.

#### Scenario: Monthly restore test
- **WHEN** the monthly restore job restores the latest Backup into a scratch instance
- **THEN** the job checks that the record counts match production and alerts the Owner if they do not

### Requirement: Email delivery
Invitations, sign-in links and notifications SHALL be sent through an EU transactional email service from the Rodokmen domain.

#### Scenario: Sign-in link delivery
- **WHEN** a Member requests a sign-in link
- **THEN** the email is sent from the Rodokmen domain within one minute

### Requirement: Health and alerts
The server SHALL expose a health check, and the Owner SHALL be alerted by email when it fails for more than 5 minutes or when a Backup fails.

#### Scenario: Failed Backup
- **WHEN** a nightly Backup does not complete
- **THEN** the Owner receives an alert email the same night
