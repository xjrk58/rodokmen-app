# Design

## Context

`add-map-core` built the map as static files with no server: `app/data/` holds the district polygons, `municipalities.json` (6,258 rows, ~700 KB), `archives.json` (district → archive) and `layers.json`. All of it is precached by the service worker. `ArchiveIndex` (`app/src/archive-lookup.js`) answers one archive plus "also check" entries. `Gazetteer` (`app/src/gazetteer.js`) searches the one list. `normalize()` in `app/src/text.js` strips combining marks only, so ł and ß survive folding. The server's `rdk_fold()` and `shared/src/text.ts` `foldForSearch()` already fold them through a letter table.

On the Tree side, `place.municipality_code` is checked as 6 digits (RÚIAN). `place_name.language` and `NameLanguage` are cs/de/la. `NameType` has `latin` and `german` forms. `SourceType` has no civil register. `parish` has no denomination. House numbers match `^\d{1,5}[a-z]?$`. Overlapping `place_parish` periods are already allowed: no exclusion constraint exists.

See proposal.md for why; the specs say what each region must answer.

## Goals / Non-Goals

**Goals:**
- One pack format that holds the Czech lands, a whole small country (Austria), a large country split by voivodeship (Poland) and a single German Land, without special cases in code.
- The map still needs no server, and a visitor who never leaves the Czech lands downloads no more than today.
- Every archive answer can be traced to a line in a pack's data file and checked by the weekly link check.

**Non-Goals:**
- No server-side gazetteer or place search API for the map. The Tree's own Place search is unchanged.
- No attempt to model historical administrative units (Kreise of 1900, Austrian crown lands) beyond the one 1900 state boundary Poland needs.
- No automatic choice between Catholic and Protestant answers. The answer lists both, and the Member knows the family's church.

## Decisions

### Static Country packs, loaded on demand
A pack is a folder `app/data/packs/<id>/` with `pack.json` (id, names, country, first-level unit names, kinds of register, sources and licences), `area.geojson` (outline), `regions.geojson` (archive regions), `archives.json`, `layers.json` and `gazetteer/<unit>.json`. A small `app/data/packs.json` lists every pack with a simplified outline and its byte size, and is precached. The Czech pack is precached as part of the shell. The other packs go into a separate `packs-v<format>` cache when first needed, so app updates do not evict them.

Alternative: one server-side search and lookup API backed by PostGIS. It would scale to all of Europe, but it breaks "the map needs no server" (add-map-core design) and offline search in reading rooms, and visitors without accounts would depend on the VPS. Rejected for now. The pack format keeps that door open, since the server could import the same files. The decision gets its own ADR (task 1.10).

