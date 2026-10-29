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

### Tree home and layout
The tree is the default route for signed-in Members (`#person-<id>`, else the remembered focus, else the Member's own Person, else a Family root). The map route stays the default without sign-in. The tree is an SVG hourglass drawn from one API request that returns the focus Person's ancestors and descendants with partners, to the depth asked for. Layout runs in the browser: ancestors as a binary tree above the focus, descendants grouped by Family below, partners on the same row. It's sized so 3 up and 2 down fit at phone width, with pan and pinch-zoom for more. Refocusing animates the move, so the Member keeps their bearings. Fan charts were considered and rejected: their labels become unreadable on a phone.

### The Member's own Person
`account.person_id` links a Member to a Person and is set by the Owner only. The link is shown to that Member alone. It's a link to a Living person, so it is never part of an Export.

### Map layers
Family pins come from the map query (bounding box plus year range) and use Leaflet marker clustering. The year slider debounces its requests. The life path is a polyline in date order.

## Risks / Trade-offs

- [Large cache on small phones] → only viewed records and the current map area are cached, with a cap and least-recently-used eviction.
- [Data left on a shared family tablet] → signing out clears the cache, and sessions can be ended remotely (member-accounts).

## Open Questions

None that change the specs.
