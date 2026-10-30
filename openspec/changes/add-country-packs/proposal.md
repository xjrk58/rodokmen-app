# Proposal

## Why

Families did not stay inside the Czech lands. Lines lead into Austria, Poland and Germany, and the map stops at the Czech border: search finds only Czech Municipalities, and archive lookup and historical maps answer "not available" everywhere else. The Tree can already hold Places anywhere, so the missing part is the map's reference data. Czech records are unusually tidy (one archive per district, one register system, one map series). Neighbouring countries are not, so each needs its own rules, not a copy of the Czech ones.

## What Changes

- **Country packs**: the map's public reference data (gazetteer, archive rules, historical map layers) is grouped per country, or per part of a large country. The Czech data becomes the first Country pack, unchanged in content. New packs: Austria, Poland, and the German Länder Bavaria and Saxony. Other Länder can follow as data, without code changes.
- Packs load when the reader needs them (pans or taps there, searches there, opens a family Place there) and then work offline. The Czech pack stays precached as today.
- **Localities**: gazetteers can list villages below the level of Municipality, because in Poland and Germany the Municipality is often far coarser than the village a register names.
- Search covers every pack on the device, folds Polish and German letters (ł, ß), and accepts ae/oe/ue for ä/ö/ü.
- **BREAKING** (app data format): the archive answer becomes a list with one entry per kind of register (Catholic, Protestant, Greek Catholic, Orthodox, Jewish, civil), each with the years it covers. The Czech answer keeps the same archives and the Jewish registers note, in the new shape.
- Archive rules per pack: Austria by political district (Bezirk) to diocese; Poland by today's county (powiat) and the state the location belonged to in 1900 (Russian, Austrian or German); Bavaria and Saxony by district (Landkreis) to Catholic diocese, Protestant regional church (Landeskirche) and civil registers from 1876. Portals that charge for access are marked as paid.
- Historical map links per pack. Overlays are added only where a service delivers aligned Web Mercator tiles and its licence allows embedding.
- Tree model generalisations: a Municipality link names its country, and its code follows that country's official format. Place names can be Polish or Russian. Persons can have Polish and Russian name forms. A Source can be a civil register. A Parish has a Denomination. A house number may carry a fraction (23½).

Out of scope: German or Polish interface text (the UI stays Czech and English); Localities for the Czech pack (Czech parts of Municipalities, a later change); German Länder other than Bavaria and Saxony; Slovakia, Hungary, Ukraine and the rest of the former Habsburg lands; deep links into register viewers (no place-search URL pattern is verified for any portal yet); scan reading of Russian or Polish handwriting, which `add-scan-reading` decides by benchmark; historical boundaries before 1815.

## Capabilities

### New Capabilities
- `country-packs`: which packs exist, what a pack contains, how the app picks, loads and keeps packs, and how pack data is built and checked.

### Modified Capabilities
- `place-search`: search across loaded packs, Localities, results labelled with country, and folding of Polish and German letters.
- `archive-lookup`: one answer per kind of register, with periods, from the rules of the pack the location falls in; replaces "Outside the Czech Republic" with "Outside every Country pack".
- `historical-maps`: links and overlays come from the pack, not from a Czech-only list.
- `map-view`: archive regions and borders for every loaded pack; the place sheet names country and first-level unit.
- `offline-app`: a loaded pack works offline like the Czech pack.
- `tree-model`: country-qualified Municipality links, Polish and Russian names, civil registers, Parish Denomination, fractional house numbers.
- `family-map`: archive lookup and historical maps cover every Country pack, not only the Czech lands.

These capabilities come from `add-map-core`, `add-tree-backend` and `add-family-view`, none of which is archived yet. Like `default-to-czech`, this change adds new requirements. When those changes are archived first, the requirements this change supersedes must be replaced at archive time. tasks.md lists them under "Workflow follow-up".

## Impact

- `app/data/` moves into `app/data/packs/<id>/` plus a small `app/data/packs.json` index. `app/scripts/build-data.mjs` becomes a per-pack build, and `check-links.mjs` checks every pack.
- `app/src/` gains a pack loader and multi-pack gazetteer. `archive-lookup.js` returns the new answer shape. `place-sheet.js`, `search-box.js`, `layers-panel.js`, `text.js` and `sw.js` (a cache for packs) change.
- Server: a migration on `place`, `place_name`, `person_name`, `source`, `parish` and `house_number`. The `shared/` schemas change, and so do the OpenAPI document, the Proposal forms and pickers, and the place summary in `server/src/tree/places.ts`.
- `add-exports-and-erasure` (not started): GEDCOM places gain the country.
- `add-vault-import` (not started): Vault Places all map to the Czech pack. Nothing changes but the country field.
- New public data sources per pack, each with its licence recorded and attributed: official municipality lists and boundaries, gazetteers with coordinates for Localities, and historical boundaries of 1900 for Poland.
- New external services the app links to: Matricula, Archion, the Polish State Archives' portal, Geneteka, Matriken Tirol, diocesan and state archives.
- `GLOSSARY.md` gains Country pack, Locality and Denomination. "Czech lands", "Municipality", "House" and "Estate" are widened. A new ADR records the decision to keep reference data in static packs. The C4 model in `docs/architecture/` gains the pack loader and the new portals.
