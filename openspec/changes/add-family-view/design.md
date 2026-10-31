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

As built: Preact 10.29.8 (the last 10.x; 11 was a month old) and htm 3.1.1 are copied into `app/vendor/` by `app/scripts/vendor-preact.mjs`, which rewrites the hooks module's bare `preact` import to the file next to it; `app/src/ui.js` is the one module the screens import them from. The new screens (tree, People, person page, Settings, signing in, the tabs) are Preact. The parts that belong to the map stay plain DOM: the family pins, year range and life path (`app/src/family-map.js`) and the "Family here" section of the plain-DOM place sheet. The work panel from `add-proposals-and-review` stays plain DOM too; the Owner decided not to rewrite it in this change.

### Addresses and the shell
The shell (`app/src/shell.js`) owns who is signed in and which screen the address names (`app/src/routes.js`): `#person-<id>` (the tree on that focus), `#tree`, `#people`, `#people/<id>` (person page), `#settings`, `#map` and `#map=z/lat/lon`, `#life/<id>` (a life path on the map), `#sign-in`, `#invite/<token>`, `#link/<token>`, and the work panel's `#work/…`. An empty address is the tree for a signed-in Member and the map for anyone else. Family addresses opened without sign-in show the sign-in screen and open once signed in; with an emailed link (a new page) the address is kept on the device until then. The map writes `#map=…` only while it is the screen shown. The tabs are Tree, Map, People, Review (Editors; it opens `#work/review`) and Settings; the work panel stays reachable from the map's pencil button and from "Propose a change" on a person page.

### Signing in moves into the app
The minimal server pages under `/auth/` are removed: their steps (accept an invitation, emailed link, passkey sign-in and registration) are app screens, using the same API. Invitation and sign-in emails link to `/#invite/<token>` and `/#link/<token>`; the token is taken out of the address at once. The pages had no Owner functions; the Owner's Member management is new in Settings. Nothing had been deployed, so no old links needed redirects.

### Clustering without a plugin
Family pins are grouped by a small pure function (`clusterPins()` in `app/src/pins.js`: pins closer than 56 px at the zoom shown share a group), not by the Leaflet.markercluster plugin. The plugin is a UMD script that expects a global `L`, while the app loads Leaflet as an ES module; a few lines of tested code avoided a global and a second vendored library. Tapping a group zooms to its pins.

### Local cache
The app keeps loaded records in IndexedDB, keyed by id and version. The person page renders from cache first and refreshes when online. A small "as of" label shows the cache time. Nothing is cached for someone who is not signed in, and signing out clears the cache.

As built (`app/src/cache.js`): records are kept by key (`me`, `person:<id>`, `hourglass:<id>:<up>:<down>`, `people:<query>:<n>`, `citation:<id>`, `place-events:<id>`), each with the version the server gave and the time it was loaded, at most 400, the least recently used dropped first. "As of" appears only when what is shown could not be refreshed. The cache is also emptied when the server answers that the session has ended (another device ended it), and signing out forgets the remembered focus. Offline, the Member last signed in on the device stays signed in until the server can answer.

### Tree home and layout
The tree is the default route for signed-in Members (`#person-<id>`, else the remembered focus, else the Member's own Person, else a Family root). The map route stays the default without sign-in. The tree is an SVG hourglass drawn from one API request that returns the focus Person's ancestors and descendants with partners, to the depth asked for. Layout runs in the browser: ancestors as a binary tree above the focus, descendants grouped by Family below, partners on the same row. It's sized so 3 up and 2 down fit at phone width, with pan and pinch-zoom for more. Refocusing animates the move, so the Member keeps their bearings. Fan charts were considered and rejected: their labels become unreadable on a phone.

### Tree home and layout, as built
The layout is a pure function (`app/src/hourglass-layout.js`) from the API's hourglass to boxes and lines with the focus Person at (0, 0). Ancestors are couple cards, the father above the mother, so that 3 generations up (4 couples) fit 390 px at full size; a line from each couple enters the side of the child's box. A Person with two or more partners has the first on the left and the others on the right, each Family's children below its couple. A birth Family is drawn as the parents; other parent Families (adoptive, foster) are named under the tree, and non-birth child lines are dashed. The first view fits the ancestors and the focus row to the screen's width; wider rows of descendants are a pan away. Refocusing keeps every box element and moves it with a CSS transition. The focus is chosen by the pure `chooseFocus()` in `app/src/focus.js`. The depth (1 to 6 each way) and the last focus are kept per device.

### The Member's own Person
`account.person_id` links a Member to a Person and is set by the Owner only. The link is shown to that Member alone. It's a link to a Living person, so it is never part of an Export.

As built: `PUT /api/members/:id/person` (Owner only; a merged Person is linked as the kept one), shown as `me.person` and in the Owner's list of Members. Every Member changes their own language (and display name) with `PATCH /api/me`; choosing a language in the app sets it on the device and on the account, so emails follow it.

### The relation to the family, until add-vault-import
Relatives, Possible relatives, Unrelated people and Family roots come from `add-vault-import` (its tasks 1.3 and 1.4), which is not built yet. The app reads the relation in one module, `app/src/relation.js`: with no relation known everyone is shown, the switch for Unrelated people stays hidden, nobody is marked as a Possible relative, and an unlinked Member's tree opens on search because there is no Family root. Wiring it in later means filling in `relationOf()` and `familyRoots()` there.

### Map layers
Family pins come from the map query (bounding box plus year range) and use Leaflet marker clustering. The year slider debounces its requests. The life path is a polyline in date order.

As built: a pin per House with its own location, else per Place; "Family here" reads the new `GET /api/places/:id/events` (the Events at a Place and its Houses, with who took part). The life path joins consecutive Events in one Place into one labelled point. Pins abroad open the place sheet with the family's Events and the note that archive lookup and historical maps cover only the Czech lands.

## Risks / Trade-offs

- [Large cache on small phones] → only viewed records and the current map area are cached, with a cap and least-recently-used eviction.
- [Data left on a shared family tablet] → signing out clears the cache, and sessions can be ended remotely (member-accounts).

## Open Questions

None that change the specs.
