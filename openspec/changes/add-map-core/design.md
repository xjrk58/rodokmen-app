# Design

## Context

The repo holds only planning documents so far. It becomes a TypeScript monorepo with `app/`, `server/` and `shared/` (ADR 0007); this change touches only `app/`. The map runs as static files: previewed on GitHub Pages now, served from the VPS domain later. It needs no server: everything it knows about archives and Municipalities ships as public data files. The Tree backend comes in later changes (see proposal.md, out of scope), so nothing here may depend on it.

## Goals / Non-Goals

**Goals:**
- A structure that later changes (family view, gazetteer, parish layer) extend without rework.
- Reference data rebuilt by a script from public sources, so it can be refreshed and checked.

**Non-Goals:**
- No server code, no logins, no family data.
- No build step or framework for the app itself.

## Decisions

### Static ES modules with vendored Leaflet, no build step
Plain HTML, CSS and ES modules in `app/`, with Leaflet 1.9 copied into `app/vendor/`. Type safety comes from TypeScript checking JSDoc-annotated JavaScript (`tsc --noEmit` in CI), so the same domain types can later be shared from `shared/` without a bundler. Agents and humans can edit any file and reload, and any static host serves `app/` as is. A framework (React, Svelte) was considered and rejected for now: the map has few screens. The family view and review queue may revisit this when they arrive.

### Archive lookup = point in district polygon, then district → archive
The archive regions follow the districts of 1960–2000, which match today's districts closely enough. The build script names each district polygon from the municipality points inside it, simplifies the polygons, and writes `app/data/districts.geojson`. `app/data/archives.json` maps district names to archives. Lookup is a point-in-polygon test in the browser. The near-border hint is the distance from the point to the nearest edge whose neighbouring district belongs to another archive. A per-parish table was considered and rejected for now: no open dataset of parishes exists, and the district rule is right for most places.

The polygons follow today's districts, but 15 Municipalities moved district in 2021 while the municipality list still has their earlier district. The build writes these into a `municipalityOverrides` section of `archives.json`, and the lookup uses the earlier district's archive for them, with today's archive as "also check". Only three answers actually change: Harrachov, Študlov and Valašské Příkazy.

### Reference data pipeline
`app/scripts/build-data.mjs` (Node 22, mapshaper) reads the RÚIAN-derived district polygons and the 6,258-row municipality list. It writes `app/data/districts.geojson` (target ~300 KB), `app/data/municipalities.json` (name, normalized name, district, lat, lon) and `app/data/country.geojson`. The script fails if any polygon gets no name, if any district has no archive, or if any municipality falls outside every polygon. The generated files are committed, so the site needs no build.

### Historical overlays: test the projection first
The CENIA metadata lists only S-JTSK (EPSG:5514) for the 2nd military survey service. Task 5.1 therefore requests one Web Mercator (EPSG:3857) tile from each CENIA WMS before any overlay work starts. If a service answers correctly in 3857, it becomes a Leaflet WMS overlay. If it does not, the overlay is dropped and only the links remain (see the historical-maps spec). A separate S-JTSK map view through Proj4Leaflet stays a later option.

### Service worker
The service worker precaches the shell and `app/data/` under a release version and serves them cache-first. Tiles get their own runtime cache, capped at 2,000 entries with least-recently-used eviction. A new worker waits until the reader taps "New version, reload".

### Internationalisation
Strings live in `app/i18n/cs.json` and `app/i18n/en.json`. The language comes from `navigator.language`, falls back to English, and the reader's choice is kept in localStorage.

### Tests
Playwright with headless Chromium runs in CI on every push. It covers load, search ("zdar" → Žďár nad Sázavou), archive answers for the tricky districts, the place sheet, and an offline reload. The data script has its own checks (above).

## Risks / Trade-offs

- [CENIA services only serve S-JTSK] → overlays are dropped, and the links still give the reader the historical maps.
- [Archive portals change URLs] → URLs live only in `archives.json`, and a weekly workflow checks them.
- [District rule misses parishes across a boundary] → the near-border hint names the neighbouring archive.
- [OpenStreetMap tile policy] → no prefetching, a tile cache cap, and attribution on the map.
- [Semily and Brno city registers may sit in a different archive than the district rule says] → checked as data before launch; a fix is a one-line change in `archives.json`, not a spec change.

## Open Questions

- Do the Semily district registers sit in SOA Zámrsk or SOA Litoměřice, and the Brno city parishes in MZA or the Brno city archive? This changes data only.
- Task 5.1 result: not yet recorded. The CENIA WMS services could not be reached from the build environment, so no EPSG:3857 tile has been requested yet. Both overlays ship behind `enabled` flags in `app/data/layers.json` (on by default); "Check map layers" on a phone, plus an alignment check, decides which stay on. Record the outcome here.
- Which register viewers support a search by place? No place-search URL pattern could be verified, so every `placeSearchUrl` in `archives.json` is `null` and "Open scans" opens the viewer's start page. The OldMapsOnline link (`https://www.oldmapsonline.org/en/<name>`) is likewise unverified.
