# Spec Delta

## Purpose

Tell a Member how any Person in the Tree is related to them: the kinship term in their language, the line and degree as Czech law counts them, every path along which they are related, and how sure the evidence is, worked out from the Family links by fixed rules.

## ADDED Requirements

### Requirement: Kinship to the Member's own Person
For a signed-in Member whose account is linked to their own Person, the app SHALL show how each Person it shows is related to that own Person, and to no other Person. The kinship of a Person SHALL be the same wherever it appears.

#### Scenario: Great-grandfather
- **WHEN** a Member whose own Person is Karel Novák opens the page of Jan Novák, the father of his father's father
- **THEN** the page says that Jan Novák is his great-grandfather ("praděd" in Czech), in the direct line, of the 3rd degree

#### Scenario: Their own page
- **WHEN** a Member opens the page of their own Person
- **THEN** it says that this is them, with no line or degree

#### Scenario: The focus moves
- **WHEN** a Member focuses the tree on a cousin and opens the page of the cousin's father
- **THEN** the page says how the cousin's father is related to the Member, not to the cousin

#### Scenario: Same everywhere
- **WHEN** a Member sees Jan Novák in search results and then opens his page
- **THEN** both name the same kinship

### Requirement: A Member without an own Person
When a Member's account is not linked to a Person, the app SHALL show no kinship anywhere. In its place the person page SHALL say that kinship needs the Member's own Person and how the link is made. The Owner SHALL be led to link their own account in Settings.

#### Scenario: Not linked
- **WHEN** a Contributor whose account is not linked searches for a surname and opens a result
- **THEN** the results show no kinship, and the person page says that the Owner links the account to their own Person, and how to ask

#### Scenario: The Owner not linked
- **WHEN** the Owner, whose own account is not linked, opens a person page
- **THEN** the prompt leads to Settings, where the Owner links their account

#### Scenario: Own Person erased
- **WHEN** a Member's own Person is erased from the Tree
- **THEN** the link goes with it, and the app shows the prompt again instead of kinship

### Requirement: Kinship is computed from Family links
Kinship SHALL be derived from the Family links of the Tree (parent, child and partner links, as for the relation to the family) and SHALL never be entered by hand. A Role at an Event SHALL NOT relate anyone. Kinship SHALL reflect the Tree as it is when it is asked for.

#### Scenario: Godparent
- **WHEN** a Person appears only as the godparent at the baptism of a Member's grandfather
- **THEN** no kinship between them is shown

#### Scenario: The Tree changes
- **WHEN** a Proposal that links a Person as the father of a Member's grandmother is accepted
- **THEN** the next time the Member opens his page, it says that he is the Member's great-grandfather

### Requirement: Line and degree of kinship by birth
For kinship by birth or adoption, the app SHALL show the line and degree as the Czech civil code counts them (§ 771): the direct line when one Person descends from the other, else the collateral line; the degree is the number of births by which one descends from the other, or by which both descend from their nearest common ancestor. It SHALL be counted and shown so in every Interface language.

#### Scenario: Great-grandfather
- **WHEN** the Person is the father of the reader's father's father
- **THEN** the kinship is in the direct line, of the 3rd degree

#### Scenario: Sibling
- **WHEN** the Person is the reader's sister
- **THEN** the kinship is in the collateral line, of the 2nd degree

#### Scenario: Uncle
- **WHEN** the Person is a brother of the reader's mother
- **THEN** the kinship is in the collateral line, of the 3rd degree

#### Scenario: First cousin and once removed
- **WHEN** one Person is the reader's first cousin and another is the son of that cousin
- **THEN** the first is of the 4th degree and the second of the 5th, both in the collateral line

### Requirement: Line and degree of kinship by marriage
For kinship by marriage, a partner's relative and a relative's partner SHALL take the line and degree of the relative concerned, as the Czech civil code counts affinity (§ 772), shown as kinship by marriage. Partners themselves, step-siblings, the parents of a child's partner, and foster parents and children SHALL be shown with no degree.

#### Scenario: Brother-in-law
- **WHEN** the Person is the brother of the reader's wife
- **THEN** the kinship is by marriage, in the collateral line, of the 2nd degree

#### Scenario: Daughter-in-law
- **WHEN** the Person is the wife of the reader's son
- **THEN** the kinship is by marriage, in the direct line, of the 1st degree

#### Scenario: Wife
- **WHEN** the Person is the reader's wife
- **THEN** she is named as his wife, with no line or degree

### Requirement: Kinship terms by birth
Each kinship SHALL be named with a term in the reader's Interface language, chosen by the Person's sex and in its grammatical gender, with a neutral or combined form when the sex is not recorded. Czech terms SHALL use "pra" for each further generation and "z n. kolena" for cousins and their removes; English terms SHALL use "great" and "n-th cousin, m times removed". Slovak and German terms SHALL come with those Interface languages.

#### Scenario: Ancestors
- **WHEN** the Person is the reader's father's father's father, and another the mother of the reader's mother's mother's mother
- **THEN** the first is "praděd" in Czech and "great-grandfather" in English, and the second "praprababička" and "great-great-grandmother"

