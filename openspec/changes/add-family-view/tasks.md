# Tasks

## 1. Foundation

- [ ] 1.1 Vendor Preact and htm into `app/vendor/` and add the signed-in shell with the tree as home and tabs for Map, People, Review (Editors) and Settings; verify the opening-the-app scenario in Playwright at a 390 px wide viewport, and that a visitor who isn't signed in still lands on the map
- [ ] 1.2 Build the sign-in screens (invitation, passkey registration, emailed link); verify the first-visit scenario with a virtual authenticator and the not-signed-in scenario

## 2. People

- [ ] 2.1 Build the people list and search; verify the "dvorakova" scenario against the fixture tree
- [ ] 2.2 Build the person page with Names, Events and Roles, Families, Citations with confidence and images, history and "Propose a change"; verify the godparent scenario
- [ ] 2.3 Add "Show in tree" to search results and person pages; verify it opens the tree on that Person

## 2a. The tree

- [ ] 2a.1 Add the hourglass API query (ancestors and descendants with partners, 1–6 generations each way, in one request); verify against the fixture tree's known families, including a remarriage and an adoption
- [ ] 2a.2 Draw the hourglass in SVG with 3 up and 2 down by default, adjustable depth, pan and pinch-zoom; verify the second-marriage and deeper-ancestry scenarios and readability with a screenshot at 390 px
- [ ] 2a.3 Tap to refocus, and long press or second tap to open the person page; verify the moving-up-a-line scenario
- [ ] 2a.4 Put the focus in the address and remember it per device; verify the shared-link scenario
- [ ] 2a.5 Add the Owner's link from a Member to their Person, the "Me" button, and the Family-root fallback; verify the new-Member and not-linked scenarios
- [ ] 2a.6 Mark Possible relatives and Living people in the tree and hide Unrelated people by default; verify the weak-link scenario

## 3. Family on the map

- [ ] 3.1 Add family pins with clustering for signed-in Members; verify the zoom scenario
- [ ] 3.2 Add the year slider and decade play; verify the 1820–1850 scenario
- [ ] 3.3 Add the life path from the person page; verify the three-villages scenario
- [ ] 3.4 Add "Family here" to the place sheet, including the message for Places outside the Czech lands; verify both scenarios

## 4. Offline

- [ ] 4.1 Cache viewed records in IndexedDB with an "as of" label, a cap and eviction, and clear the cache on sign-out; verify the reading-room scenario offline and that sign-out empties the cache

## Workflow follow-up

- Archive this change after it ships so its specs move to `openspec/specs/`.
