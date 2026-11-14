# Proposal

## Why

The family map shows where Events happened, decade by decade, and one Person's life path at a time. It does not show how the family moved: which villages a line came from, which villages marriages joined, and how that changed over the generations. And every House sits on its village's point, so the map cannot say which house in a village. The Owner asked, on 2026-11-14, to "improve the map and to show links in time and more detailed positions" (#166), and answered: animate the links over time, letting a link change its width and colour as it does; only the Relatives of the Family roots; House positions from the stable cadastre maps.

## What Changes

- **Map lines** on the family map, for signed-in Members:
  - a **generation line** from where a parent was born to where their child was born, and a **marriage line** between where two partners who married were born. Where a Person was born is their birth, else baptism, Event's House position, else its Place;
  - **Relatives only**: every Person at a line's ends is a Relative. Possible relatives and Unrelated people make no lines. The lines follow the relation to the family as the server last computed it, so they change when a Family root moves or evidence changes;
  - **over time**: a line shows while one of its births or marriages lies in the year range. Its **width** grows in four steps with how many births or marriages it carries in the range, and its **colour** says its kind and fades with the age of its newest one. Kind also shows as a pattern (solid or dashed), so colour is never the only cue. A legend explains both;
  - **play**: the play control moves the whole range forward by 1, 5 or 10 years (5 by default), keeping its width, from 1600–1629 when the range is the full one. Pause, and step back and forward. This replaces today's decade steps;
  - **readable**: lines join the pin groups of the zoom shown, so a country view shows few lines. A frame shows at most 500, widest and newest first, and says how many it left out. Tapping a line lists its births or marriages with links to the person pages, and a list of the lines serves screen readers;
  - **smooth on a phone**: one request gives every frame of a play, so the app draws without the network while playing. Budgets are in design.md.
- **House positions**:
  - a House can have its own position, set through a reviewed Proposal that creates a Citation supporting it, usually the stable cadastre map sheet the House is drawn on. The position remembers its Citation;
  - **placing a House by hand** on a phone or a computer: the Member opens a House from the place sheet, the map zooms in over today's aerial photograph (ČÚZK, open data), and the Member moves the map under a fixed cross (phone) or clicks (computer), then cites the map sheet. The stable cadastre map itself is images only, with no data of houses or house numbers, and ČÚZK serves its georeferenced layer only to its own viewer. So the Member reads it in the ČÚZK Archiv viewer, opened at the Place in its own tab or window (the viewer cannot be framed), and the place sheet's link opens it at the Place too. An Editor reviews the position on a small map with the distance moved;
  - a **stable cadastre overlay** only where a service is aligned in the app's projection **and** its holder allows it. None is today; the Owner decides whether to ask the archive or buy scans (design.md, Open Question 7);
  - **village points stay** as the Places' positions. A House without its own position keeps sitting on its Place's point and is never shown as if placed;
  - on the map, a House with its own position gets its own pin, and a life path shows a move between two such Houses of one village.
- **Fixed rules, proved**: which lines exist, which show in a range, their width and strength, the cap, and the play's ranges are pure functions in `shared/`, run on the server and proved with LemmaScript (ADR 0009). The app only draws what the server sends.

Out of scope:

- Possible relatives and Unrelated people in Map lines (Open Question 1 asks whether to add them later behind a switch).
- Lines for every move of a Person (the life path does that for one Person), for step or foster child links, and for residences, deaths or burials.
- Positions of Places. A Place placed on its Municipality's point by the Vault import stays there (Open Question 7).
- Fields, plots and building outlines; reading positions or house numbers from map images by machine; today's address points (RÚIAN) as a source of positions.
- A House position that changes over time. A House has one position; its renumbering is in its house numbers.
- Paid historical maps (#62) and the base map (#61): nothing here decides them.
- Map lines for visitors who are not signed in, in Exports or on Sheets.

## Capabilities

### New Capabilities

- `house-positions`: a House's own position as a fact with its Citation, placing a House by hand on a phone and a computer, the Source for a map sheet, reviewing a position, and what a House without a position shows.

### Modified Capabilities

Main specs are empty because no change touching these capabilities is archived yet, so these deltas add requirements, as `add-kinship` and `add-tree-charts` did.

- `family-map` (from `add-family-view`): Map lines, Relatives only, the year range, width, colour and legend, playing through time (replacing the decade steps of "Year slider"), smoothness on a phone, readability, what a line stands for, and Houses on the family map.
- `tree-read-api` (from `add-tree-backend`): Map lines in one request, and fixed rules for them.
- `historical-maps` (from `add-map-core`): the stable cadastre overlay only when permitted, the ČÚZK Archiv link opening at the place, and today's aerial photograph.

## Impact

- **Shared**: new pure rules in `shared/src/map-lines.ts` (lines from the Relatives' Families, birthplaces, frames, width, strength, cap, the play's ranges) and the schema `shared/src/schemas/map-lines.ts`; a new operation `setHouseLocation` and the Source type `map` in `shared/src/schemas/`.
- **Server**: `server/src/tree/map-lines.ts` (the line copy, keyed by the newest `log_entry`, and the route `GET /api/map/lines`); applying `setHouseLocation` with its conflict check and undo; `server/openapi.json`.
- **Database**: one migration adds `house.location_citation_id` and the Source type `map`.
- **App**: `app/src/map-lines.js` (drawing, play, legend, the list of lines), changes to `family-map.js` and `pins.js` (play, Houses with their own pins, life path), a House sheet and the placing flow, the Draft kind for a House position, the review view of a position, `app/data/layers.json` (the aerial photograph), a tile layer type for the aerial photograph, and i18n keys in every Interface language.
- **Fixture Tree**: invented Relatives across invented villages with Houses, and a generated Tree of 5,000 invented Persons with 400 Relatives for the budgets.
- **Docs**: GLOSSARY.md (Map line), explanation, how-to and reference pages (design.md and tasks.md name them), `docs/reference/licences.md` for the cadastre maps, `docs/reference/api.md`, the C4 workspace, README.md, and the regenerated `docs/verification.md`.
- **Found along the way**: the CENIA address of both military survey overlays in `app/data/layers.json` answers 404, and CENIA's new services offer only S-JTSK (EPSG:5514), so neither overlay can work in the app as configured. That is #169, not part of this change (design.md, "The stable cadastre: what is available").
- **Depends on**: `add-family-view` (built). `add-kinship` if its link-copy helper lands first. #24's phone check decides the military survey overlays, not this change; the stable cadastre overlay gets its own check (tasks, group 1).