#### Scenario: Aunts, uncles, nieces
- **WHEN** the Persons are the sister of the reader's father, the brother of the reader's grandfather, and the daughter of the reader's brother
- **THEN** they are "teta", "prastrýc" and "neteř" in Czech, and "aunt", "great-uncle" and "niece" in English

#### Scenario: Cousins
- **WHEN** the Persons are a daughter of the reader's uncle, and a son of a first cousin of the reader's father
- **THEN** the first is "sestřenice" and "first cousin", and the second "bratranec z 2. kolena" and "second cousin"

#### Scenario: Removed cousins
- **WHEN** the Persons are a male first cousin of the reader's father, and the son of the reader's first cousin
- **THEN** in Czech the first is "strýc z 2. kolena" and the second "synovec z 2. kolena", and in English both are "first cousin once removed"

#### Scenario: Sex not recorded
- **WHEN** the Person is a grandchild of the reader whose sex is not recorded
- **THEN** the term is "vnouče" in Czech and "grandchild" in English

#### Scenario: Far up
- **WHEN** the Person is an ancestor 7 generations above the reader
- **THEN** the term is "předek v 7. pokolení" in Czech and "5th great-grandfather" in English

### Requirement: Kinship terms by marriage
Kinship by marriage SHALL be named with the in-law term of the reader's language where one exists, and otherwise with a general term for kinship by marriage beside its line, degree and path. A partner SHALL be named husband or wife when the Tree records their marriage, and partner otherwise.

#### Scenario: Parents-in-law and children-in-law
- **WHEN** the Persons are the father of the reader's wife, the wife of the reader's son, and the husband of the reader's daughter
- **THEN** they are "tchán", "snacha" and "zeť" in Czech, and "father-in-law", "daughter-in-law" and "son-in-law" in English

#### Scenario: Brothers- and sisters-in-law
- **WHEN** the Persons are the husband of the reader's sister, the brother of the reader's wife, and the wife of the reader's brother
- **THEN** the first two are "švagr" and the third "švagrová" in Czech, and "brother-in-law" and "sister-in-law" in English

#### Scenario: Married into the family further away
- **WHEN** the Person is the husband of the reader's first cousin
- **THEN** he is named as related by marriage ("sešvagřený" in Czech), in the collateral line, of the 4th degree, with the path through the cousin

#### Scenario: Partner without a recorded marriage
- **WHEN** the reader and the Person are the partners of a Family with no marriage recorded
- **THEN** she is named "partnerka" in Czech and "partner" in English, not wife

### Requirement: Half, step, adoptive and foster kinship
Kinship SHALL follow birth and adoptive child links. A term SHALL say half when both descend from one common ancestor through different Families. A path through an adoptive link SHALL say adoptive or through adoption, and count it as a birth. A step or foster child link, or a parent's partner who is not a parent, SHALL give a step or foster term between those two only, never followed further.

#### Scenario: Half-brother
- **WHEN** the Person is a son of the reader's father and his second wife, who is not the reader's mother
- **THEN** he is "polorodý bratr" in Czech and "half-brother" in English, in the collateral line, of the 2nd degree

#### Scenario: Through adoption
- **WHEN** the Person is a birth son of a daughter the reader adopted
- **THEN** he is "vnuk (přes osvojení)" in Czech and "grandson (through adoption)" in English, in the direct line, of the 2nd degree

#### Scenario: Stepmother
- **WHEN** the Person is the second wife of the reader's father and not the reader's mother
- **THEN** she is "nevlastní matka" in Czech and "stepmother" in English, by marriage, in the direct line, of the 1st degree

#### Scenario: Own child, not a stepchild
- **WHEN** the Person is a son of the reader and the reader's wife
- **THEN** he is named as the reader's son, and no path names him a stepson

#### Scenario: Foster child of the grandparents
- **WHEN** the Person is a foster child of the reader's grandparents
- **THEN** no kinship to the reader is shown through the foster link, and the grandparents' pages show the foster link as it is recorded

### Requirement: Kinship along several paths
When two Persons are related along more than one path, the app SHALL show the closest with the number of the others, and SHALL list every path on request with its term, line, degree, marks, common ancestors and each Person on the way. Paths that differ in any Person SHALL count separately; the two partners of one Family as common ancestors SHALL make one path.

#### Scenario: A wife who is also a cousin
- **WHEN** the reader married Marie Nováková, who is also his second cousin
- **THEN** her page names her as his wife, says that they are related in one more way, and the list shows her as his second cousin ("sestřenice z 2. kolena"), in the collateral line, of the 6th degree

#### Scenario: Double first cousins
- **WHEN** two brothers married two sisters, and the reader is a child of one couple
- **THEN** a child of the other couple is the reader's first cousin, related in one more way, and both paths are of the 4th degree

#### Scenario: Full siblings
- **WHEN** the reader and the Person are children of the same Family
- **THEN** they are siblings along one path, with both parents as its common ancestors

