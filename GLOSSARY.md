# Rodokmen

Rodokmen is a private, shared family tree for one extended family, shown on a map of the places the family came from, with the Czech lands of the 19th century and earlier at its centre.

## Contributing

**Member**:
A person with an invited account. Every Member sees the whole Tree.
_Avoid_: user, account, guest

**Contributor**:
A Member who can submit Proposals but not change the Tree directly. Every new Member starts as a Contributor.
_Avoid_: viewer, guest, author

**Editor**:
A Member who reviews Proposals and may change the Tree directly.
_Avoid_: moderator, admin, reviewer

**Owner**:
The Member who invites Members, assigns roles and keeps the backups. There is one Owner.
_Avoid_: admin, superuser

**Agent**:
An AI assistant with its own account that contributes only through Proposals.
_Avoid_: bot, AI user

**Proposal**:
A set of changes to the Tree that one finding implies, submitted together for review and accepted or rejected whole. Other Members see it only after an Editor accepts it.
_Avoid_: suggestion, pull request, change request, edit

**Draft**:
A Proposal that is still on a Member's device and has not been submitted.
_Avoid_: offline edit, local change

**Tree**:
The one shared body of family data that all Members work on, across every family line.
_Avoid_: vault, database, graph, family tree file

## People

**Person**:
An individual who lived or lives, with everything the Tree knows about them.
_Avoid_: individual, ancestor (as a type), relative

**Family root**:
A Person the Owner marks as a starting point of the family, such as the couple a research effort descends from.
_Avoid_: root, proband, home person

**Relative**:
A Person linked to a Family root through parent, child or partner links, each supported by a Citation of normal or higher confidence.
_Avoid_: family member, blood relative

**Possible relative**:
A Person linked to a Family root only through at least one link whose Citations are all of low or very low confidence.
_Avoid_: maybe-relative, candidate

**Unrelated person**:
A Person in the Tree with no link to any Family root, kept because they appear in the family's Places, Houses or registers, for example as a godparent or a neighbour.
_Avoid_: stranger, non-relative, nepříbuzný (in English text)

**Label**:
A free word or short phrase a Member attaches to a Person to group them, such as a family line.
_Avoid_: tag, category

**Living person**:
A Person born within the last 100 years with no recorded death, or a Person with neither birth nor death recorded.
_Avoid_: alive, private person

**Name**:
One form of a Person's name as it was used or recorded, such as a birth name, married name, Latin or German form, or nickname. Each Person has one primary Name.
_Avoid_: alias, spelling

**Family**:
Two partners and their children, recorded as one unit. A Person can be a partner in several Families, and a child in more than one when there is a birth Family and an adoptive or foster Family.
_Avoid_: couple, household, marriage (as the record)

**Event**:
A dated happening in people's lives, such as a birth, baptism, marriage, death, burial, residence or census entry, with its Place or House and its Citations.
_Avoid_: fact, milestone, record

**Role**:
The part a Person plays in an Event: child, father, mother, godparent, witness or priest.
_Avoid_: relation, participant type

## Evidence

**Source**:
A register book or other document that records facts about people, such as a parish register (matrika), a census sheet or a land book.
_Avoid_: register (on its own), record, document

**Citation**:
A pointer to one entry in a Source: the page or frame, a transcription of the entry, a private image of the page, and a confidence from very low to very high.
_Avoid_: source (for a single entry), reference, footnote

**Family account**:
A Source that records what a relative remembers or was told, with who said it and when.
_Avoid_: oral source, hearsay, family memory

## Copies of the Tree

**Vault**:
The Owner's earlier Markdown notes in the private `rodokmen-data` repo, written before the Tree existed. It is imported once and then kept as a read-only archive.
_Avoid_: the Tree (for the Vault), Obsidian repo, data repo

**Import batch**:
The set of Proposals one run of the Vault importer submits together. The Owner may accept a whole Import batch at once.
_Avoid_: import, bulk proposal

**Export**:
A copy of the Tree that leaves the server, as GEDCOM or Markdown. In an Export, Living people keep only their name, sex, relationships and birth year.
_Avoid_: dump, download

**Backup**:
A complete, encrypted copy of the server's data, kept only for recovery and never reduced.
_Avoid_: export, snapshot

## Places

**Place**:
A settlement as it historically existed (a village, town or hamlet), with its names over time.
_Avoid_: location, village (as a type name), obec

**House**:
A homestead in a Place, known over time by its sequence of house numbers (čp.). People are born, live and die in Houses.
_Avoid_: address, building, číslo popisné (as the thing itself)

**Parish**:
A church district whose priest kept the registers for the Places in it. A Place can belong to different Parishes over time.
_Avoid_: farnost (in English text), church

**Estate**:
A manorial domain (panství) that Places belonged to until 1848, recorded with its periods.
_Avoid_: manor, dominion, Herrschaft (in English text)

**Municipality**:
Today's administrative unit (obec) that a Place lies in. It is used to find the archive that holds the Place's registers.
_Avoid_: commune, town, place (for the modern unit)

**Czech lands**:
Bohemia, Moravia and Czech Silesia. Archive lookup and historical maps apply only to Places here.
_Avoid_: Czechia (for historical periods), Czech Republic (before 1993)
