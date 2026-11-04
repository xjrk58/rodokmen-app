# Proposal

## Why

The Owner draws family tree charts by hand today: one decorative, printable sheet per chart, written with an AI's help and rendered to PNG and PDF. Each sheet takes work, two sheets of the same family can disagree, and a sheet goes stale as soon as the Tree changes. The Owner asked for charts that Rodokmen generates from the Tree itself, either from a chosen ancestor or from a House, by fixed rules and with no AI model involved, so that the same Tree always gives the same chart and any Member can make one.

## What Changes

- A new **Chart** screen in the app draws two kinds of Chart from the Tree:
  - a **Descendant chart** from a Person or a Family: their descendants with partners, 4 generations by default (2 to 8). It comes in two forms. The tree form shows every branch. The line form draws the **Direct line** from the start down to a chosen descendant, such as the Member's own Person or the Focus Person, as the centre column, with each couple's children listed under it and the siblings' Families as smaller cards beside it. In the tree form, a Direct line is highlighted in place.
  - a **House chart**: the Families who lived at a House, in time order, with their period at the House, the house number of that period, their children, and how each Family is linked to an earlier one (a son or daughter of it, a partner who married in, a widow or widower who remarried), as far as the Tree's Family links show it.
- Each card shows what the Tree records: the primary Name (with the birth surname of a married woman), birth or baptism and death or burial with date and Place or House, the marriage with date and Place, and marks for Living people, Possible relatives, the Direct line and children who died young.
- **Determinism**: the same Tree, options, reader's language and day give the same Chart, byte for byte as an SVG file. The order is total (by date, uncertain and unknown dates included, then by the Tree's recorded order, then by id), and nothing depends on randomness, the device, the browser's locale or the order in which records load. The selection and order rules are proved with LemmaScript (ADR 0009). The layout and drawing are checked against golden files.
- **On screen**: pan and pinch-zoom on a phone and a desktop. Tapping a card opens the person page. A Chart has its own address, so a link opens the same Chart for another Member. A Chart opened before stays readable and printable offline.
- **Sheets**: print to PDF through the browser on A4 or A3, portrait or landscape. A Chart too large for one sheet is split by branches into numbered sheets with "continued on sheet n" marks. A sheet can also be downloaded as SVG (with its fonts embedded) or as PNG. A sheet has a frame, a title, an ornament, a legend of the symbols it uses and a colophon naming the Sources behind it, set in bundled serif and blackletter fonts under the SIL Open Font License.
- **Living people**: on screen they appear as in the tree. On a sheet they are reduced as in an Export: name, sex, relationships and birth year only. The Member can also leave their names off the sheet altogether.
- **Size limits**: at most 500 Person cards in a Chart, cut at whole generations, with "more below" marks that open a Chart from there. A House chart shows at most 80 Families, or a period the Member chooses.
- Every Member can make, print and download Charts. Agents get the Chart's content (who is in it, in what order, with what facts and links) as data through a new MCP tool, not as a picture.
- Labels, dates and counts appear in the reader's Interface language. Names and Place names appear as the Tree records them.

Out of scope:

- A pedigree (ancestor) chart. The design leaves room for it as a third kind, and recommends it as the next change (see design.md).
- Recording who held a House, how it passed (inheritance, purchase, marrying in), an occupation or social status, or a House name. The Tree does not record these today (design.md, "What the House chart can and cannot know"). Each needs a tree-model change of its own and a new issue.
- Fan charts (rejected in `add-family-view` as unreadable on a phone), moving cards by hand, and notes written onto a sheet.
- Charts saved on the server, public links to a Chart, and Charts for visitors who are not signed in.
- Rendering PDF or PNG on the server, and any AI model in making a Chart.
- A sheet with full details of Living people (see design.md, "Open Questions").
- Uploaded emblems or coats of arms. The ornament is a fixed drawing.

## Capabilities

### New Capabilities

- `tree-charts`: the Descendant chart and the House chart: what each holds and in what order, what each card shows, the Direct line, size limits, the Chart screen, printing and downloads, Living people on a sheet, who may make Charts, and the labels' language.

### Modified Capabilities

- `agent-access`: a new requirement adds an MCP tool that returns a Chart's content as data. Main specs are empty because no change is archived yet, so the delta adds a requirement, as `add-research-leads` did for the same capability.

## Impact

- **Shared**: new pure, proved rules for selection, order, the Direct line, the House chart's rows and succession, "died young", and the reduction of a Living person on a sheet (`shared/src/charts.ts`, `shared/src/house-chart.ts`, `shared/src/sheet-reduction.ts`), with Zod schemas for the Chart model (`shared/src/schemas/charts.ts`). `add-exports-and-erasure` is to reuse the same reduction.
- **Server**: `GET /api/charts/descendants` and `GET /api/charts/house/{id}` (action `read`), built on the existing descendants query; `server/openapi.json`. Each request is one bounded query and a pure function, with no headless browser and no rendering on the 4 GB server.
- **MCP server**: one new tool, `get_chart`.
- **App**: a Chart screen and its addresses (`#chart/…`), pure layout modules beside `hourglass-layout.js`, one drawing template rendered by Preact on screen and as an SVG string for files, print CSS with named pages, SVG and PNG downloads, entry points on the person page, the tree and the House of an Event. The pan and zoom of `tree-screen.js` move into a module both screens use. New i18n keys in every Interface language.
- **Fonts**: EB Garamond and Grenze Gotisch as WOFF2 files under `app/vendor/fonts/` (about 350 KB, precached so that a sheet prints offline), with their OFL texts. Each gets its line in `docs/reference/licences.md`.
- **Fixture Tree**: an invented House succession (a son taking over, a son-in-law marrying in, a widow remarrying) and a family large enough to reach the size limit.
- **Checks**: an ESLint rule that keeps the clock, randomness and locale-dependent calls out of the Chart modules, golden files for Chart models, layouts and SVG in Czech and English, and Playwright tests at 390 px and desktop size, under the app's Content-Security-Policy.
- **Docs**: a how-to guide, a reference page and an explanation page for Charts, GLOSSARY.md (Chart, Sheet, Direct line), README.md, `docs/reference/api.md`, `docs/reference/mcp-tools.md`, `docs/reference/licences.md`, `docs/explanation/privacy.md` and the regenerated `docs/verification.md`.
- **Depends on**: `add-family-view` (built: tree, person page, cache, Preact). The labels work with Czech and English today, and with Slovak and German once `add-interface-languages` (#113) lands. The Living rule may change with #58 and #59, and Charts follow it with no change of their own. Whichever of this change and `add-exports-and-erasure` (#19) is built first writes the shared reduction of a Living person, and the other reuses it.
