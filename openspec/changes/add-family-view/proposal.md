# Proposal

## Why

With the Tree on the server and Proposals flowing in, Members need to see their family: who someone was, how people connect, and where they lived across the map and over time. This is what the map was built for.

## What Changes

- Sign-in screens in the app: accepting an invitation, registering a passkey, and the emailed-link fallback.
- People list and search across all Names, ignoring diacritics.
- Person page: Names, Events with Roles, Places and Houses, Families, and Citations with confidence and images, with "Propose a change" and history.
- Pedigree of up to 6 generations, and a descendants list.
- Family on the map: pins for Events, a year slider, a person's life path, and a "Family here" section in the place sheet.
- The last-loaded family data stays available offline.

Out of scope: Proposal forms and the review queue (`add-proposals-and-review`); charts beyond pedigree and descendants; printing; public sharing of any view.

## Capabilities

### New Capabilities
- `family-view`: signing in and reading people, families and evidence in the app.
- `family-map`: family Events on the map, through time.

### Modified Capabilities

## Impact

- New app screens and a local cache of Tree data in IndexedDB.
- Uses the read API from `add-tree-backend`. The map from `add-map-core` gains family layers once a Member is signed in, and stays as it is without sign-in.
- Adopts Preact with htm (vendored, still no build step) for the screens this change adds.