### Two gazetteer levels
Gazetteer rows are either a Municipality (official code, name, folded name, first-level unit, lat, lon) or a Locality (name, folded name, the parent Municipality's code, lat, lon). Search ranks exact and prefix matches as today, and Municipalities before Localities when the scores tie. A gazetteer file is split by first-level unit when it would exceed 1 MB (voivodeship, Land, Bundesland). Only the units in view or chosen in search are loaded.

Candidate sources (task 1.2 confirms each and records the licence):

| Pack | Municipalities and boundaries | Localities |
|---|---|---|
| Czech lands | unchanged | none in this change |
| Austria | Statistik Austria open data (Gemeinden, Bezirke; CC BY 4.0) | Statistik Austria Ortschaften, with coordinates from the same open data or GeoNames |
| Poland | TERYT (gminy, powiaty) and PRG boundaries from GUGiK | PRNG (official place names with coordinates, free download) |
| Bavaria, Saxony | BKG VG250 (Gemeinden, Kreise; dl-de/by-2-0) | OpenStreetMap `place=*` nodes inside each Gemeinde, or GeoNames |

### One answer per kind of register
`ArchiveIndex.lookup()` returns `{ region, entries: [{ kind, archive, from, until, note, alsoCheck[] }] }`. `kind` is one of catholic, protestant, greek_catholic, orthodox, jewish or civil. Each archive region in `archives.json` maps to entries, not to one archive. The Czech data converts mechanically: each district gets a Catholic entry for its archive, and the Jewish registers note becomes a Jewish entry for every district. The `municipalityOverrides` rule stays as it is, now applied to the Catholic entry. The near-border hint runs per kind, against regions of the same pack and of neighbouring packs on the device. An archive has `paid: true` when its portal charges.

Alternative: keep "one archive + also check" and put the other kinds into free text. Rejected: German answers would be prose nobody can check or test.

### Archive regions per pack
- **Austria**: the 94 Bezirke (Statutarstädte and politische Bezirke), each mapped to its diocese. This is the Czech model with different names. Tyrol's registers are listed with the Tyrolean register portal.
- **Poland**: each powiat polygon is cut by the 1900 state boundaries (Russian Empire, Austria, German Empire). The pieces are named like "powiat X (1900: Russian Empire)" and mapped to the State Archive or branch that holds that side's registers. A pack-level note per side carries what readers need: Russian-language entries 1868–1917, German civil registers from 1874, and German until 1945 for the western and northern lands. The 1900 boundary is built once into `app/data/packs/pl/sources/borders-1900.geojson` from a public-domain source (task 6.1) and checked against known border villages.
- **Bavaria and Saxony**: Landkreise and kreisfreie Städte, each mapped to its Catholic diocese, Protestant Landeskirche and civil register holder. Where a Landkreis is split between dioceses, the region is cut along the diocese boundary. That boundary comes from OpenStreetMap `boundary=religious_administration` relations where they are complete. Otherwise the Landkreis keeps both dioceses as Catholic entries, the second as "also check".

### Folding in the app
`app/src/text.js` gets the same letter table as `shared/src/text.ts`, and a unit test checks that the two agree on the fold test's strings. For German names the gazetteer stores a second folded form with ä/ö/ü written as ae/oe/ue, and a query matches either form. This keeps one search loop.

### Tree model
Additive where possible:
- `place` gains `municipality_country` (`CZ`, `AT`, `DE`, `PL`), set to `CZ` for existing rows. The code check becomes per country: CZ 6 digits, AT 5, DE 8 (Amtlicher Gemeindeschlüssel), PL 7 (TERC). `MunicipalityLink` gains `country`.
- `NameLanguage` and the `place_name.language` check gain `pl` and `ru`. `NameType` and the `person_name.type` check gain `polish` and `russian`.
- `SourceType` gains `civil_register`.
- `parish` gains `denomination` (catholic, greek_catholic, protestant, orthodox, other), defaulting to `catholic` for existing rows.
- The house number check accepts a trailing `½`, `⅓` or `¼`. The shell normalises "23 1/2" to "23½" before validation.

Alternative for names: replace the `latin` and `german` types with one "language form" type plus a language field. It is cleaner, but it ripples into `add-vault-import`'s mapping and existing rows for no gain the specs need. Rejected for now.

### Historical maps per pack
Each pack's `layers.json` lists overlays and viewers as today. A new overlay gets the same treatment as add-map-core's task 5.1: one EPSG:3857 tile is requested, compared with OSM, and the licence is recorded before `enabled` may be true. Candidates: Arcanum Maps (Habsburg second survey incl. Austria and Galicia, Prussia 1877, Bavaria, Saxony; offers WMTS commercially), and Bavaria's open historical maps (Uraufnahme, Positionsblätter) if offered as a public WMS. Viewers are always links.

### Rules proved with LemmaScript
None qualifies. The new decisions in this change are:
- the pack and region for a point, a point-in-polygon test on floating-point coordinates in `app/src/geo.js`;
- the assembly of the archive answer from pack data in `app/src/archive-lookup.js`;
- the code and house number formats, which are regular expressions.

The first is geometry outside LemmaScript's integer model. The second is a lookup of data, not a rule of the Tree. The third is regex, which ADR 0009 keeps in the unverified shell. All three are covered by unit and Playwright tests, as in add-map-core.

## Risks / Trade-offs

- [Archive facts are wrong or go stale: dioceses merge, portals move, a Landeskirche joins or leaves Archion] → every fact is one line in a pack's `archives.json`, the weekly link check covers all packs, and fixing a fact is a data PR, not a spec change.
- [Polish 1900 boundary is approximate] → the near-border hint applies to it like any other boundary, so villages within 5 km get both sides' archives.
- [Pack sizes grow, mostly the Polish Localities] → the 1 MB per file budget, a split by voivodeship, and loading only units in view.
- [OpenStreetMap data (ODbL) in a public repo] → attribution in "About the data"; the derived Locality files are published under ODbL with the repo.
- [Diocese and Landeskirche boundaries do not follow Landkreise] → cut regions where open boundaries exist, otherwise list both with "also check"; the answer never pretends to more precision than its data has.
- [Paid portals] → marked as paid; the free index or the archive's own reading room is listed next to them where known.
- [Readers expect German or Polish UI] → out of scope; pack, place and archive names appear in their own language.

## Migration Plan

1. Move the Czech data into `app/data/packs/cz/` with a build that produces byte-identical lookups. The existing Playwright archive and search tests must pass unchanged in content before any new pack lands.
2. Ship the new answer shape with the Czech pack only, then add Austria, Poland, Bavaria and Saxony one pack per PR.
3. The Tree migration is additive and defaults existing rows to CZ and Catholic. The down migration refuses while any non-CZ link, pl/ru name, Polish or Russian form, civil register or non-Catholic Parish exists.
4. The service worker version bump drops the old flat `app/data/` precache entries. The `packs-v1` cache is new.

## Open Questions

- Which German Länder come after Bavaria and Saxony? Adding one is a data PR (task 7.4 shows how).
- Which Austrian portal holds Protestant registers online, if any? Until known, Protestant entries in the Austria pack name the parish and the Evangelical Church's archive without a scan link.
- Whether Arcanum's WMTS licence allows embedding in a private family app. Until it does, Arcanum stays a link.
- Whether Matricula, Archion or the Polish State Archives' portal support a place-search URL. This changes data only (`placeSearchUrl`), as in add-map-core.
