# Design

## Context

`add-map-core` builds the map as plain ES modules. This change adds several data-heavy screens (person page, pedigree, lists) that would be awkward to build by hand, while keeping the no-build rule (see add-map-core design).

## Goals / Non-Goals

**Goals:**
- Fast on a mid-range Android phone, with a Tree of a few thousand Persons.
- Screens readable without zooming at phone width.

**Non-Goals:**
- No server-side rendering.

## Decisions

### Preact with htm, vendored
Preact (about 4 KB) with htm template literals runs as plain ES modules, so there is still no build step. Lit was considered; Preact won on its simpler state handling for list and detail screens. Plain DOM code stays for the Leaflet map from `add-map-core`.

### Local cache
The app keeps loaded records in IndexedDB, keyed by id and version. The person page renders from cache first and refreshes when online. A small "as of" label shows the cache time. Nothing is cached for someone who is not signed in, and signing out clears the cache.

### Pedigree layout
The pedigree is a horizontal SVG tree, sized to show 4 generations at phone width and scrolled sideways for 5 and 6. Fan charts were considered and rejected: their labels become unreadable on a phone.

### Map layers
Family pins come from the map query (bounding box plus year range) and use Leaflet marker clustering. The year slider debounces its requests. The life path is a polyline in date order.

## Risks / Trade-offs

- [Large cache on small phones] → only viewed records and the current map area are cached, with a cap and least-recently-used eviction.
- [Data left on a shared family tablet] → signing out clears the cache, and sessions can be ended remotely (member-accounts).

## Open Questions

None that change the specs.
