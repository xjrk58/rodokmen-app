# Spec Delta

## ADDED Requirements

### Requirement: Kinship in the tree
For a Member with an own Person, the tree SHALL show the focus Person's kinship to that own Person in a strip above the tree, with its line and degree, leading to the list of paths on the person page. Each box SHALL carry its Person's kinship term in its accessible name. Changing the focus SHALL NOT change the Person the kinship is relative to.

#### Scenario: Moving up a line
- **WHEN** a Member taps his great-grandmother in the tree
- **THEN** she becomes the focus, and the strip says "prababička" ("great-grandmother"), in the direct line, of the 3rd degree

#### Scenario: Screen reader
- **WHEN** a screen reader reads the box of the Member's uncle
- **THEN** it reads his name, life years and "strýc" ("uncle")

### Requirement: Asking to be linked to one's own Person
A Member whose account is not linked SHALL be able to ask the Owner, from a person page, to link the account to that Person, and to withdraw the request. The Owner SHALL see each request in Settings and confirm it, which links the account, or refuse it. Only the Owner SHALL set the link, and an Agent SHALL NOT make a request.

#### Scenario: This is me
- **WHEN** a Member who is not linked presses "This is me" on the page of Karel Novák
- **THEN** the Owner's Settings show the request, and the Member's Settings show it as waiting for the Owner

#### Scenario: The Owner confirms
- **WHEN** the Owner confirms the request
- **THEN** the Member's account is linked to Karel Novák, the request is gone, and the Member's app shows kinship to him from then on

#### Scenario: The Owner refuses
- **WHEN** the Owner refuses the request
- **THEN** the account stays unlinked, the request is gone, and the Member sees the prompt again

#### Scenario: Already linked
- **WHEN** a Member whose account is linked opens any person page
- **THEN** the page offers no "This is me"
