# Tasks

## 1. Foundation

- [x] 1.1 Vendor Preact and htm into `app/vendor/` and add the signed-in shell with the tree as home and tabs for Map, People, Review (Editors) and Settings; verify the opening-the-app scenario in Playwright at a 390 px wide viewport, and that a visitor who isn't signed in still lands on the map
  - Note: Preact 10.29.8 and htm 3.1.1 in `app/vendor/` (`scripts/vendor-preact.mjs`); the shell is `app/src/shell.js`. Verified by `tests/e2e/family-tree.spec.js` (opening the app, the Contributor without Review, the visitor on the map) at 390 px and desktop.
- [x] 1.2 Build the sign-in screens (invitation, passkey registration, emailed link); verify the first-visit scenario with a virtual authenticator and the not-signed-in scenario
  - Note: `app/src/sign-in-screen.js` (`#sign-in`, `#invite/<token>`, `#link/<token>`). Verified with a virtual WebAuthn authenticator against the real server in `server/test/passkeys.e2e.test.ts` (first visit from an invitation at 390 px ends on the tree; emailed link on a new phone; shared link after sign-in; disabled Member refused), and at both viewports with the mocked API in `tests/e2e/family-sign-in.spec.js` (not signed in, invitation, emailed link, no passkeys in the browser). The server's `/auth/` pages are removed and the emails link into the app.

## 2. People

- [x] 2.1 Build the people list and search; verify the "dvorakova" scenario against the fixture tree
  - Note: verified by `tests/e2e/family-people.spec.js` and against the fixture Tree in `server/test/family-view.e2e.test.ts`. The "Unrelated people hidden by default" requirement (village index entries) came with task 2a.6 under #15: verified in `tests/e2e/family-relation.spec.js` and against the real server; without a Family root everyone is listed and the switch stays hidden (`app/src/relation.js`).
- [x] 2.2 Build the person page with Names, Events and Roles, Families, Citations with confidence and images, history and "Propose a change"; verify the godparent scenario
  - Note: each Event on `GET /api/persons/:id` now carries its Citations; a Citation opens with its transcription and page images (`GET /api/citations/:id`). "Propose a change" opens the correction form on that Person (`#work/propose/correction/<id>`); history is `#work/history/person/<id>`. Godparent scenario verified at both viewports and against the fixture.
- [x] 2.3 Add "Show in tree" to search results and person pages; verify it opens the tree on that Person
  - Note: verified from search results and person pages in `tests/e2e/family-people.spec.js` and against the fixture.

- [x] 2.4 Build Owner settings (invitations, roles, disable and enable, Member–Person links, Family roots) and each Member's own settings; verify the inviting-a-cousin and Contributor's-settings scenarios, and move the minimal `/auth/` server pages' Owner functions into the app
  - Note: invitations, roles, disable and enable, Member–Person links (`PUT /api/members/:id/person`) and each Member's own language (`PATCH /api/me`), sessions, passkeys and sign-out, in `app/src/settings-screen.js`; inviting-a-cousin and Contributor's-settings verified in `tests/e2e/family-settings.spec.js` and against the real server. The `/auth/` pages had no Owner functions; the sign-in steps they held moved into the app (task 1.2) and the pages are gone.
  - Note: Family roots built under #15 with add-vault-import tasks 1.3/1.4: the "Family roots" section of Owner settings lists them, marks one through a Person picker and removes one (`GET /api/family-roots`, `PUT /api/persons/:id/family-root`, Owner only); the Owner also marks and unmarks them on the person page. Until the first is marked, the section asks the Owner to mark one and the app shows everyone. Verified in `tests/e2e/family-relation.spec.js` at both viewports (the prompt, marking and removing, the person page, a Contributor sees neither) and against the real server in `server/test/family-view.e2e.test.ts` (the Owner marks the fixture's founder in the app).

## 2a. The tree

- [x] 2a.1 Add the hourglass API query (ancestors and descendants with partners, 1–6 generations each way, in one request); verify against the fixture tree's known families, including a remarriage and an adoption
  - Note: `GET /api/persons/:id/hourglass?up&down` (`server/src/tree/pedigree.ts`); verified in `server/test/hourglass.test.ts` against the fixture: Jan Novák's two marriages, Marie Nováková's birth and adoptive Families, 5 generations up, the 1–6 bounds.
