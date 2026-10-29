# Proposal

## Why

With the Tree on the server and Proposals flowing in, Members need to see their family: who someone was and how people connect. The tree itself, centred on whoever they are looking at, is what a Member opens the app for; the map shows where the family lived.

## What Changes

- Sign-in screens in the app: accepting an invitation, registering a passkey, and the emailed-link fallback.
- **The home screen for signed-in Members is the tree**: an hourglass centred on a focus Person (ancestors above, descendants below, partners beside), 3 generations up and 2 down by default, adjustable. Tapping anyone makes them the focus.
- The focus shows in the address and is remembered per device. The Owner can link each Member to their own Person, and the tree opens there.
- People list and search across all Names, ignoring diacritics.
- Person page: Names, Events with Roles, Places and Houses, Families, Citations with confidence and images, "Show in tree", "Propose a change" and history.
- The map becomes a tab, with family pins, a year slider, a person's life path, and a "Family here" section in the place sheet. Visitors who aren't signed in still get the map as their home screen.
- The last-loaded family data stays available offline.
- Unrelated people (from `add-vault-import`) are hidden by default in search, lists, the tree and pins.

Out of scope: Proposal forms and the review queue (`add-proposals-and-review`); fan charts and printed charts; public sharing of any view.

## Capabilities

### New Capabilities
- `family-tree`: the tree home screen, its focus, layout and navigation, and the Member's own Person.
- `family-view`: signing in, people search and the person page.
- `family-map`: family Events on the map, through time.

### Modified Capabilities

## Impact

- New app screens and a local cache of Tree data in IndexedDB. The app shell's default route changes from the map to the tree for signed-in Members.
- A new API field and route: the Member's linked Person (`me.person`, set by the Owner), and an hourglass query (ancestors and descendants with partners around one Person in one request).
- Uses the read API from `add-tree-backend`. The map from `add-map-core` stays as it is for visitors who aren't signed in.
- Adopts Preact with htm (vendored, still no build step) for the screens this change adds.
