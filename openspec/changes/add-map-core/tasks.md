# Tasks

## 1. App shell and deployment

- [ ] 1.1 Create `index.html`, `app.js`, `styles.css` and vendor Leaflet 1.9 into `vendor/`; verify the map of Czechia renders locally with `npx serve .`
- [ ] 1.2 Add `i18n/cs.json` and `i18n/en.json` with a language switch; verify a Playwright test sees Czech labels with `locale: cs-CZ` and English with `en-US`
- [ ] 1.3 Add a GitHub Pages workflow that deploys on push to `main`; verify the site loads at `https://xjrk58.github.io/rodokmen-app/`
- [ ] 1.4 Add a CI workflow that runs the Playwright suite on every push; verify it passes on the shell

## 2. Reference data

- [ ] 2.1 Write `scripts/build-data.mjs` to build `data/districts.geojson`, `data/municipalities.json` and `data/country.geojson`; verify the script reports 77 named districts and 6,258 municipalities, each inside a district
- [ ] 2.2 Write `data/archives.json` (archives, districts, portal URLs, place-search URL patterns where known); verify the script fails if any district lacks an archive
- [ ] 2.3 Add a weekly workflow that checks every portal URL in `archives.json`; verify it fails on a deliberately broken URL in a test run

## 3. Archive lookup and place sheet

- [ ] 3.1 Implement point-in-district lookup and the archive answer; verify Playwright cases for Pardubice → SOA Zámrsk, Havlíčkův Brod → SOA Zámrsk, Pelhřimov → SOA Třeboň, Vsetín → Zemský archiv Opava, Prague → Archiv hl. m. Prahy, a point in Austria → no archive
- [ ] 3.2 Build the place sheet with "Open scans", the Jewish registers link and the near-border hint; verify a point 3 km from the SOA Zámrsk–MZA Brno boundary shows "also check MZA Brno"
- [ ] 3.3 Add the archive regions layer with legend; verify every archive in `archives.json` appears in the legend

## 4. Place search

- [ ] 4.1 Implement diacritic-insensitive search over `municipalities.json` with district labels; verify "zdar" finds Žďár nad Sázavou and "Adamov" lists every Adamov with its district
- [ ] 4.2 Centre the map and open the place sheet on selection; verify with a Playwright test

## 5. Historical maps

- [ ] 5.1 Request one EPSG:3857 tile from the CENIA 2nd and 3rd military survey WMS services and record the result in design.md; verify by a screenshot of the tile over the matching OSM tile
- [ ] 5.2 Add each overlay that passed 5.1 with an opacity control; verify alignment on a known church and crossroads by screenshot
- [ ] 5.3 Add the ČÚZK Archiv, OldMapsOnline and Arcanum Maps links to the place sheet; verify each opens outside the app
- [ ] 5.4 Add "Check map layers" to settings; verify it reports a blocked overlay as not working in a test with the service URL mocked to fail

## 6. Offline and install

- [ ] 6.1 Add the manifest and icons (192, 512, maskable 512); verify Chrome's installability check passes in Lighthouse
- [ ] 6.2 Add the service worker with a versioned precache of shell and `data/`; verify the Playwright offline reload test opens the map, searches and shows a place sheet
- [ ] 6.3 Add the tile runtime cache capped at 2,000 entries with least-recently-used eviction; verify with a unit test of the eviction order
- [ ] 6.4 Show "New version, reload" when a new worker is waiting; verify by deploying twice in a test and checking the prompt

## Workflow follow-up

- Archive this change after it ships, so its specs move to `openspec/specs/`.
- Remove the map sections from `SPEC.md` at archive time.
