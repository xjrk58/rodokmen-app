# Proposal

## Why

Anyone researching a Czech ancestor first needs to know which archive holds the parish registers for a village, where to open the scans, and what the village looked like on 19th-century maps. This part does not depend on the Tree or its backend, so it can be built and used now, while the backend is still being chosen.

## What Changes

- A mobile-first map of the Czech lands, installable as a PWA, hosted on GitHub Pages from this repo.
- Search for any Municipality by name, ignoring diacritics.
- A place sheet for any point or Municipality: the archive that holds its registers, a button to that archive's online viewer, and a hint when an archive border is near.
- Historical map overlays (2nd and 3rd military surveys) if the public map services work in the map's projection; links to other historical map viewers either way.
- Archive regions drawn on the map.
- The app shell and reference data work offline after one online visit.
- Public reference data in `data/`: district boundaries named and assigned to archives, the Municipality gazetteer, and the archive list with portal links. A weekly job checks the portal links.

Out of scope: anything about people, the Tree, logins or Proposals (a later change, once the backend is chosen); village-level places below Municipality and German names (a later gazetteer change); parish layers.

## Capabilities

### New Capabilities
- `map-view`: the map itself, its base and overlay layers, archive regions and the place sheet.
- `place-search`: finding a Municipality by name.
- `archive-lookup`: deciding which archive holds the parish registers for a location, and linking to its viewer.
- `historical-maps`: historical overlays and links to external historical map viewers.
- `offline-app`: installing the app and using it without network.

### Modified Capabilities

## Impact

- New static web app in this repo (HTML, CSS, ES modules, vendored Leaflet), deployed by a GitHub Pages workflow.
- New public data files under `data/`, built by scripts from public sources (RÚIAN-derived district polygons, the 33bcdd/souradnice-mest municipality list).
- Runtime dependencies on external services: OpenStreetMap tiles, CENIA map services, and the archive portals the app links to.
- Supersedes the map sections of `SPEC.md`.