- [x] 2a.2 Draw the hourglass in SVG with 3 up and 2 down by default, adjustable depth, pan and pinch-zoom; verify the second-marriage and deeper-ancestry scenarios and readability with a screenshot at 390 px
  - Note: layout in the pure `app/src/hourglass-layout.js` (unit tests: no overlaps at every depth, second marriage, deeper ancestry, adoption); drawing, pan, wheel and pinch in `app/src/tree-screen.js`. Verified in `tests/e2e/family-tree.spec.js` at both viewports (pinch on the phone) and on the fixture; 3 up fit 390 px at full size, checked with a phone screenshot of the fixture Tree (`FAMILY_SCREENSHOTS=<dir>` on `server/test/family-view.e2e.test.ts`). The layout could be proved with `lsc check` (ADR 0009) only after a rewrite into LemmaScript's subset (no closures over Maps); not done.
- [x] 2a.3 Tap to refocus, and long press or second tap to open the person page; verify the moving-up-a-line scenario
  - Note: tap, second tap, long press and the keyboard (Enter) verified in `tests/e2e/family-tree.spec.js`.
- [x] 2a.4 Put the focus in the address and remember it per device; verify the shared-link scenario
  - Note: shared-link scenario verified with two browser contexts in `tests/e2e/family-tree.spec.js`, and after sign-in against the real server in `server/test/passkeys.e2e.test.ts`.
- [x] 2a.5 Add the Owner's link from a Member to their Person, the "Me" button, and the Family-root fallback; verify the new-Member and not-linked scenarios
  - Note: the Owner's link (`account.person_id`, `me.person`), the "Me" button and the fallback order (address, remembered, own Person, Family root, else search) as the pure `chooseFocus()` in `app/src/focus.js`; the new-Member scenario is verified in the browser and on the fixture. `chooseFocus()` fits LemmaScript's subset: prove it with `lsc check` once it moves into `shared/` (ADR 0009).
  - Note: the Family-root step built under #15: the roots come with `me.familyRoots`, the first marked first. Not-linked scenario ("opens on a Family root") verified in `tests/e2e/family-relation.spec.js` and against the real server at 390 px and 1280 px (`server/test/family-view.e2e.test.ts`); with no Family root yet the tree still opens on search (`tests/e2e/family-tree.spec.js`).
- [x] 2a.6 Mark Possible relatives and Living people in the tree and hide Unrelated people by default; verify the weak-link scenario
  - Note: built under #15 with add-vault-import tasks 1.3/1.4, read in `app/src/relation.js` only. A Possible relative's box is dashed in its own colour with a "?" badge (and says so to screen readers); a weak link (`weakLink` on the hourglass' Families and child links) is drawn dotted in that colour; Living people are marked as before. Unrelated people are hidden in the tree, search, the people list and the family pins until switched on; search and the map ask the server for `relation=relative,possible`. Weak-link scenario verified in `tests/e2e/family-relation.spec.js` at both viewports and against the real server at 390 px and 1280 px, with a phone screenshot of a Possible relative's tree (`FAMILY_SCREENSHOTS`); the village-index and busy-village scenarios too. `isShown()` stays in the app (no TypeScript there), unproved; the relation rule it reads is proved.

## 3. Family on the map

- [x] 3.1 Add family pins with clustering for signed-in Members; verify the zoom scenario
  - Note: grouping is the pure `clusterPins()` in `app/src/pins.js` (unit tests), not the Leaflet.markercluster plugin (see design). Verified in `tests/e2e/family-map.spec.js` and on the fixture. The "busy village" scenario of "Family pins show the family" came with task 2a.6 under #15: the map control's switch includes Unrelated people; verified in `tests/e2e/family-relation.spec.js` and against the real server. Without a Family root the pins count everyone.
- [x] 3.2 Add the year slider and decade play; verify the 1820–1850 scenario
  - Note: two sliders (from, to), debounced; play steps through the decades. Verified in `tests/e2e/family-map.spec.js`.
- [x] 3.3 Add the life path from the person page; verify the three-villages scenario
  - Note: `#life/<id>`; the pure `lifePath()` joins consecutive Events in one Place. Verified in the browser and on the fixture.
- [x] 3.4 Add "Family here" to the place sheet, including the message for Places outside the Czech lands; verify both scenarios
  - Note: `GET /api/places/:id/events` (verified in `server/test/hourglass.test.ts`); both scenarios verified in `tests/e2e/family-map.spec.js`, the village one also on the fixture.

## 4. Offline

- [x] 4.1 Cache viewed records in IndexedDB with an "as of" label, a cap and eviction, and clear the cache on sign-out; verify the reading-room scenario offline and that sign-out empties the cache
  - Note: `app/src/cache.js` (IndexedDB, at most 400 records, least recently used first: the pure `toEvict()` is unit-tested). Emptied on sign-out and when the server says the session has ended. Reading-room scenario verified offline with the service worker in `tests/e2e/family-offline.spec.js`; sign-out empties it in `tests/e2e/family-settings.spec.js`.

## Workflow follow-up

- Archive this change after it ships so its specs move to `openspec/specs/`.
