# Spec Delta

## Purpose

Let Members keep the evidence itself with the Tree: images of register pages, their own photos of documents and graves, and portraits of people, all private to the family.

## ADDED Requirements

### Requirement: Attach images to Citations and Persons
Members SHALL be able to add page images and their own photos (register pages, letters, gravestones) to a Citation, and portraits to a Person, from the phone camera or from files, as part of a Proposal.

#### Scenario: Photo in the archive
- **WHEN** a Member photographs a register page with the phone camera while writing a Draft
- **THEN** the photo is stored with the Draft and travels with it into the Proposal

### Requirement: Originals are kept
The system SHALL keep the original file of every accepted image and SHALL show a resized copy for viewing. Images up to 25 MB in JPEG, PNG, WebP or HEIC SHALL be accepted.

#### Scenario: Zooming into a page
- **WHEN** a Member opens a page image and asks for full resolution
- **THEN** the original file is shown

#### Scenario: iPhone photo in HEIC
- **WHEN** a Member adds a photo an iPhone took in HEIC, held upright by the file's rotation, possibly with other images in the same file
- **THEN** the server converts it in the same queue as other images, within the same 25 MB and at most 50 million pixels, keeps the HEIC original, and makes the usual resized copy of its primary image, turned upright once

#### Scenario: Damaged HEIC
- **WHEN** a Member adds a HEIC file that cannot be decoded
- **THEN** the upload is refused as an unreadable image, like any other image that cannot be read, and nothing of it is kept

### Requirement: Images of pending Proposals stay with the Proposal
Images in a pending or rejected Proposal SHALL be visible only to its author and the Editors. Images in a rejected Proposal SHALL be deleted after 30 days.

#### Scenario: Rejected image
- **WHEN** a Proposal with an image is rejected
- **THEN** other Members never see the image, and it is deleted after 30 days

### Requirement: Images never leave the family
Images SHALL be served only through links that expire, and SHALL never be part of an Export.

#### Scenario: Export run
- **WHEN** the nightly Export runs
- **THEN** it contains no image files and no image links
