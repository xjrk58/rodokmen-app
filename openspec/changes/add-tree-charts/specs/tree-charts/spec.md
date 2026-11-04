# Spec Delta

## Purpose

Let Members generate family tree charts from the Tree by fixed rules, with no AI model involved: a Descendant chart from a Person or a Family, and a House chart of the Families who lived at a House. Show them on screen, and print or download them as Sheets that protect Living people.

## ADDED Requirements

### Requirement: Charts follow fixed rules
A Chart SHALL be made from the Tree's records by fixed rules alone, with no AI model. The same Tree, options, reader's language and day SHALL give the same Chart: the same Persons in the same order and the same SVG file, byte for byte. The device, the browser's locale and the order in which records arrive SHALL NOT change it.

#### Scenario: Two devices
- **WHEN** two Members on the same day download the SVG of the same Descendant chart with the same options and language, one on a phone and one on a desktop computer
- **THEN** the two files are the same, byte for byte

#### Scenario: Records in another order
- **WHEN** the server reads the same Families, children and Events in a different order
- **THEN** the Chart is the same

#### Scenario: The Tree changes
- **WHEN** a Proposal that adds a child to a Family shown in a Chart is accepted
- **THEN** the next time the Chart opens it holds the child, in the child's place by birth date

### Requirement: Descendant chart
A Descendant chart SHALL start at a Person or a Family and show their descendants, each with their partners, for the chosen number of generations counting the start as the first: 4 by default, from 2 to 8. Each Family's children SHALL appear under its couple. Birth and adoptive children SHALL be followed to their own descendants. Foster and step children SHALL be shown in their Family, marked, and not followed.

#### Scenario: From a couple
- **WHEN** a Member makes a Descendant chart of 3 generations from the Family of Jan Novák and Marie Nováková
- **THEN** it shows the couple, their children with their partners, and their grandchildren, and no great-grandchildren

#### Scenario: Second marriage
- **WHEN** the start is Jan Novák, who had children in two marriages
- **THEN** both Families appear, each with its own children, the earlier marriage first

#### Scenario: Adopted and step children
- **WHEN** a Family in the Chart has an adopted child and a step child
- **THEN** both appear in it with a dashed line, the adopted child's descendants are shown, and the step child's are not

#### Scenario: Descended in two ways
- **WHEN** two descendants of the start married each other
- **THEN** their Family and its descendants appear once, at its first place in the Chart's order, and the other place shows a card that points to it

### Requirement: Order within a Chart
Children SHALL be ordered by the earliest day their birth or baptism could be, those with no dated birth or baptism after the dated ones, then by the order their Family records them in, then by the Person's id. A Person's Families SHALL be ordered by the earliest day of the marriage, undated ones last, then by the Family's id. Names SHALL NOT decide the order.

#### Scenario: Undated child
- **WHEN** a Family has children baptised in 1801 and 1804 and a child with no recorded birth or baptism
- **THEN** the undated child comes third

#### Scenario: A range of years
- **WHEN** one child's birth is recorded as `1803/1805` and a sibling's as 1 June 1804
- **THEN** the child born `1803/1805` comes first, because the earliest day it could be is 1 January 1803

#### Scenario: Twins
- **WHEN** two children were born on the same day
- **THEN** they appear in the order their Family records them, every time the Chart is made

### Requirement: Direct line
A Member SHALL be able to name a descendant of the start as the end of a Direct line; their own Person and the Focus Person are offered first when they descend from the start. In the tree form, the cards and links of the Direct line SHALL be emphasised. In the line form, the Direct line SHALL run down the centre to its end, up to 12 generations, with each line couple's children listed under it and the siblings' Families as smaller cards beside it.

#### Scenario: Line to the Member
- **WHEN** a Member whose own Person descends from Jan Novák makes the line form of Jan Novák's Descendant chart
- **THEN** the line from Jan Novák to the Member runs down the centre, one couple per row, with the children of each line couple listed under it and the next Person of the line marked among them

#### Scenario: Siblings' Families
- **WHEN** a Person of the Direct line has a married sister
- **THEN** her Family appears beside that row as a smaller card, with her partner and her children's names and life years

#### Scenario: Not a descendant
- **WHEN** a Member names as the end of the Direct line a Person who does not descend from the start within 12 generations
- **THEN** the Chart is refused with a message that the Person does not descend from the start

#### Scenario: Two ways down
- **WHEN** the end of the Direct line descends from the start in two ways
- **THEN** the line takes the way that comes first in the Chart's order

### Requirement: What a card shows
A card SHALL show the primary Name, with the birth surname when the primary Name is a married name; the birth, or else the baptism, with its date and its Place or House; and the death, or else the burial, the same way. A House SHALL appear as its Place and the house number it had at the date of the Event. A couple SHALL show the marriage's date and Place. A fact the Tree does not record SHALL be left out, not guessed.

#### Scenario: Renumbered House
- **WHEN** Jan Novák was baptised in 1801 at a House of Kamenná Lhota that was čp. 12 until 1805 and čp. 15 afterwards, and died there in 1850
- **THEN** his card gives Kamenná Lhota čp. 12 for the baptism and Kamenná Lhota čp. 15 for the death

