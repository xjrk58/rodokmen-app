# Spec Delta

## Purpose

Let Members sign in on their phones and read the Tree: find a person, see everything known about them with its evidence, and follow the family up and down the generations.

## ADDED Requirements

### Requirement: Sign-in in the app
The app SHALL guide a relative from an invitation link to a registered passkey, and SHALL offer the emailed sign-in link whenever a passkey is not available. Without sign-in, the app SHALL show only the public map.

#### Scenario: First visit from an invitation
- **WHEN** a relative opens their invitation link on an Android phone
- **THEN** the app asks for a display name and language, registers a passkey, and opens the tree

#### Scenario: Not signed in
- **WHEN** someone opens the app without signing in
- **THEN** they see the map, search and place sheets, and nothing about any Person

### Requirement: People list and search
Members SHALL be able to search Persons by any Name, ignoring case and diacritics, with each result showing the primary Name and life years.

#### Scenario: Searching without diacritics
- **WHEN** a Member types "dvorakova"
- **THEN** Persons named Dvořáková appear with their life years

### Requirement: Unrelated people hidden by default
Search, the people list and the tree SHALL show Relatives and Possible relatives by default, with a switch to include Unrelated people. Possible relatives SHALL be marked as such wherever they appear.

#### Scenario: Village index entries
- **WHEN** a Member searches a surname shared by family members and unrelated villagers
- **THEN** only Relatives and Possible relatives are listed until the Member switches on Unrelated people

### Requirement: Person page
The person page SHALL show all Names, the Events the Person took part in with their Role, Place or House and date, the Families as partner and as child, and each Citation with its confidence and images. It SHALL offer "Show in tree", "Propose a change" and the record's history.

#### Scenario: Godparent role
- **WHEN** a Member opens the page of a woman who was godmother at a baptism
- **THEN** that baptism appears in her Events with the Role "godparent"

### Requirement: Owner settings in the app
The Owner SHALL manage the family from the app: invite Members, change roles, disable and enable Members, link Members to their Persons, and mark Family roots. Settings that later changes add, such as Agent accounts and scan reading, SHALL appear in the same place. Other Members SHALL see only their own settings.

#### Scenario: Inviting a cousin
- **WHEN** the Owner enters a cousin's email and language in the app
- **THEN** the invitation is sent, and the Owner sees it as pending until it is accepted

#### Scenario: Contributor's settings
- **WHEN** a Contributor opens settings
- **THEN** they see their own language, sessions and passkeys and nothing about other Members

### Requirement: Family data offline
The Tree data a Member last loaded SHALL stay readable offline, marked with the time it was loaded.

#### Scenario: Reading room without signal
- **WHEN** a signed-in Member opens a Person page in airplane mode that they viewed yesterday
- **THEN** the page shows yesterday's data with "as of" and yesterday's time
