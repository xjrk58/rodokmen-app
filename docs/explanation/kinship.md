# Kinship

A Member opening a person page wants to know first how that Person is related to them: "your great-grandfather", "your second cousin", "your brother-in-law". Working that out by hand through six generations of parish registers is slow and easy to get wrong, and in villages that intermarried two Persons are often related in more than one way. Rodokmen works it out from the Family links and says it in the reader's language, with the line and degree as Czech law counts them. The words are in the [glossary](../../GLOSSARY.md): **Kinship** and **Degree of kinship**.

## Relative to the reader, not to the family

Rodokmen already says whether a Person is a Relative, a Possible relative or an Unrelated person ([the relation to the family](relation-to-the-family.md)). That is relative to the Family roots, the starting points the Owner marked, and it is the same for every Member. Kinship is relative to the Member reading the page: the same Person is one Member's grandfather and another Member's great-uncle. So kinship is always computed from the reader's own Person, the Person the Owner linked to their account. The Focus Person of the tree and the Family roots are not starting points for it: moving the focus to a cousin does not make kinship relative to the cousin.

A Member whose account is not linked sees no kinship and a prompt instead. They can press "This is me" on their own person page, and the Owner confirms or refuses the request in Settings. Only the Owner sets the link, because a wrong link would make every kinship the Member sees wrong ([how to see how you are related](../how-to/see-how-you-are-related.md)).

## Line and degree, as the civil code counts them

The Czech civil code (zákon č. 89/2012 Sb., as in force in 2026) defines kinship as a relation based on blood or created by adoption (§ 771). Two Persons are kin in the direct line when one descends from the other, and in the collateral line when they have a common ancestor but neither descends from the other (§ 772). The degree is the number of births by which one descends from the other in the direct line, and in the collateral line by which both descend from their nearest common ancestor (§ 773). A father is of the 1st degree, a sibling of the 2nd, an uncle of the 3rd and a first cousin of the 4th.

Kinship by marriage (švagrovství) arises between one spouse and the kin of the other, in the same line and degree as that kin (§ 774). So the wife's brother is of the 2nd degree in the collateral line, and a son's wife of the 1st degree in the direct line. Rodokmen applies the same count to the partners of the reader's kin, and to the partners of a Family with no recorded marriage: in the registers, a missing marriage is usually a gap in the research rather than a couple who never married.

The degree is shown in every Interface language, because the Owner asked for the degree as Czech law has it. German law counts the same way (BGB § 1589); English-speaking genealogists usually count "first cousin once removed" instead, so the English text says "degree (Czech law)". The tables are in the [reference of kinship terms](../reference/kinship-terms.md).

## Terms are rules, not labels

A kinship term is built by rules of the language: Czech writes "pra" once per generation (praděd, prapraděd) and "z n. kolena" for cousins and their removes (bratranec z 2. kolena); English counts "great" and "n-th cousin, m times removed". The Owner chose the modern strýc and teta on both sides of the family, "z n. kolena", and "pra" written out three times at most, then "předek v 6. pokolení". The server chooses and spells the term in every Interface language and sends them all, as it does for the other texts of the app, so the app holds no kinship rules and an assistant gets the same words.

## Several paths, the closest first

Two Persons can be related along several paths: second cousins who married are husband and wife and also second cousins; double first cousins are first cousins twice over; with pedigree collapse there can be hundreds of paths. Rodokmen shows the closest and says how many others there are, and the person page lists every path with its common ancestors and every Person on the way.

The order is fixed: the reader and partners first, then by degree, kinship by birth before kinship by marriage at the same degree, confirmed before possible, then step-siblings, co-parents-in-law and foster pairs, which have no degree. Names never decide the order; when everything else is equal, the ids of the Persons on the path decide, so the order is the same on every device. The Owner chose to rank kinship by marriage and by birth together by degree, so a brother-in-law (2nd degree) comes before a third cousin (8th).

Two paths that enter a couple through children of the same Family are one path with both partners as common ancestors: full siblings are siblings once, not twice. Children of the same father by two wives are half-siblings ("polorodý bratr").

## The evidence behind a path

A path through a link with no Citation of normal or higher confidence reads "možná" ("possibly"), by the same rule that makes a Possible relative. The closest path comes first even when it is only possible: evidence breaks ties between paths of the same degree but never puts a farther path first (the Owner's choice). As soon as an accepted Proposal adds a confirming Citation to the weak link, the mark goes.

## Step, adoptive and foster kinship

Kinship follows birth and adoptive child links; the civil code gives adoption the effect of kinship, so an adoptive link counts as a birth ("vnuk (přes osvojení)"). A step or foster child link names its own pair only (stepson, pěstoun) and is never followed further: a foster child of the grandparents is not the reader's aunt. A parent's partner who is not a parent is a step-parent, a child of a parent's partner with no parent in common is a step-sibling, and a parent of a child's partner is a svat or svatka.

## Limits

The search goes up to 12 generations from each of the two Persons and lists at most 100 paths. The work is bounded too: each step of a chain built and each pair of chains compared counts one unit, a full answer stops at 200,000 units and a Person in a list at 5,000, and the page then says there may be more. The closest degree is always listed whole, whatever the units, so a Person's kinship in search results is the same as on their page. Persons joined only by a longer chain of Family links, such as the brother of the man who married the wife's sister, are shown as connected through so many marriages, with the chain; Persons with no chain at all are not related in the Tree.

## Computed on request, never stored

Kinship is derived from the Family links on each request, so it cannot go stale. The server keeps one copy of the Tree's Family links in memory per state of the Tree (the newest accepted change and the newest erasure) and rebuilds it when the Tree changes. Nothing about kinship is stored, and none of it goes into an Export or onto a printed Sheet ([privacy](privacy.md); [why a Sheet never shows kinship](charts.md#why-a-sheet-never-shows-kinship)).

## Proved, within limits

The rules that decide the line and degree, the search up through birth and adoptive links, the closest path, the order of paths, the evidence, half kinship, the paths that would name the reader's own parent or child, the connection chain, and the choice of the Czech and English terms are pure functions in `shared/src/kinship.ts` and `shared/src/kinship-terms/`, proved with LemmaScript (ADR 0009). Not proved: that the listing finds every path within the limits (a naive search over every chain on invented Trees checks it), the spelling of the terms (golden files), and the server's gathering of the links and its cache (tests). The exact scope is in [verification](../verification.md#scope).

The requirements are in the OpenSpec change `add-kinship`, spec `kinship`.
