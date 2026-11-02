# Spec Delta

## Purpose

Let every Member and visitor use Rodokmen in Czech, Slovak, German or English: the app, its emails and the sentences the server writes. Keep every text complete and reviewed in each language, and keep the interface language apart from the languages records are written in.

## ADDED Requirements

### Requirement: Four interface languages, Czech by default
The app SHALL offer its interface in Czech, Slovak, German and English (Slovak and German once reviewed), each named in its own language in the language switch. It SHALL open in the language chosen on the device, else in a signed-in Member's account language, else in Czech. The browser's language SHALL NOT decide it. A new choice SHALL apply at once to every screen, offline too.

#### Scenario: German phone, first visit
- **WHEN** someone opens the app for the first time on a phone set to German
- **THEN** all labels, buttons and messages appear in Czech, and the language switch offers Čeština, Slovenčina, Deutsch and English

#### Scenario: Choice remembered
- **WHEN** a reader switches to Slovak and opens the app again later on the same device
- **THEN** the map, the tree, the person pages, the review screens and Settings appear in Slovak

#### Scenario: Member's setting
- **WHEN** a signed-in Member whose account language is German opens the app on a new device
- **THEN** the app opens in German

#### Scenario: Invitation in Slovak
- **WHEN** a relative opens an invitation the Owner sent in Slovak, on a device with no language chosen
- **THEN** the invitation screen is in Slovak, with Slovak already picked as their language

#### Scenario: Switching offline
- **WHEN** a reader who has opened the app once switches to German without a connection
- **THEN** every label of the app appears in German

### Requirement: Every text in every language
Every interface text, every sentence the server writes for readers and every email to a Member SHALL exist in each Interface language. The checks SHALL fail on a text missing in one language, on a translation whose placeholders differ from the Czech text, on a missing plural form, and on a German or Slovak text that is the English text unchanged, unless that text is listed as the same in every language.

#### Scenario: German text missing
- **WHEN** a change adds an interface text in Czech, Slovak and English but not in German
- **THEN** `pnpm check` fails and names the key and German

#### Scenario: English left in place
- **WHEN** a Slovak text is the English text unchanged, and it is not a name such as Rodokmen or OpenStreetMap
- **THEN** `pnpm check` fails and names the key and Slovak

#### Scenario: Server sentence missing a language
- **WHEN** a change adds a sentence for a new kind of change in Czech and English only
- **THEN** the type check fails

### Requirement: Counts, dates and numbers in the reader's language
A text with a count SHALL use the form its language needs for that number: one, few or other in Czech and Slovak, one or other in German and English. Dates, times and numbers SHALL be formatted as the reader's language writes them.

#### Scenario: Counts in Czech
- **WHEN** an Editor using Czech sees Import batches of 1, 2 and 5 Proposals
- **THEN** they read "1 návrh", "2 návrhy" and "5 návrhů"

#### Scenario: Counts in English
- **WHEN** an Editor using English sees an Import batch of 1 Proposal
- **THEN** they read "1 Proposal", not "1 Proposals"

#### Scenario: Date in German
- **WHEN** an Editor using German gets the daily digest on 2 November 2026
- **THEN** its dates read like "2. November 2026"

### Requirement: The server's sentences in the reader's language
The server SHALL write each sentence it gives the app in every Interface language, and the app SHALL show the one in the reader's language. This covers the summaries of changes and the names of records in review, history and undo, conflict notes, the question and reason of suggested leads, the status of an invitation and the evidence message. A suggested lead a Member accepts SHALL keep its text in that Member's language.

#### Scenario: Review in Slovak
- **WHEN** an Editor using Slovak opens a pending Proposal that adds a baptism and a Citation
- **THEN** each change is summarised in Slovak, with the Persons and the Source named as in the Tree

#### Scenario: History in German
- **WHEN** a Member using German opens the history of a Person
- **THEN** each accepted change and each correction is described in German

#### Scenario: Accepted suggestion
- **WHEN** a Member whose account language is German accepts a suggested lead
- **THEN** the new Research lead's question and reason are in German

### Requirement: A new language is offered after a native speaker's review
Slovak, German and any later Interface language SHALL be offered in the language switch, in Settings and for invitations only after a native speaker has reviewed every text in it. Until then a reviewer SHALL be able to open it on their own device as a preview. Texts added or changed after the review SHALL be listed as awaiting review until a native speaker has checked them.

#### Scenario: Not yet reviewed
- **WHEN** the German texts have not all been reviewed by a native speaker
- **THEN** the language switch and the invitation form do not offer German

#### Scenario: Reviewer's preview
- **WHEN** the reviewer opens the preview address for Slovak on their phone
- **THEN** that phone shows the app in Slovak, marked as a preview, and other devices are unchanged

#### Scenario: Text changed after the review
- **WHEN** a change edits the Czech text of a key after the Slovak texts were reviewed
- **THEN** the review report lists that key as awaiting Slovak review, and the Owner gets an issue listing the texts that await review

### Requirement: Interface languages leave records alone
The Interface language SHALL NOT change what records say or how they are named. A Name keeps its spelling and its language tag, a Place is shown under its own names for their periods, and archives, registers and portals keep the names their holders give them. The languages a Name or a Place name can be tagged with SHALL NOT depend on the Interface languages.

#### Scenario: Place in a German interface
- **WHEN** a reader using German opens a Place whose primary name is Czech and which also had a German name until 1918
- **THEN** the Place is shown under its Czech name, with the German name among its names, as in Czech

#### Scenario: Name added in Slovak
- **WHEN** a Member using Slovak adds a Latin form of a Name
- **THEN** the Name is tagged Latin, and the languages offered for it are the same as in Czech
