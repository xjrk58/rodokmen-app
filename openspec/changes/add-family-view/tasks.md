# Tasks

## 1. Foundation

- [ ] 1.1 Vendor Preact and htm into `app/vendor/` and add the signed-in shell with tabs for Map, People, Review (Editors) and Settings; verify the shell renders in Playwright at a 390 px wide viewport
- [ ] 1.2 Build the sign-in screens (invitation, passkey registration, emailed link); verify the first-visit scenario with a virtual authenticator and the not-signed-in scenario

## 2. People

- [ ] 2.1 Build the people list and search; verify the "dvorakova" scenario against the fixture tree
- [ ] 2.2 Build the person page with Names, Events and Roles, Families, Citations with confidence and images, history and "Propose a change"; verify the godparent scenario
- [ ] 2.3 Build the pedigree (SVG, 6 generations, tap to re-root) and the descendants list; verify the walking-up scenario and readability with a screenshot at 390 px

## 3. Family on the map

- [ ] 3.1 Add family pins with clustering for signed-in Members; verify the zoom scenario
- [ ] 3.2 Add the year slider and decade play; verify the 1820–1850 scenario
- [ ] 3.3 Add the life path from the person page; verify the three-villages scenario
- [ ] 3.4 Add "Family here" to the place sheet, including the message for Places outside the Czech lands; verify both scenarios

## 4. Offline

- [ ] 4.1 Cache viewed records in IndexedDB with an "as of" label, a cap and eviction, and clear the cache on sign-out; verify the reading-room scenario offline and that sign-out empties the cache

## Workflow follow-up

- Archive this change after it ships so its specs move to `openspec/specs/`.