#### Scenario: Every Person on the way
- **WHEN** the reader lists the paths to a second cousin
- **THEN** each path names every Person from the reader to the cousin with the step to the next (father, son and so on), each leading to that Person's page

### Requirement: Paths in a fixed order
Paths SHALL be ordered by fixed rules: the reader and their partners first, then by degree, kinship by birth before kinship by marriage at the same degree, confirmed before possible, then by the generations up from the reader, then by the ids of the Persons on the path. Names SHALL NOT decide the order. The first path SHALL be the closest the Tree records within the limits.

#### Scenario: Two cousinships
- **WHEN** the Person is both the reader's second cousin and his third cousin
- **THEN** the second cousinship comes first and is the one shown

#### Scenario: Brother-in-law and cousin
- **WHEN** the Person is the brother of the reader's wife and also his third cousin
- **THEN** brother-in-law (2nd degree) comes first, and third cousin (8th degree) second

#### Scenario: Equal paths
- **WHEN** two paths have the same degree, kind, evidence and generations
- **THEN** they come in the same order every time, decided by the ids of their Persons

### Requirement: Kinship follows the evidence
A path SHALL be marked possible when at least one of its links has no Citation of normal or higher confidence, as for a Possible relative, and its term SHALL then read "possibly". When an accepted Proposal adds a Citation of normal or higher confidence to every such link, the mark SHALL go.

#### Scenario: Weak father link
- **WHEN** the only Citation of the father link between the reader's grandfather and his father has low confidence
- **THEN** the great-grandfather's page says "možná praděd" in Czech and "possibly great-grandfather" in English, marked as possible

#### Scenario: Evidence improves
- **WHEN** a Proposal that adds a Citation of high confidence to that father link is accepted
- **THEN** the page says "praděd" with no mark

### Requirement: Kinship follows fixed rules
Kinship SHALL be computed by fixed rules alone, with no AI model. The same Tree SHALL give the same paths, order, terms, lines and degrees, whatever the device, the browser's locale or the order in which records are read, and the app and the MCP server SHALL give the same answer.

#### Scenario: Records in another order
- **WHEN** the server reads the same Families and child links in a different order
- **THEN** the kinship is the same, path for path

#### Scenario: App and assistant agree
- **WHEN** an assistant asks for the kinship of a Member's own Person and a cousin on the day the Member opens the cousin's page
- **THEN** it receives the same paths in the same order with the same terms

### Requirement: Limits of the kinship search
Kinship SHALL be searched up to 12 generations up from each of the two Persons, and at most 100 paths SHALL be listed; when a limit cuts the search, the app SHALL say there may be more. Persons joined only by a longer chain of Family links SHALL be shown as connected, with the number of marriages and the shortest chain; Persons with no chain SHALL be shown as not related in the Tree.

#### Scenario: Many paths
- **WHEN** two Persons are related along more than 100 paths
- **THEN** the first 100 in the order are listed, and the page says there may be more

#### Scenario: Through two marriages
- **WHEN** the Person is the brother of the man who married the sister of the reader's wife
- **THEN** the page says that they are connected through 2 marriages and shows the chain, with no term and no degree

#### Scenario: No chain
- **WHEN** no chain of Family links joins the reader and the Person
- **THEN** the page says that the Tree records no kinship between them

### Requirement: Kinship as data
The API SHALL return the kinship of a Person to the caller's own Person, or to a starting Person the caller names, as data: every path in order with its Persons and links, line, degree, marks and term in every Interface language, the limits reached, and the state of the Tree it comes from. A request with no starting Person from an account with no own Person SHALL be refused, saying so.

#### Scenario: A Member asks
- **WHEN** a Member with an own Person asks for the kinship of a cousin
- **THEN** the answer holds every path from the Member's own Person, in the order the app shows them

#### Scenario: An Agent names both
- **WHEN** an Agent asks for the kinship of two Persons it names
- **THEN** the answer holds the paths between them, as a Member would get them with the first as their own Person

#### Scenario: No starting Person
- **WHEN** an Agent asks for the kinship of a Person without naming a starting Person
- **THEN** the request is refused, naming the missing starting Person

### Requirement: What kinship reveals
Kinship SHALL be shown only to signed-in Members and to Agents, who already read the whole Tree, and SHALL show no Person or fact they could not read otherwise. It SHALL never reveal which Person another Member's account is linked to, and SHALL NOT appear in an Export or on a Sheet. Living people on a path SHALL appear as they do in the tree.

#### Scenario: Another Member's own Person
- **WHEN** a Member or an Agent asks for kinship in any way the API offers
- **THEN** no answer says which Person another Member is

#### Scenario: Not signed in
- **WHEN** someone who is not signed in opens the app
- **THEN** they see no kinship, as they see nothing about any Person

#### Scenario: A Living cousin
- **WHEN** a path runs through a Living person
- **THEN** the Member sees that Person on the path as the tree shows them, and an Export of the Tree holds no kinship at all
