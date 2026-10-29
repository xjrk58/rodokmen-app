# Tasks

## 1. App shell and deployment

- [x] 1.1 Create `app/index.html`, `app/app.js`, `app/styles.css` and vendor Leaflet 1.9 into `app/vendor/`; verify the map of Czechia renders locally with `npx serve app`
  - Note: Verified with `npx serve app` in headless Chromium at 390×844 and 1280×800 (tiles mocked): 77 district boundaries and the national border on screen, no console errors.
- [x] 1.2 Add `app/i18n/cs.json` and `app/i18n/en.json` with a language switch; verify a Playwright test sees Czech labels with `locale: cs-CZ` and English with `en-US`
- [ ] 1.3 Add a GitHub Pages preview workflow that publishes `app/` on push to `main`; verify the preview loads at `https://xjrk58.github.io/rodokmen-app/`
  - Note: Done: `.github/workflows/pages-preview.yml` (assembles `app/` without tests and scripts, checks the version stamp, deploys, then curls the preview). Locally verified: the assembled site served under `/rodokmen-app/` loads and precaches all files. Remains: set Settings > Pages > Source to GitHub Actions, push to `main` and open https://xjrk58.github.io/rodokmen-app/ (needs GitHub Actions).
- [ ] 1.4 Add a CI workflow that runs `tsc --noEmit` and the Playwright suite on every push; verify both pass on the shell
  - Note: Done: `.github/workflows/app-ci.yml` (pnpm install, Playwright Chromium, `pnpm run typecheck`, unit tests, Playwright suite); actionlint is clean. Locally `tsc --noEmit` (3 projects) and the suite pass: 33 unit tests, 80 Playwright tests (phone and desktop). Remains: the first run in GitHub Actions. It installs with `--no-frozen-lockfile` until the lockfile is committed.

## 2. Reference data

- [x] 2.1 Write `app/scripts/build-data.mjs` to build `app/data/districts.geojson`, `app/data/municipalities.json` and `app/data/country.geojson`; verify the script reports 77 named districts and 6,258 municipalities, each inside a district
  - Note: Output: "77 named districts", "6,258 municipalities, each inside a district". The source CSV has 6,259 rows; the script drops Brdy (vojenský újezd, 539996), abolished on 1 January 2016. 15 municipalities are listed under their pre-2021 district but lie inside another district's polygon. The app shows the polygon district, and the script writes a `municipalityOverrides` section into `app/data/archives.json` so that their registers follow the archive of the listed (older) district. Three of them change archive: Harrachov, Študlov and Valašské Příkazy. The list is also in `app/data/build-info.json`; a second run leaves every file unchanged.
- [x] 2.2 Write `app/data/archives.json` (archives, districts, portal URLs, place-search URL patterns where known); verify the script fails if any district lacks an archive
  - Note: Verified by `tests/unit/build-data.test.mjs`: with a district left out, the script exits 1 with "District Beta has no archive". The same check validates the generated `municipalityOverrides` (known archive id, district of that archive). No place-search URL pattern could be verified, so every `placeSearchUrl` is `null` (see design.md, Open Questions).
- [ ] 2.3 Add a weekly workflow that checks every portal URL in `archives.json`; verify it fails on a deliberately broken URL in a test run
  - Note: Done: `.github/workflows/archive-links.yml` (weekly, on pull requests that touch `archives.json`, and by hand with a `broken_url_test` input) runs `app/scripts/check-links.mjs`. Locally verified against a test server: it exits 1 and names the archive and URL for a 404, an unreachable host and an added broken URL (`tests/unit/check-links.test.mjs`). Remains: a `broken_url_test` run and a normal run in GitHub Actions; the real portals were not reachable from here.

## 3. Archive lookup and place sheet

- [x] 3.1 Implement point-in-district lookup and the archive answer; verify Playwright cases for Pardubice → SOA Zámrsk, Havlíčkův Brod → SOA Zámrsk, Pelhřimov → SOA Třeboň, Vsetín → Zemský archiv Opava, Prague → Archiv hl. m. Prahy, a point in Austria → no archive
  - Note: Also verified in Playwright: Harrachov → SOA Zámrsk with "also check SOA Litoměřice", and Študlov (Zlín) → Zemský archiv Opava with "also check MZA Brno". An override from `municipalityOverrides` applies when the place's nearest Municipality has one and the point lies in that Municipality's district polygon.
- [x] 3.2 Build the place sheet with "Open scans", the Jewish registers link and the near-border hint; verify a point 3 km from the SOA Zámrsk–MZA Brno boundary shows "also check MZA Brno"
- [x] 3.3 Add the archive regions layer with legend; verify every archive in `archives.json` appears in the legend

## 4. Place search

- [x] 4.1 Implement diacritic-insensitive search over `municipalities.json` with district labels; verify "zdar" finds Žďár nad Sázavou and "Adamov" lists every Adamov with its district
- [x] 4.2 Centre the map and open the place sheet on selection; verify with a Playwright test

## 5. Historical maps

- [ ] 5.1 Request one EPSG:3857 tile from the CENIA 2nd and 3rd military survey WMS services and record the result in design.md; verify by a screenshot of the tile over the matching OSM tile
  - Note: Not run: the CENIA services (geoportal.gov.cz) are not reachable from the build environment. Both overlays are defined in `app/data/layers.json` with `enabled: true` and request `CRS=EPSG:3857` (WMS 1.3.0, layer 0, transparent PNG). Remains: run "Check map layers" on a phone, take the tile-over-OSM screenshot, record the result in design.md and set `enabled: false` for a service that fails.
- [ ] 5.2 Add each overlay that passed 5.1 with an opacity control; verify alignment on a known church and crossroads by screenshot
  - Note: Code done: each enabled overlay has a switch and an opacity slider in the map layers panel; Playwright checks that tiles are requested in EPSG:3857 and that opacity follows the slider (tiles mocked). Remains: the alignment screenshot on a known church and crossroads against the real services, after 5.1.
- [x] 5.3 Add the ČÚZK Archiv, OldMapsOnline and Arcanum Maps links to the place sheet; verify each opens outside the app
  - Note: Verified in Playwright: each link has `target=_blank` and opens a new page at its URL while the app page stays put. The OldMapsOnline place URL pattern is unverified.
- [x] 5.4 Add "Check map layers" to settings; verify it reports a blocked overlay as not working in a test with the service URL mocked to fail

## 6. Offline and install

- [x] 6.1 Add the manifest and icons (192, 512, maskable 512); verify Chrome's installability check passes in Lighthouse
  - Note: Verified with Lighthouse 11.7.1 (the last version with the PWA audits) against the local server: `installable-manifest` passes and the PWA category scores 1.0. `tests/e2e/install.spec.js` repeats Chrome's check through `Page.getInstallabilityErrors` on every run.
- [x] 6.2 Add the service worker with a versioned precache of shell and `app/data/`; verify the Playwright offline reload test opens the map, searches and shows a place sheet
- [x] 6.3 Add the tile runtime cache capped at 2,000 entries with least-recently-used eviction; verify with a unit test of the eviction order
  - Note: Verified by `tests/unit/tile-lru.test.mjs`; the service worker keeps the use order across restarts.
- [x] 6.4 Show "New version, reload" when a new worker is waiting; verify by deploying twice in a test and checking the prompt
  - Note: Verified by `tests/e2e/update.spec.js`: two deploys in a row each show "New version, reload", keep the open place sheet until it is tapped, then reload into the new version.

## Workflow follow-up

- Archive this change after it ships, so its specs move to `openspec/specs/`.
- Remove the map sections from `SPEC.md` at archive time.
