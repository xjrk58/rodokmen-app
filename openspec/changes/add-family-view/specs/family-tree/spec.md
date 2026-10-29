# Spec Delta

## Purpose

Make the family tree, centred on one Person at a time, the place signed-in Members start from and move around in.

## ADDED Requirements

### Requirement: The tree is the home screen
For a signed-in Member, the app SHALL open on the tree, centred on a focus Person. The map, People, Review (for Editors) and Settings SHALL be reachable as tabs.

#### Scenario: Opening the app
- **WHEN** a signed-in Member opens the app
- **THEN** the tree appears centred on their focus Person, and the map is one tab away

### Requirement: Hourglass layout
The tree SHALL show the focus Person with their ancestors above and descendants below, partners beside each Person, and each Family's children grouped under it. It SHALL show 3 generations up and 2 down by default. The Member SHALL be able to change both, from 1 to 6, and to pan and zoom with touch.

#### Scenario: Second marriage
- **WHEN** the focus Person was married twice with children from both marriages
- **THEN** both partners appear beside them, each with their own children below

#### Scenario: Deeper ancestry
- **WHEN** a Member sets the tree to 5 generations up
- **THEN** great-great-great-grandparents appear above, where known

### Requirement: Changing the focus
Tapping a Person in the tree SHALL make them the focus, and the tree SHALL redraw around them. A long press or a second tap SHALL open their person page. Search results and person pages SHALL offer "Show in tree".

#### Scenario: Moving up a line
- **WHEN** a Member taps a great-grandmother
- **THEN** she becomes the focus, with her own parents above and her descendants below

### Requirement: Focus in the address and remembered
The focus Person SHALL appear in the app's address (`#person-<id>`), so another Member opening that address sees the same focus. The last focus SHALL be remembered on the device.

#### Scenario: Shared link
- **WHEN** a Member sends the address of the tree focused on a cousin to another Member
- **THEN** the other Member's app opens the tree on that cousin, after sign-in if needed

### Requirement: The Member's own Person
The Owner SHALL be able to link a Member to the Person who is that Member in the Tree. A linked Member's tree SHALL open on that Person when nothing else is remembered. An unlinked Member's tree SHALL open on a Family root, or on search if no Family root exists. A "Me" button SHALL return to the linked Person.

#### Scenario: New Member
- **WHEN** a relative signs in for the first time and the Owner has linked them
- **THEN** the tree opens on that relative's own Person

#### Scenario: Not linked
- **WHEN** a Member without a link opens the tree with nothing remembered
- **THEN** the tree opens on a Family root

### Requirement: Relation shown in the tree
The tree SHALL mark Possible relatives and Living people visibly. Unrelated people SHALL appear only when the Member switches them on.

#### Scenario: Weak link
- **WHEN** a Possible relative is in view
- **THEN** their box is marked as a possible relative, with the weak link drawn differently
