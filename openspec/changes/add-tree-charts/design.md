# Design

## Context

See proposal.md for why. What exists and constrains the approach:

- **The hourglass** (`add-family-view`, built): `hourglass()` in `server/src/tree/pedigree.ts` gathers the data, and the pure `app/src/hourglass-layout.js` turns it into boxes and lines. `app/src/tree-screen.js` draws them with Preact, with pan, pinch and wheel gestures, and fits names by a fixed width per character. `GET /api/persons/{id}/descendants` already returns 1 to 12 generations with partners and links.
- **The app has no build step** (`add-map-core`): plain ES modules, with Preact and htm vendored. It cannot run the TypeScript in `shared/`, so app code that mirrors a shared rule is checked against it by a test (`app/src/reading-draft.js`).
- **Proofs** (ADR 0009) cover pure TypeScript in `shared/` only, written in LemmaScript's subset: arrays by index, no closures over Maps, optionals kept out of ordering comparisons. `compareByEarliest` (`shared/src/edtf.ts`) is a proved comparator, but it returns 0 for equal days, so it is not a total order on its own.
- **The Tree's model** (`server/src/db/migrations/0002_tree.ts`): a House belongs to a Place and has house numbers with periods, a location and a note. An Event has one type (birth, baptism, marriage, death, burial, residence, census, other), an EDTF date, one Place or House, and Roles (child, father, mother, partner, godparent, witness, priest, deceased, informant, other). There is no field for who held a House, for an occupation or status (scan reading puts "colonus" and the like into an Event's free-text description), or for a House name. A marriage is an Event in which both partners of a Family have the Role partner.
- **The Content-Security-Policy** (`server/src/csp.ts`) allows scripts, styles and fonts only from the app's own origin and no inline `<style>` or `style` attribute. Styles set through the DOM are allowed, and so are `blob:` and `data:` images.
- **The server** is a 4 GB VPS with memory limits per container (#39).
- **The Export reduction** of a Living person (`add-exports-and-erasure`) is planned and not built. Only the leads' share of it (`exportedPersonLinks`) is proved today.
- **Checks**: ESLint allows at most 400 lines per file and complexity 20, and jscpd fails on copies of 30 lines or more.

## Goals / Non-Goals

**Goals:**

- The same input always gives the same Chart, and that can be tested byte for byte.
- No extra load on the server beyond one bounded query and a pure function per Chart: nothing is rendered there.
- Readable on a 390 px phone, printable from a phone, and working offline for Charts opened before.
- Sheets that can be shared outside the family without exposing Living people.

**Non-Goals:**

- A proof of the layout. It is presentation, not a rule of the Tree. Golden files and invariant tests cover it.
- PDF or PNG files that are byte-identical across browsers. The SVG is the reference. PDF and PNG are rasterised or written by the browser.
- Interactive editing of a Chart: dragging cards, or hiding single Persons by hand.

## Decisions

### Select on the server, lay out and draw in the app

A Chart is made in three steps.

1. **Select** (server, pure TypeScript in `shared/`). This step decides which Persons, Families and rows are in the Chart, in what order, with which facts and marks, and how a Sheet reduces Living people. Its output is the **Chart model**, JSON with no coordinates and no words in any language. The server's thin shell gathers the rows (`server/src/charts/`) and calls the pure rules, which are proved where they are rules of the Tree.
2. **Lay out** (app, pure JavaScript beside `hourglass-layout.js`). It turns the model into cards, lines and pages, in integer units of 0.1 mm.
3. **Draw** (app). One htm template turns the layout and the labels into SVG elements. Bound to Preact's `h`, it draws the screen. Bound to a small escaping string builder (`app/src/svg-string.js`), it writes SVG files and the golden files. Screen and file therefore cannot drift apart.

This is the hourglass split again. The rules that decide content can be proved, and the app keeps its no-build rule.

Alternatives considered:

- **Everything in the app.** The rules could not be proved (no TypeScript there), and the app would need every Event of every descendant, many requests where one will do.
- **Everything on the server, layout and SVG included.** The app would have to insert server-made markup into the page, against the CSP's intent and the ESLint rule against HTML strings, and every zoom or option change would need the network.
- **Rendering PDF or PNG on the server** with headless Chromium. Rejected: a few hundred MB per render on a server already fitted into 4 GB (#39), and the browser can print to PDF anyway.
- **A compiled copy of the `shared/` rules vendored into the app**, so that both run the same code. Not needed now. It is the way to go if the layout ever has to be proved, at the cost of a generated artefact in the repo that CI keeps up to date.

### The Chart model and its routes

- `GET /api/charts/descendants?person=<id>` or `?family=<id>`, with `generations` (2 to 8, default 4), `form` (`tree` or `line`), `line` (a Person id, the end of the Direct line, needed for `form=line`) and `sheet`.
- `GET /api/charts/house/{id}`, with `from` and `to` (years), `unrelated` (a boolean) and `sheet`.
- `sheet` is absent for the screen, `reduced` for a Sheet, or `nameless` for a Sheet without Living people's names.
- Both routes need the action `read` and follow a merged Person to the kept one, as the other Person routes do. They answer 400 on bad options (both `person` and `family`, generations out of range, `form=line` without `line`), 404 for an unknown start, and 422 naming `line` when the end of the Direct line does not descend from the start within 12 generations.
- The schema (`shared/src/schemas/charts.ts`, in `server/openapi.json`) holds:
  - the kind, form and options as understood;
  - `asOf`: the time and id of the last accepted Proposal (the newest `log_entry`), so a Chart names the state of the Tree it shows, and `livingOn`, the day the Living rule was applied;
  - `persons`: the cards' facts, as data and not as text. These are the Name parts, the birth surname, each Event's type, EDTF date, Place id and primary name, and house number at that date, and the marks (`living`, `possible`, `weakLink`, `diedYoung`, `linkType`, `familyRoot`);
  - the ordered structure: descendant units, or House rows with their period, numbers and link;
  - `line` (the Direct line, as Person ids), `cut` (the Persons whose descendants are left out, with the count of each, and the total left out), and `sources` (the Sources cited for the facts shown, ordered by title in code units, then by id).
- The app keeps both variants in its IndexedDB cache, `chart:<address>` and `chart-sheet:<address>`. It fetches the Sheet variant in the background whenever a Chart opens, so that the Chart prints offline. Charts count toward the cache's 400 records and its least-recently-used eviction, and at most 20 Charts are kept, so that a few large models cannot push out person pages.

### Determinism

The input is the state of the Tree, the options, the reader's language and the day on which the Living rule is applied. Nothing else enters.

- **Orders are total and proved** (spec "Order within a Chart"). Ids are compared by code units (`<`), never with `localeCompare`, whose result depends on ICU's locale data. Names never decide the order: their collation differs between languages and ICU versions.
- **Database order is ignored**: the pure functions sort what they are given. A test feeds them the same rows shuffled and expects the same model.
- **Dates** come from the proved EDTF ranges. They are written by fixed patterns per language from the i18n tables (day, month names, "kolem", "před", "po", ranges), not by `Intl.DateTimeFormat`, whose output changes between ICU versions (spaces and abbreviations), so two browsers could write the same date differently. Plural forms use the app's plural keys (`add-interface-languages`). Their CLDR categories for integers in Czech, Slovak, German and English are fixed, and a unit test pins them.
- **Text is fitted by a table of advance widths** of the bundled fonts (`app/data/chart-fonts.json`, generated from the font files by `app/scripts/font-metrics.mjs` and checked by a test that regenerates it), never measured in the browser with `getComputedTextLength`.
- **Coordinates are integers** in units of 0.1 mm, so no floating-point printing differs. The SVG builder writes attributes in a fixed order, escapes text one way, and derives element ids from record ids, never from counters.
- **A tool keeps it so** (AGENTS.md, "Tools before agents"): an ESLint block for `shared/src/charts*.ts`, `shared/src/house-chart.ts` and `app/src/chart-*.js` forbids `Math.random`, `Date.now`, `new Date`, `performance.now`, `crypto.randomUUID`, `localeCompare`, `toLocale*String`, `Intl.DateTimeFormat`, `Intl.Collator`, `getBBox` and `getComputedTextLength`. The clock reaches the rules only as the `livingOn` day, through `server/src/clock.ts`.
- **Golden files**: models from invented inputs (`shared/test/golden/charts/*.json`), models of the fixture Tree with a fixed clock (`server/test/golden/charts/*.json`), and the SVG of each fixture Chart in Czech and English, and in Slovak and German once they are offered (`app/tests/unit/golden/charts/*.svg`). They are rewritten only with `UPDATE_GOLDEN=1`, so a change shows up in the PR's diff. Playwright downloads the SVG at 390 px and at desktop size, and both must equal the golden file ("Two devices").

### Descendant chart

- **Followed links**: birth and adoptive child links lead to further descendants. Foster and step children are shown in their Family, with a dashed line, and not followed: a step child is not a descendant of the start, and a foster child usually is not either. A descendant's partners appear with the Families they share with the descendant. Their other Families are not shown.
- **Generation**: the start is generation 1 (both partners when the start is a Family). Everyone else is at the smallest number of followed links from the start plus 1. Someone reached in two ways (descendants who married each other) is drawn once, at their first place in the Chart's order, depth-first, and every later place gets a card that points to it.
- **Size**: at most 500 Person cards, counting descendants, partners and pointer cards. The rule keeps the largest number of whole generations, up to the one asked for, that stays within 500, and never fewer than 2. If even 2 generations exceed 500, which no real family does, the second generation is cut in the Chart's order and the cut is marked like any other. Every Person of the last generation shown who has descendants left out carries the number of them, and a tap on it opens a Chart from them.
- **Direct line**: the path of followed child links from the start to the chosen end that comes first in the Chart's order, at most 12 generations long. In the tree form the Direct line is emphasised as far as the Chart reaches. If its end lies deeper, the Chart says so and offers the line form. In the line form there is one row per generation of the line. Each row has the line couple's card, the list of all their children (Name, life years, marks, the next Person of the line marked), and beside it the married siblings of the next Person of the line as smaller cards (partner, and their children's Names and life years). Siblings born before the line Person go on the left and later ones on the right, outward in order. The line form does not take `generations`, because the line's length decides the number of rows.
- **Default title**, with no grammatical case to get wrong: "Rozrod – Jan Novák a Marie Nováková" in Czech and "Descendants of Jan Novák and Marie Nováková" in English, one fixed pattern per language with the names in the nominative. The Member can replace it.

### What the House chart can and cannot know

The chart uses the House, its numbers with their periods, the Events at the House with their Roles and dates, and Family links.

- **Who is placed at the House, and in which row**:
  - A birth or baptism at the House places the child and the parents (Roles child, father and mother) in the row of the child's birth or adoptive Family.
  - A marriage at the House places its Family: the Family whose two partners both have the Role partner at it.
  - A residence, census, death or burial at the House places each Person who takes part with any Role except godparent, witness, priest and informant. Their row is the latest of their Families as a partner whose marriage is not known to be later than the Event. Someone without such a Family goes in the row of their birth Family if that row exists, and otherwise in a row of their own.
- **Period** of a row: from the earliest day to the latest day of its Events at the House. Open dates widen it, and undated Events do not count. A row with only undated Events has an unknown period and comes last.
- **Row content**: the couple's cards, the period, every house number whose period overlaps the row's (a number without a period always does), the Family's children with those born at the House marked, and a mark on everyone who died there.
- **Succession** (spec "Succession in a House chart"): a row links to the latest earlier row that a Family link connects it to. A partner who is a child of that row's Family makes the link a son, a daughter, or a child when the sex is unknown. The other partner is marked as having married in when they are a child of no earlier row. A partner shared with that row makes the link a remarriage. With no such row, the link is "no link recorded".
- **Rows and periods**: at most 80 rows. With more, the Member picks a period (`from`, `to`), and the rows whose period overlaps it are shown. Unrelated people's rows are hidden unless the Member switches them on.

What the Tree does not record, and what the chart therefore cannot show:

1. **Who held the House, and how it passed** (inheritance, purchase, marrying in, assignment by the Estate). Land books, urbaria and the cadastre record this. The Tree has no Event type or Role for it. The chart shows who lived at the House and the Family links between them. A lodger's Family looks the same as the holder's, so the legend says that rows are residents, not holders.
2. **Status or occupation**, such as a farmer with a full holding, a cottager or a lodger, with its date. Today it is free text in an Event's description, which a Sheet does not print.
3. **A House name.**

A follow-up change, with its own issue (for example `add-house-holdings`), could add a `holding` Event type with the Roles holder and previous holder, a period, a manner of acquisition from a fixed list and Citations to land books; an `occupation` Event with the status as written; and a House name with periods. With holdings recorded, the House chart would draw the succession through the holders and set other residents apart. That would change "Succession in a House chart".

### Layout: written for Rodokmen, in the app

The layout is our own code, in the style of `hourglass-layout.js`.

| Candidate                    | Licence                                                                                                                 | Size                                                                                                       | Determinism                                                                                                          | Fit                                                                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Our own code                 | AGPL-3.0-or-later (ours)                                                                                                | about 1,000 lines over four modules                                                                        | by construction                                                                                                      | fits couples, several Families per Person, pointer cards, the line form and the House rows; same style and tests as the hourglass                                    |
| d3-hierarchy 3.1.3           | ISC (compatible)                                                                                                        | 15 KB minified                                                                                             | deterministic                                                                                                        | a tidy tree with one node size. Cards of different widths (a Person with two partners) need d3-flextree (WTFPL, still built on d3-hierarchy 1.x); couples and pointer cards need modelling around it |
| @dagrejs/dagre 3.1.3         | MIT (compatible)                                                                                                        | 49 KB minified, plus graphlib 14 KB                                                                        | deterministic for a fixed input, but its crossing reduction reorders siblings, which breaks the order by birth unless constrained | a layered DAG layout, good for implex, poor at keeping the order                                                                                                     |
| elkjs 0.12.1                 | `EPL-2.0 OR GPL-3.0-or-later` in its package.json, but the licence file it ships is EPL-2.0 only; usable with AGPL only under the GPL option, which would need confirming upstream | 1.6 MB minified, run in a Web Worker                                                                       | deterministic                                                                                                        | the best general layered layout; far too large for a phone app for this job                                                                                          |
| topola 3.11.1                | Apache-2.0 (compatible)                                                                                                 | 236 KB unpacked, plus d3-selection, d3-transition, d3-flextree and a GEDCOM parser                        | deterministic                                                                                                        | ready-made genealogy charts, but with its own data model (GEDCOM), its own drawing with d3-selection and its own look; it would fight the Sheet's design             |
| family-chart 0.9.0           | ISC (compatible)                                                                                                        | 650 KB unpacked, plus all of d3 7                                                                          | interactive, animated                                                                                                | an interactive editor's view, not a printable Sheet                                                                                                                  |

Our own code wins because the shapes are specific (couples, children lists, line rows, House rows) and the existing hourglass shows the approach works at this size. It adds no vendored library, it keeps the birth order exactly, and it is testable in the same way. d3-hierarchy is the fallback if the tree form turns out hard. It would be vendored like Preact, with its line in `docs/reference/licences.md`.

- **Tree form** (`app/src/chart-tree-layout.js`): a tidy tree over descendant units (the descendant's card plus one partner card per Family), each Family's children grouped under its couple. Siblings go left to right in the Chart's order, each subtree pushed right until its contour clears the previous one by a fixed gap, row by row, and each parent is centred over its children (Reingold–Tilford with contours; 500 cards need no linear-time refinement).
- **Line form** (`app/src/chart-line-layout.js`): the line couple's card at x = 0 in every row, the children list under it, and the sibling cards outward on both sides. A row is as tall as its tallest element. No contour packing is needed, because sibling cards are one level deep.
- **House chart** (`app/src/chart-house-layout.js`): one column of rows in order, at equal spacing (not to a time scale), with the periods on the left like a timeline and a rail of links (son, daughter, remarriage, married in) between rows.
- **Pages** (`app/src/chart-pages.js`): a page holds the content at a scale that keeps names at 7 points or more. If the tree form does not fit, the widest subtree (ties by order) moves to a new page and leaves a "continued on sheet n" card, and that repeats until every page fits. The line form and the House chart break between rows. Pages are numbered in the order of the branches moved.
- **Invariants tested** for every fixture and for generated trees: no two cards overlap, siblings stay in the model's order from left to right, every line ends on a card, and every Person of the model is drawn exactly once, apart from pointer cards.

### Cards, text, symbols and fonts

- Card sizes are fixed per kind: the line card, the tree card, the sibling card and a line of a children list. Each card has fixed text slots: the Name in up to two lines, a birth line and a death line, and a marriage line where the couple joins. Text is fitted with the width table: up to 15 % narrower through `textLength`, then cut with "…". This is the idea of `fit()` in `tree-screen.js`, with real widths.
- The symbols (`*` birth, `~` baptism, `⚭` marriage, `†` death, `□` burial, died young, Possible relative, Direct line, a non-birth link, "continued on sheet n") are drawn as SVG paths, not font glyphs. The fonts lack some of them, and a device's fallback font would change the look. The legend draws the same paths.
- Fonts, checked for every letter of Czech, Slovak and German:
  - **EB Garamond** (OFL-1.1, The EB Garamond Project Authors) for the text: regular, italic and semibold, the Latin and Latin Extended subsets as Fontsource 5.3.0 publishes them (`@fontsource/eb-garamond`), about 320 KB.
  - **Grenze Gotisch** (OFL-1.1, The Grenze Gotisch Project Authors), a blackletter, for the title: regular, Latin and Latin Extended, about 30 KB.
  - Rejected: UnifrakturMaguntia and UnifrakturCook, whose published files lack č, ď, ě, ň, ř, š, ť, ů and ž, so a Czech title would fall back to another font. Cormorant Garamond is the alternative serif (it covers Czech, about 43 KB a style).
  - Neither chosen font has a Reserved Font Name, and the files are used as published, so the OFL's renaming clause does not come into play. Each font's `OFL.txt` sits beside it in `app/vendor/fonts/`, copied by a vendor script with a `VERSION` file as for Preact, and gets its line in `docs/reference/licences.md`.
  - The fonts are precached (about 350 KB), so that a Sheet prints offline with them.
- An SVG file embeds the fonts it uses as `data:` WOFF2 in its own `<style>`. The file lives outside the app, so the app's CSP does not apply to it, and the OFL allows embedding fonts in documents. On screen the fonts come from `styles.css`.

### On screen, printing and downloads

- **Screen** (`app/src/chart-screen.js`, Preact). The gestures of `tree-screen.js` move to `app/src/pan-zoom.js` and both screens use them; jscpd would fail a copy. The first view fits the width of the top rows on a phone and the whole Chart on a desktop when names stay at 9 px or more. Arrow keys pan and `+` and `−` zoom. A tap opens the person page, and a long press or the stub's button opens "Chart from here".
- **Options panel**: kind and form, generations (2 to 8), the Direct line (own Person and Focus Person first, then a search among descendants), the Unrelated switch and the period for a House chart, the title, the paper (A4 or A3, portrait or landscape), and Living people on the Sheet (reduced, or without names).
- **Entry points**: "Chart" on the person page and in the tree (from the Focus Person), and the House of an Event on the person page. There is no House page yet, so this is the first view of a House.
- **Addresses**: `#chart/descendants/person/<id>`, `#chart/descendants/family/<id>` and `#chart/house/<id>`, with the options after `?`. The app writes the keys sorted and leaves defaults out, so each Chart has one address. The pure parser in `app/src/routes.js` is unit-tested.
- **Printing**: `window.print()` with the Sheet's pages in a container shown only in print. Each page is one SVG sized in millimetres, and `styles.css` declares named pages (`@page a3-landscape { size: A3 landscape; margin: 8mm }` and so on), chosen by a class, so the CSP holds. Chrome on Android saves to PDF from the same dialog.
- **SVG download**: the whole Chart as one SVG at its natural size, not split, because a vector file scales. Print splits it into pages.
- **PNG download**: the SVG file drawn into a canvas through a `blob:` image, at most 16 megapixels and 8,192 px on the longer side (phone canvas limits). A larger Chart is scaled down, and the app suggests SVG or print instead. A PNG is not promised byte for byte across devices.

### Living people, roles and Agents

- **On screen** the Chart uses the screen variant: Members see the whole Tree, Living people marked as in the tree.
- **A Sheet** is always drawn from the Sheet variant, never from the screen variant. The server reduces it with `sheetPerson()` (`shared/src/sheet-reduction.ts`, proved): a Living person keeps name, sex, relationships and birth year, and `nameless` drops the name as well. The SVG builder refuses a model that is not marked as a Sheet, so a file cannot carry unreduced data by mistake, and a test checks that.
- **Who is reduced** is decided by the one predicate an Export uses. Today that is the Living rule. If #58 changes the threshold or #59 adds a window after death, the predicate changes and Charts follow with no change of their own. `add-exports-and-erasure` is to call `sheetPerson()` for its reduction, or, if it is built first, this change calls its function instead. Either way there is one reduction.
- **Roles**: Charts are the action `read`, for every Member and every Agent, with no new action. The GEDCOM download is the Owner's because it is the whole Tree. A Sheet is a bounded part of what every Member already sees, and it is reduced.
- **Agents**: the MCP tool `get_chart` passes the screen variant's model through, as `get_descendants` passes the descendants. Agents read the whole Tree already. A call counts as one read request. An Agent gets no picture: the point of a Chart is that no model draws it.

### Labels and languages

Chart texts live under `chart.*` keys in `app/i18n/<lang>.json`: titles, the legend, the symbols' meanings, the colophon, "čp." and its counterparts, date words and patterns, and counts with plural keys. Czech and English are written with this change. Slovak and German come with `add-interface-languages`, whose i18n check then demands them. Names, Place names (the Place's primary name, as on the person page) and Source titles are never translated.

### The pedigree chart

The options were:

- (a) None: the hourglass shows up to 6 generations of ancestors on screen.
- (b) A printable pedigree Sheet as a third kind, in the next change: the existing ancestors query (1 to 12 generations), a proved selection with Sosa–Stradonitz (Kekulé) numbers as its natural total order, implex shown by number references, a binary-tree layout that needs no library, and the cards, Sheets, fonts and privacy of this change.
- (c) In this change.

We recommend (b). It costs little once this change is in, and it is the classic printed chart in Czech genealogy. Doing it now would double the test matrix of a change that is already large.

### Rules proved with LemmaScript

Each rule is a pure function, proved with `lsc check` and naming its requirement with `//@ contract`. The server's gathering queries, the app's layout and drawing, printing and downloads are the unverified shell, and tests cover them.

- **Order** (`compareChildren`, `compareFamilies`, `shared/src/charts.ts`; tree-charts "Order within a Chart"). Proved: antisymmetric (`compare(a, b) = −compare(b, a)`), 0 only for the same id (total), and transitive, with a hand-written lemma like `compareByEarliest_transitive`. Dated before undated, then the recorded order, then the id.
- **Selection** (`selectDescendants`, `shared/src/charts.ts`; tree-charts "Descendant chart"). Proved: the result is exactly the Persons reached from the start through birth and adoptive links within the generations asked for, each at its smallest generation and once. Foster and step children are in their Family and never expanded, and every partner shown shares a Family with a selected descendant.
- **Size** (`cutToSize`, `shared/src/charts.ts`; tree-charts "Size of a Chart"). Proved: the generations kept are whole, at least 2, and within 500 cards unless 2 already exceed it. Every Person of the last generation kept with descendants left out is marked with the exact count, and the counts add up to the total left out.
- **Direct line** (`directLine`, `shared/src/charts.ts`; tree-charts "Direct line"). Proved: the result is a chain of followed child links from the start to the end, the first such chain in the order, and empty exactly when the end does not descend from the start within 12 generations.
- **Died young** (`diedYoung`, `shared/src/charts.ts`; tree-charts "Marks on cards"). Proved: true exactly when both days are known and the latest death day falls before the 15th birthday counted from the earliest birth day.
- **House rows** (`houseRows`, `shared/src/house-chart.ts`; tree-charts "House chart"). Proved: every row has at least one Event at the House that places it; no godparent, witness, priest or informant Role places anyone; each period is the earliest and latest day of its Events; the order is total.
- **Succession** (`succession`, `shared/src/house-chart.ts`; tree-charts "Succession in a House chart"). Proved: a link is son, daughter or child exactly when a partner is a child of the earlier row's Family; married in exactly when the other partner is a child of no earlier row; remarriage exactly when the rows share a partner; and otherwise none. The output has no holder field at all.
- **Reduction on a Sheet** (`sheetPerson`, `shared/src/sheet-reduction.ts`; tree-charts "Living people on a Sheet", and exports "Living people are reduced in every Export" once that change calls it). Proved: for a Person the predicate reduces, the output holds only name (none when nameless), sex, relationships and birth year, with no exact date, Place, House, Source or image. For any other Person it is unchanged.

## Risks / Trade-offs

- [The layout is not proved] → The rules that decide what a Chart says are proved on the server. The layout has golden files and invariant tests (no overlaps, order kept, everything drawn once).
- [Golden files get rewritten without a look] → They change only with `UPDATE_GOLDEN=1`, the fixtures are small, and the diff of an SVG is readable in review.
- [A House chart reads as a list of holders] → The legend says that rows are residents, linked only by family. The holdings change is proposed as its own issue.
- [The same Tree gives a different Sheet tomorrow] → Only when someone stops or starts counting as Living, which is the protection working. The colophon names the day.
- [The fonts add about 350 KB to the precache] → The alternative is to load them on the first Chart and keep them at run time, which loses offline printing until then. This is a point for the Owner.
- [Large SVG files] → A Chart of 500 cards with embedded fonts comes to roughly 0.5 to 1 MB, acceptable for a download.
- [Named pages in print CSS] → Chrome (including Android) and Firefox 110 and later support them. On other browsers the Member picks the paper in the print dialog. Playwright checks Chromium's PDF.
- [Canvas limits for PNG on phones] → The pixel cap and the message to use SVG or print.
- [A Sheet without names still shows how many Living people there are] → It keeps the Chart readable. Leaving them out entirely would be a third Sheet option, a point for the Owner.
- [Two large Charts fill the cache] → At most 20 Charts are cached, least recently used first.
- [`add-exports-and-erasure` designs its own reduction] → Its design already says "one function in `shared/`". Its issue (#19) gets a comment pointing to `sheetPerson()`.

## Migration Plan

There is no database migration. The change adds two routes, an MCP tool, a screen, fonts and i18n keys, and can ship behind no switch: nothing existing changes behaviour. The gestures move from `tree-screen.js` to `pan-zoom.js` with the tree's tests unchanged. Rollback is a revert. Cached Charts are ignored by an older app, whose cache never reads those keys, and age out.

## Open Questions

Points for the Owner. The specs and tasks follow the recommended answer. An answer marked "changes the spec" would change the requirement named, before implementation starts.

1. **Pedigree Sheet**: as the next change (recommended), in this one, or not at all?
2. **Holders, occupation and House names**: open a change to record them (recommended, as its own issue)? Until then the House chart shows residents and Family links only.
3. **Full details of Living people on a Sheet**, for family use only, perhaps for the Owner with a warning? Recommended: no for now. Changes the spec, "Living people on a Sheet".
4. **Leaving Living people out of a Sheet entirely**, as a third option next to reduced and without names? Changes the spec, "Living people on a Sheet".
5. **Who may print and download**: every Member (planned), or Editors and the Owner only? Changes the spec, "Who may make Charts".
6. **"Died young"**: before the 15th birthday (planned), or before the first (infants only), or before the 18th?
7. **Foster and step children** shown and not followed (planned): right for the family's charts?
8. **The look**: EB Garamond with a Grenze Gotisch title, a fixed ornament, A3 landscape as the default paper, 4 generations by default. Should anything from the Vault sheets carry over as a fixed design element (described in words only)?
9. **Fonts**: precached for offline printing (planned, about 350 KB), or loaded on the first Chart?
