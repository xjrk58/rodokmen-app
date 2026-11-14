# Kinship terms and degrees

The terms Rodokmen gives a path of kinship, in each Interface language, and how it counts the line and degree. Why it works this way: [Kinship](../explanation/kinship.md). The rules are `termCs` and `termEn` in `shared/src/kinship-terms/` (proved); every term, for every combination up to 8 generations each way, is listed in the golden files `shared/test/golden/kinship/cs.txt` and `en.txt`.

In the tables, **up** is the number of generations from the reader up to the common ancestors, and **down** the number from them down to the Person. For kinship by marriage they are those of the part by birth.

## Line and degree

| Kinship                                                                     | Line                 | Degree               |
| --------------------------------------------------------------------------- | -------------------- | -------------------- |
| by birth or adoption, up or down is 0                                       | direct               | up + down            |
| by birth or adoption, otherwise                                             | collateral           | up + down            |
| by marriage (the kin of a partner, the partner of a kin, a step child link) | of the part by birth | of the part by birth |
| the reader, a partner, a step-sibling, a co-parent-in-law, a foster pair    | none                 | none                 |

The civil code (zákon č. 89/2012 Sb.): kinship § 771, lines § 772, degree § 773, kinship by marriage § 774. The degree is the number of births between the two Persons, so a sibling is of the 2nd degree and a first cousin of the 4th. English texts say "degree (Czech law)", because English genealogy usually counts cousins and removes instead.

## Czech

The forms are male, female, and for a Person whose sex is not recorded (a neutral form, or both joined with "/").

| Kinship                                      | Term                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| up 1                                         | otec, matka, rodič                                                                         |
| up 2                                         | děd, babička, prarodič                                                                     |
| up 3 to 5                                    | "pra" for each generation over 2: praděd, prapraděd, praprapraděd; prababička; praprarodič |
| up 6 and more                                | předek, předkyně v n. pokolení                                                             |
| down 1                                       | syn, dcera, dítě                                                                           |
| down 2                                       | vnuk, vnučka, vnouče                                                                       |
| down 3 to 5                                  | pravnuk, prapravnuk, praprapravnuk; pravnučka; pravnouče                                   |
| down 6 and more                              | potomek, potomkyně v n. pokolení                                                           |
| up 1, down 1                                 | bratr, sestra, sourozenec                                                                  |
| up more than down, down 1                    | strýc, teta; "pra" for each generation of difference over 1: prastrýc, prateta             |
| up more than down, down 2 or more            | as above, with "z (down). kolena": strýc z 2. kolena                                       |
| down more than up                            | synovec, neteř, with "pra" and "z (up). kolena" in the same way: synovec z 2. kolena       |
| up equal to down, 2                          | bratranec, sestřenice                                                                      |
| up equal to down, 3 or more                  | bratranec, sestřenice z (up − 1). kolena: bratranec z 2. kolena                            |
| more than three "pra" in the collateral line | příbuzný, příbuzná                                                                         |
| half                                         | polorodý, polorodá before the term                                                         |
| one adoptive link alone                      | adoptivní otec, matka, syn, dcera                                                          |
| through an adoptive link                     | the term with "(přes osvojení)"                                                            |
| partner                                      | manžel, manželka with a recorded marriage; partner, partnerka without                      |
| partner's kin, up 1                          | tchán, tchyně                                                                              |
| partner's kin, up 1 down 1                   | švagr, švagrová                                                                            |
| partner's kin, down 1                        | nevlastní syn, dcera, dítě                                                                 |
| partner of a kin, down 1                     | zeť, snacha                                                                                |
| partner of a kin, up 1 down 1                | švagr, švagrová                                                                            |
| partner of a kin, up 1                       | nevlastní otec, matka, rodič                                                               |
| partner of a kin, up 2                       | nevlastní děd, babička, prarodič                                                           |
| partner of a kin, up 2 down 1                | přiženěný strýc, přivdaná teta                                                             |
| any other kinship by marriage                | sešvagřený, sešvagřená                                                                     |
| step-sibling                                 | nevlastní bratr, sestra, sourozenec                                                        |
| co-parent-in-law                             | svat, svatka                                                                               |
| foster                                       | pěstoun, pěstounka; svěřený syn, svěřená dcera, svěřené dítě                               |
| the reader                                   | vy                                                                                         |

The Owner chose the modern strýc and teta on both sides (no ujec, strýna or ujčina), "z n. kolena", and "pra" written out three times at most. "Prarodič" holds a "pra" of its own, so "praprapraprarodič" is "praprapraděd" with no sex recorded.

## English

| Kinship                        | Term                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| up 1, up 2                     | father, mother, parent; grandfather, grandmother, grandparent                                                                                                      |
| up 3 and more                  | great-grandfather, great-great-grandfather, then 3rd great-grandfather and on                                                                                      |
| down                           | son, daughter, child; grandson, granddaughter, grandchild, with "great" in the same way                                                                            |
| up 1, down 1                   | brother, sister, sibling                                                                                                                                           |
| down 1, up 2 or more           | uncle, aunt ("aunt or uncle" with no sex recorded), with a "great" for each generation over 2                                                                      |
| up 1, down 2 or more           | nephew, niece ("niece or nephew"), in the same way                                                                                                                 |
| up and down 2 or more          | first, second … cousin (the smaller of up and down, less 1), once, twice, n times removed (the difference)                                                         |
| half                           | "half-" before one word (half-brother), "half " before a cousin term (half first cousin)                                                                           |
| one adoptive link alone        | adoptive father, mother, parent; adopted son, daughter, child                                                                                                      |
| through an adoptive link       | the term with "(through adoption)"                                                                                                                                 |
| partner                        | husband, wife, spouse with a recorded marriage; partner without                                                                                                    |
| partner's kin                  | father-in-law, mother-in-law, parent-in-law; brother-, sister-, sibling-in-law; stepson, stepdaughter, stepchild                                                   |
| partner of a kin               | son-, daughter-, child-in-law; brother-, sister-, sibling-in-law; stepfather, stepmother, step-parent; step-grandfather, step-grandmother; uncle, aunt by marriage |
| any other kinship by marriage  | related by marriage                                                                                                                                                |
| step-sibling, co-parent-in-law | stepbrother, stepsister, step-sibling; co-father-in-law, co-mother-in-law, co-parent-in-law                                                                        |
| foster                         | foster father, mother, parent; foster son, daughter, child                                                                                                         |
| the reader                     | you                                                                                                                                                                |

Slovak and German terms come with those Interface languages (`add-interface-languages`, #113), after a native speaker has reviewed them.

## Marks

- **Possibly**: a link on the path has no Citation of normal or higher confidence. The app writes "možná {term}", "possibly {term}", with the "?" mark of a Possible relative. The mark is not part of the term.
- **A Family with no recorded marriage**: its partners are partner and partnerka, not husband and wife, but the kin of each are named and counted as kinship by marriage.
- **Half**: the two chains reach their one common ancestor through children of two different couples. One couple recorded as two Families is one couple; a Family with one known partner is a couple of its own.

## Limits

| Limit                                                                           | Value                                                                         |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Generations up from each of the two Persons                                     | 12                                                                            |
| Paths listed                                                                    | 100, the closest first                                                        |
| Work of a full answer                                                           | 200,000 units: one per step of a chain built, one per pair of chains compared |
| Work of one Person in a list (search, the person page's summary, the hourglass) | 5,000 units                                                                   |

The paths of the closest degree are always listed whole, up to the 200,000 units of a full answer even for a Person in a list, so a Person's first path is the same in a list and on their page. When a limit cuts the search, the answer says there may be more (`more`).