#### Scenario: Only a baptism
- **WHEN** the Tree records a Person's baptism and no birth
- **THEN** the card shows the baptism's date and Place with the baptism symbol

#### Scenario: Married name
- **WHEN** Marie Nováková's primary Name is her married name and her birth Name has the surname Dvořáková
- **THEN** her card reads "Marie Nováková roz. Dvořáková" in Czech and "Marie Nováková née Dvořáková" in English

#### Scenario: Nothing recorded but the Name
- **WHEN** the Tree records no Event of a Person's birth, baptism, death or burial
- **THEN** the card shows the Name alone, with no empty labels

### Requirement: Marks on cards
Cards SHALL mark Living people, Possible relatives, with a weak link drawn dotted as in the tree, and children whose link to their Family is not a birth link. A child SHALL be marked as having died young only when the recorded dates show for certain that they died before their 15th birthday.

#### Scenario: Died young
- **WHEN** a child was born on 2 March 1830 and died on 10 May 1832
- **THEN** the child is marked as having died young

#### Scenario: Not certain
- **WHEN** a child was born about 1830 and died between 1840 and 1850
- **THEN** the child is not marked, because the dates do not show that they died before their 15th birthday

#### Scenario: Weak link
- **WHEN** a descendant is linked to their parents only through a link with no Citation of normal or higher confidence
- **THEN** their card carries the Possible relative mark and the link to them is drawn dotted

### Requirement: House chart
A House chart SHALL show the Families who lived at a House, one row each, ordered by the earliest day of their Events at the House, undated rows last, then by id. A Family lived at the House when a child's birth or baptism, its marriage, or a partner's residence, census entry, death or burial is at the House. A godparent, witness, priest or informant SHALL NOT be placed at a House. Each row SHALL show its period and the house numbers of that period.

#### Scenario: Two generations
- **WHEN** Jan Novák's parents had their children baptised at a House from 1795 to 1810, and Jan and his wife had theirs baptised there from 1825 to 1840
- **THEN** the House chart shows the parents' row first, from 1795, and Jan's row after it, from 1825

#### Scenario: Renumbered House
- **WHEN** the House was čp. 12 until 1805 and čp. 15 afterwards
- **THEN** the title names both numbers with their years, and each row shows the number or numbers of its own period

#### Scenario: Godmother from next door
- **WHEN** a neighbour appears at a baptism at the House only as godmother
- **THEN** she is not in the House chart

#### Scenario: Unrelated lodgers
- **WHEN** a Family of Unrelated people had a child baptised at the House
- **THEN** their row appears only when the Member switches on Unrelated people, as elsewhere in the app

### Requirement: Succession in a House chart
A House chart SHALL link a row to an earlier row only through Family links: a partner who is a child of the earlier row's Family, as its son or daughter, the other partner then marked as having married in when they are a child of no earlier row; or a partner shared with the earlier row, as a remarriage. A row with no such link SHALL be shown as having no recorded link. A House chart SHALL NOT state who held the House.

#### Scenario: Son takes over
- **WHEN** Jan Novák, born at the House, raised his own Family there after his parents
- **THEN** his Family's row is linked to his parents' row as their son's

#### Scenario: Son-in-law marries in
- **WHEN** a daughter of a Family of the House married Josef Dvořák from another village, and their children were baptised at the House
- **THEN** their row is linked to her parents' row as their daughter's, and Josef Dvořák is marked as having married in

#### Scenario: Widow remarries
- **WHEN** a widow of the House married again and her new Family lived there
- **THEN** the new row is linked to the earlier row through her, as a remarriage

#### Scenario: A new family
- **WHEN** a Family with no Family link to any earlier row lived at the House
- **THEN** its row says that no link is recorded, and the chart does not say how the House passed to it

#### Scenario: Overlapping periods
- **WHEN** two Families lived at the House in overlapping periods
- **THEN** both rows appear with their own periods, and neither is called the holder of the House

### Requirement: Size of a Chart
A Chart SHALL hold at most 500 Person cards. When a Descendant chart would hold more, it SHALL show as many whole generations as fit, at least two, and mark each Person whose descendants are left out with how many there are. Such a mark SHALL open a Descendant chart from that Person. A House chart SHALL show at most 80 rows, and with more it SHALL ask for a period.

#### Scenario: A large family
- **WHEN** a Descendant chart of 6 generations would hold 700 Person cards, and its first 4 generations hold 380
- **THEN** it shows 4 generations, says how many descendants are left out, and marks each Person of the 4th generation who has descendants

#### Scenario: Opening a branch
- **WHEN** a Member taps the mark of a great-grandson whose descendants are left out
- **THEN** a Descendant chart from him opens, with the same options

#### Scenario: An old House
- **WHEN** a House has 95 Families recorded over 300 years
- **THEN** the House chart asks for a period, offers the years it covers, and shows the rows of the period chosen

