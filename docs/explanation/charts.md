# Charts

A Chart is a drawing of part of the Tree that Rodokmen makes by fixed rules: a Descendant chart from a Person or a Family, or a House chart of the Families who lived at a House. This page explains why Charts are made the way they are. [Make a Chart](../how-to/make-a-chart.md) says how to make one, and [the API reference](../reference/api.md#charts) lists the routes.

## Fixed rules, no AI model

The family drew its charts by hand before: one decorative sheet per chart, written with an AI's help. Two sheets of the same family could disagree, and each went stale as soon as the Tree changed. A Chart is made from the Tree's records alone, by rules written in code, with no AI model anywhere. The same Tree, options, reader's language and day give the same Chart, down to the bytes of its SVG file, on a phone and on a desktop computer.

Nothing in a Chart depends on chance, the clock, the device's locale or the order in which records arrive:

- **Orders are total.** Children come by the earliest day their birth or baptism could be, the undated last, then as their Family records them, then by id. Families come by the marriage, then by id. Ids are compared by code units, never with `localeCompare`, whose answer depends on the device's ICU data, and names never decide an order.
- **Dates are written by fixed patterns** from the app's texts, not by `Intl.DateTimeFormat`, whose spaces and abbreviations change between browser versions.
- **Text is fitted by a table of the fonts' advance widths** that the repo keeps, not measured in the browser.
- **Coordinates are whole numbers** in tenths of a millimetre, and the SVG writer puts attributes in a fixed order and takes element ids from record ids.
- **A tool keeps it so**: an ESLint rule refuses the clock, randomness and locale-dependent calls in the Chart's modules ([Code checks](../reference/checks.md)).

## Selected on the server, drawn in the app

A Chart is made in three steps.

1. **Select.** The server gathers the rows in one bounded query per kind of record, and pure functions in `shared/` decide who is in the Chart, in what order, with which facts and marks. The result is the Chart model: JSON with no coordinates and no words in any language.
2. **Lay out.** The app turns the model into cards, lines and pages, in the style of the tree's hourglass layout.
3. **Draw.** One template turns the layout and the labels into SVG, through Preact on screen and as a string for files and print. Screen and file cannot drift apart.

The rules that decide what a Chart says live in TypeScript in `shared/`, where they can be proved. The layout is presentation, not a rule of the Tree, and the app has no build step, so it is plain JavaScript checked by golden files and invariant tests. The server renders nothing: a PDF comes from the browser's print, so no headless browser runs on the small server.

## What is proved

The rules that decide content are proved with LemmaScript ([Proofs with LemmaScript](proofs.md), [Verification](../verification.md)):

- the order of children, Families and House rows;
- who is in a Descendant chart and at which generation, and that foster and step children are shown but not followed;
- the Direct line, the first chain of child links in the Chart's order, or none when the end does not descend from the start;
- the cut to 500 cards, at whole generations, and the counts of descendants left out;
- the "died young" mark, set only when the dates show it for certain;
- which Roles place someone at a House, the rows' periods, and how a row is linked to an earlier one;
- what a Sheet keeps of a Living person.

The layout, the drawing, printing and the downloads are not proved; golden files and tests cover them.

## What a House chart can and cannot know

A House chart shows who lived at a House and how the Families there are linked: a son or daughter who stayed, a partner who married in, a widow or widower who married again. It places a Person at a House by a birth, baptism, marriage, residence, census entry, death or burial there, never as a godparent, witness, priest or informant.

The Tree does not record who held a House, how it passed (inheritance, purchase, marrying in), anyone's status or occupation as a field, or a House name. So a House chart cannot say who held it: a lodger's Family looks like the holder's, and the legend says that the rows are residents. Recording holdings would be a change of its own.

## Why a Sheet is reduced

On screen, a Chart shows the Tree as the tree does: Members see everything, Living people marked. A Sheet is made to be printed or sent, and may travel beyond the family. So every card on a Sheet is the Export view of its Person, by the same proved rule an Export uses ([Privacy](privacy.md#living-people-on-a-sheet)): a Living person keeps name, sex, relationships and birth year only, and no fact in which a Living person took part is shown, such as a marriage to a Living partner or a birth at a House. A Member can also leave Living people's names off; each is then a card that says only "living". The colophon names the Sources behind the facts the Sheet still shows, and the day the Living rule was applied.

## The fonts

A Sheet is set in EB Garamond, with a title in Grenze Gotisch, a blackletter. Both are under the SIL Open Font License, cover every letter of Czech, Slovak and German, and ship with the app, so that a Sheet prints offline and a downloaded SVG carries its fonts inside it. The symbols on cards (birth, baptism, marriage, death, burial and the marks) are drawn as paths rather than font glyphs, because a font may lack them and a device's fallback font would change the look.
