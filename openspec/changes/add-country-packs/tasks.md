# Tasks

## 1. Pack format and the Czech pack

- [ ] 1.1 Move the Czech reference data into `app/data/packs/cz/` (pack.json, area, regions, archives, layers, gazetteer) and add `app/data/packs.json`; make `app/scripts/build-data.mjs` build one pack per run (`--pack cz`); verify a second run leaves every file unchanged and the existing unit and Playwright suites pass with no change to their expectations
- [ ] 1.2 Confirm the public sources and licences for Austria, Poland, Bavaria and Saxony (design.md, "Two gazetteer levels"), download each once into `app/.cache/sources/`, and record source, licence and retrieval date in each `pack.json`; verify every pack.json has a sources entry per input file and the build refuses a pack without one
- [ ] 1.3 Add the pack build checks (unnamed region, region missing a declared kind of register, gazetteer entry outside the area, overlapping pack areas, any data file over 1 MB); verify one unit test per check with a fixture that fails it and names the offending item
- [ ] 1.4 Add the pack loader: the Czech pack precached with the shell, the others fetched into a `packs-v1` cache on pan, tap, search choice or a family Place; verify Playwright with a fixture pack: panning into it loads it without reload, and a tap there while offline and not loaded shows the "needs one online visit" message with coordinates
- [ ] 1.5 Answer locations outside every pack ("no Country pack covers this location yet", coordinates, no archive link); verify Playwright for a point in Hesse and the existing point in Austria before the Austria pack exists
- [ ] 1.6 Add the Country packs list to settings (names, size, on device or not, remove for any pack but the Czech lands); verify Playwright: removing the fixture pack deletes its cache entries and a later online tap loads it again
- [ ] 1.7 Keep loaded packs across app updates and refresh them when online; verify the update e2e test with a loaded fixture pack (still present after "New version, reload", refreshed on the next online start) and the airplane-mode test searching inside it
- [ ] 1.8 Add "About the data" listing the sources and licences of every pack in use; verify Playwright shows the Czech sources and, after loading the fixture pack, its sources too
- [ ] 1.9 Check that a visitor who stays in the Czech lands downloads no more than before; verify by comparing the precache manifest's total bytes with `main` (allowing only `packs.json` and the new code)
- [ ] 1.10 Add Country pack and Locality to `GLOSSARY.md` and widen "Czech lands" and "Municipality"; widen the map sentence of `openspec/config.yaml` context; write ADR 0012 "Map reference data lives in static Country packs" with the server-side alternative; verify the glossary terms match the specs' wording and the ADR is linked from README's "Where things are"
- [ ] 1.11 Update the C4 model (`docs/architecture/workspace.dsl`): Reference data as Country packs, a pack loader component, archive portals beyond the Czech lands, each tagged with `add-country-packs`; verify `docs/architecture/generate.sh` validates it and the architecture workflow passes

## 2. Archive answer per kind of register

- [ ] 2.1 Change `ArchiveIndex.lookup()` to return one entry per kind of register and convert the Czech `archives.json` (Catholic entry per district, Jewish entry for all, `municipalityOverrides` on the Catholic entry); verify the existing Playwright cases (Pardubice, Havlíčkův Brod, Pelhřimov, Vsetín, Prague, Harrachov, Študlov) give the same archives in the new shape, with the National Archives as the Jewish entry
- [ ] 2.2 Render entries on the place sheet with their kind, years (`from`/`until`), notes and a "paid" label for archives marked `paid`; verify Playwright with a fixture pack holding a civil entry from 1876 and a paid portal
- [ ] 2.3 Run the near-border hint per kind and across packs on the device; verify unit tests with two fixture packs whose regions touch, and that a Czech point near a Czech–Czech boundary still gives the add-map-core result
- [ ] 2.4 Tint archive regions of every loaded pack (Catholic, else civil) with the legend grouped by pack; verify Playwright with the Czech and fixture packs and that every archive of both appears in the legend
- [ ] 2.5 Extend `check-links.mjs` and the weekly workflow to every pack; verify its unit test fails on a broken URL in a second pack and names pack, archive and URL

## 3. Search

- [ ] 3.1 Give `app/src/text.js` the letter table of `shared/src/text.ts`; verify a unit test that both fold the strings of `server/test/fold.test.ts` identically, and that "lodz" folds to the same form as "Łódź"
- [ ] 3.2 Store a second folded form with ä/ö/ü as ae/oe/ue for names that contain them, and match a query against either; verify "muenchen" finds "München" and "Muhlhausen" still finds "Mühlhausen"
- [ ] 3.3 Search Municipalities and Localities of every loaded pack, labelled with Municipality, first-level unit and country; verify unit tests for "Neustadt" across fixture packs and that choosing a Locality centres on the Locality, not its Municipality's seat
- [ ] 3.4 Offer to search packs that are not on the device when the loaded ones give no result; verify Playwright with only the Czech pack loaded: a fixture name gives the offer, and accepting loads the fixture pack and lists the hit

## 4. Tree model