### Requirement: Charts in the app
A signed-in Member SHALL be able to open a Descendant chart from a person page and from the tree, and a House chart from an Event at a House. A Chart SHALL pan and zoom by touch, mouse and keyboard at phone and desktop size, and a tap on a card SHALL open the person page. The address SHALL hold the Chart's kind, start and options. A Chart opened before SHALL stay readable and printable offline, marked "as of".

#### Scenario: On a phone
- **WHEN** a Member opens a Descendant chart on a 390 px wide phone
- **THEN** the top of the Chart fills the screen's width with readable names, and the rest is a pan away

#### Scenario: Shared link
- **WHEN** a Member sends the address of a House chart to another Member
- **THEN** the other Member's app opens the same House chart with the same options, after sign-in if needed

#### Scenario: Offline
- **WHEN** a Member opens a Chart viewed yesterday without a connection
- **THEN** it appears with yesterday's data and "as of" yesterday's time, and it can be printed

### Requirement: Printing and downloading a Sheet
A Member SHALL be able to print a Chart as a Sheet through the browser on A4 or A3, portrait or landscape, and download it as SVG with its fonts embedded, or as PNG. When the Chart does not fit one page with names at 7 points or larger, it SHALL be split by branches into numbered pages, each branch marked "continued on sheet n" where it leaves a page.

#### Scenario: One A3 page
- **WHEN** a Member prints a Descendant chart of 4 generations and 60 Persons on A3 landscape
- **THEN** the print preview shows one page with the whole Sheet

#### Scenario: Split into pages
- **WHEN** a Chart does not fit one A4 page with names at 7 points
- **THEN** it prints on several numbered pages, the first with the start, and each branch moved to a later page is marked with the number of that page where it leaves

#### Scenario: SVG in another program
- **WHEN** a Member downloads a Sheet as SVG and opens it on a computer without its fonts installed
- **THEN** it shows the same fonts as in the app

### Requirement: What a Sheet holds
A Sheet SHALL have a frame, a title naming the start of the Chart, a fixed ornament, the cards and lines, a legend of exactly the symbols and marks it uses, and a colophon naming Rodokmen, the state of the Tree it was made from, and the Sources cited for the facts it shows. The Member SHALL be able to replace the title with their own text, which the Chart's address keeps.

#### Scenario: Legend
- **WHEN** no child on a Sheet died young
- **THEN** its legend has no entry for the died-young mark

#### Scenario: Colophon
- **WHEN** the facts on a Sheet are cited from two parish registers
- **THEN** the colophon names both registers, and no Source cited only for facts the Sheet leaves out

#### Scenario: Own title
- **WHEN** a Member titles a Sheet "Rod Novákových z Kamenné Lhoty"
- **THEN** the Sheet shows that title, and the Chart's address keeps it

### Requirement: Living people on a Sheet
On screen, a Chart SHALL show Living people as the tree does, marked. A Sheet, printed or downloaded, SHALL reduce every Person an Export reduces to their name, sex, relationships and birth year, and leave out exact dates, Places, Houses, Sources and images. The Member SHALL be able to leave Living people's names off a Sheet as well; each is then a card that says only that the Person is living.

#### Scenario: Living grandchild
- **WHEN** a Sheet includes Petr Novák, born on 3 May 2010 at a House of Kamenná Lhota, with no recorded death
- **THEN** his card reads "Petr Novák" with the birth year 2010 only, and no day, Place or House

#### Scenario: Names left off
- **WHEN** a Member prints a Sheet with Living people's names left off
- **THEN** each Living person is a card that says "living" in the reader's language, and the lines to their family stay

#### Scenario: On screen
- **WHEN** the same Member views that Chart on screen
- **THEN** Petr Novák's card shows his full birth date and House, marked as Living

### Requirement: Who may make Charts
Every Member SHALL be able to view, print and download Charts. The API SHALL give Charts only to signed-in Members and Agents, and SHALL reduce a Sheet in the same way whoever asks for it.

#### Scenario: Contributor prints
- **WHEN** a Contributor prints a House chart
- **THEN** the Sheet is printed, with Living people reduced

#### Scenario: Not signed in
- **WHEN** a request without a session or token asks for a Chart
- **THEN** the API answers 401 and reveals nothing about whether the start exists

### Requirement: Labels in the reader's language
A Chart's labels, the meanings of its symbols, its dates and its counts SHALL appear in the reader's Interface language, each date written by that language's fixed pattern. Names, Place names and Source titles SHALL appear as the Tree records them.

#### Scenario: Two languages
- **WHEN** a Member downloads the same Sheet in Czech and in English
- **THEN** the two differ only in their labels and in how dates are written, not in which cards they show or where

#### Scenario: An approximate date
- **WHEN** a birth is recorded as `1801~`
- **THEN** the Czech Sheet reads "kolem 1801" and the English Sheet "about 1801"

#### Scenario: Counts
- **WHEN** a mark stands for 5 descendants left out
- **THEN** the Czech Sheet reads "5 potomků" and the English Sheet "5 descendants"