- [ ] 4.1 Write migration 0005: `place.municipality_country` (CZ for existing rows) with a per-country code check, `pl`/`ru` place-name languages, `polish`/`russian` name types, `civil_register` source type, `parish.denomination` (catholic for existing rows), house numbers with ½, ⅓ or ¼; the down migration refuses while any new value is in use; verify `migrations.test.ts` up/down on a fixture Tree and that existing links read as CZ with unchanged codes
- [ ] 4.2 Update `shared/src/schemas/` (MunicipalityLink with country and per-country code formats, NameLanguage, NameType, SourceType, ParishRecord, HouseNumberRecord) and regenerate `server/openapi.json`; verify `schemas.test.ts` accepts a 5-digit Austrian code and refuses a 6-digit one, and `openapi.test.ts` passes
- [ ] 4.3 Update the server's Place summary, the Proposal forms, pickers and review labels: country in the Place label outside Czechia, Denomination on Parishes, "23 1/2" normalised to "23½" before validation; verify `app-proposals.e2e.test.ts` with an invented Austrian Place, a Bavarian House 23½ and a Protestant Parish sharing a period with a Catholic one
- [ ] 4.4 Add Denomination to `GLOSSARY.md` and widen House (house numbers beyond čp., fractions) and Estate (end of serfdom differs by country); verify the terms match the tree-model delta

## 5. Austria pack

- [ ] 5.1 Build the Austria pack: 94 Bezirke as regions, Gemeinden with their 5-digit codes, Ortschaften as Localities; verify the build reports the counts, every Gemeinde lies in a Bezirk, and no file exceeds 1 MB
- [ ] 5.2 Write its `archives.json`: Bezirk to diocese, the Tyrolean register portal for Tyrol, Protestant entries without scan links until a portal is known; verify Playwright: Linz → Diocese of Linz, Krems (Land) → St. Pölten, Mistelbach → Archdiocese of Vienna, Kufstein → Archdiocese of Salzburg, Innsbruck → Diocese of Innsbruck
- [ ] 5.3 Add its historical map links, and test each overlay candidate with one EPSG:3857 tile and its licence, recording the results in design.md; verify the links open outside the app and no overlay is enabled without a recorded pass
- [ ] 5.4 Verify the cross-pack hint: a South Bohemian point 3 km from the Austrian border names SOA Třeboň and adds "also check" with the diocese across the border (Playwright)

## 6. Poland pack

- [ ] 6.1 Build the 1900 state boundary (Russian Empire, Austria, German Empire) from a public-domain source into `app/data/packs/pl/sources/borders-1900.geojson`; verify against a list of at least 20 known border villages, each on its recorded side, kept in `build-info.json`
- [ ] 6.2 Build the gazetteer: gminy with 7-digit TERC codes, PRNG localities split by voivodeship; verify counts, every file under 1 MB, and that Łódź, Tarnów and Wrocław are found
- [ ] 6.3 Build regions as powiaty cut by the 1900 boundary, map each piece to its State Archive or branch, and add the per-side notes (Russian 1868–1917, German civil registers from 1874, German until 1945); verify Playwright for a location near Łódź, Wrocław, and two villages of one powiat on either side of the 1900 border
- [ ] 6.4 Add its historical map links (including Arcanum for Galicia) and test overlay candidates as in 5.3; verify a place sheet near Kraków lists the links and each opens outside the app

## 7. Bavaria and Saxony packs

- [ ] 7.1 Build the Bavaria and Saxony gazetteers from VG250 Gemeinden (8-digit AGS) and Localities; verify counts, every file under 1 MB, and that "Neustadt" lists every Neustadt of both Länder
- [ ] 7.2 Build regions from Landkreise and kreisfreie Städte, cut along diocese boundaries where OpenStreetMap's are complete, with Catholic, Protestant and civil (from 1876) entries and Archion marked paid; verify Playwright: Regensburg and Leipzig answers as specified, the civil entry says 1876, and the Protestant link is labelled paid
- [ ] 7.3 Add historical map links and test overlay candidates (including Bavaria's open historical maps) as in 5.3; verify links and recorded results
- [ ] 7.4 Document adding a German Land in `app/data/packs/README.md`; verify by following it with a fixture Land: it builds, loads and answers with no code change

## 8. Family map

- [ ] 8.1 Once `add-family-view` has its place sheet, show the pack's archive answer and map links for family Places inside a pack (loading the pack if needed) and "no archive lookup yet" outside; verify Playwright with invented Persons: a Place near Tarnów and a Place in Canada

## 9. Integration

- [ ] 9.1 Run the whole app suite at phone and desktop viewports with all five packs, and an offline session that searches and opens place sheets in three packs; verify both pass in CI

## Workflow follow-up

- Archive after `add-map-core`, `add-tree-backend` and `add-family-view`. When archiving, replace the superseded requirements in the main specs:
  - archive-lookup: the "Outside the Czech Republic" scenario of "Archive by district" goes in favour of "Outside every Country pack". "Jewish registers" and "Near-border hint" give way to "One answer per kind of register" and "Near-border hint in every pack".
  - map-view: "Archive regions layer" and "Borders without network" give way to their every-pack versions.
  - historical-maps: "Historical map links" gives way to "Historical map links per pack".
  - tree-model: the language list in "Places, Houses and Municipalities" and the name types in "Persons have Names" widen to match this change.
  - family-map: "Places outside the Czech lands" gives way to "Places in every Country pack".
