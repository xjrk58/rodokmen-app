# Design

## Context

See proposal.md for why. What exists and constrains the approach:

- **The family map** (`add-family-view`, built): `app/src/family-map.js` draws family pins, the year range (two range inputs, 1600 to 1950) with a play button that steps through decades every 1.2 s, and a Person's life path. Pure helpers are in `app/src/pins.js`: `pinsFromEvents` (a pin per House with its own location, else per Place), `clusterPins` (pins closer than 56 px share a group), `lifePath` (consecutive Events in one Place merge into one point, Houses or not) and `decades`. Pins come from `GET /api/map/events` (bounding box and year range, at most 2,000 Events by default, 5,000 at most), requested again 300 ms after every change of the map area or the range, so while playing it asks the server at every step.
- **The relation to the family** (`add-vault-import`, built under #15): `relationLevels` in `shared/src/relation.ts` is proved; `recomputeRelations()` in `server/src/tree/relation.ts` writes `person.relation` (`relative`, `possible`, `unrelated`) at the end of every accepted change, Family roots included. Spouses of Relatives are Relatives when their partner link is confirmed (GLOSSARY, "Relative").
- **Positions** (`server/src/db/migrations/0002_tree.ts`): `place.location` and `house.location` are optional PostGIS points. The map query places an Event at `coalesce(h.location, p.location)`. Neither location can be changed after a record is created: `SETTABLE_FIELDS` in `shared/src/schemas/proposals.ts` has no `location`, and there is no operation for it.
- **What the Vault import wrote** (`server/src/vault-import/map-places.ts`): a Place gets the note's own `lat` and `lon`, else its Municipality's point when the names match, else none. A House is created with **no** location (`mapHouse` calls `createHouse` without one). The line `location: m ? …` that #166 quotes belongs to the seat Place that `mapParish` creates. So every House of the Owner's Tree has no position today, and its Events sit on its Place's point, which is often the Municipality's point. The effect on the map is the one #166 describes, the cause is not.
- **Evidence** (`shared/src/rules.ts`, proved): `satisfiesEvidenceRule` sees operation names only. An operation not listed in `isFactFreeOperation` needs a Citation, created or attached, in the same Proposal. #157's decision (a Citation's note may change without new evidence) is being built with #137 and #135 and will make the rule look at the fields a `setField` sets; nothing here depends on it or touches it. A Citation can be attached to an Event or a Name only (`attachCitation`), and `SourceType` is `parish_register`, `census`, `land_book`, `family_account` or `other`.
- **The app has no build step** and cannot run `shared/`. Where app code mirrors a shared rule, a test checks it against the rule (`app/src/reading-draft.js`).
- **Historical maps** (`add-map-core`): `app/data/layers.json` has two WMS overlays, the 2nd and 3rd military surveys from CENIA, requested in EPSG:3857 and on by default until the Owner checks them on a phone (#24). The stable cadastre is **not** an overlay: the place sheet only links to the ČÚZK Archiv viewer. `app/src/layer-check.js` asks each overlay for one tile at zoom 13. The server builds the Content-Security-Policy's image hosts from `layers.json`. `add-country-packs` adds that an overlay is offered only when it is aligned **and** its licence allows showing it in the app.
- **Kinship** (`add-kinship`, being built on `feat/kinship`) keeps an in-memory copy of the Family links keyed by the newest `log_entry`. The map lines use the same key.
- **Open decisions** that touch this change: #61 (the base map), #62 (paid historical map licences: links only until a quote arrives) and #24 (which overlays stay on, checked on a phone).

## Goals / Non-Goals

**Goals:**

- Every rule that decides what a line means (which lines exist, which show in a range, how wide, how strong, which are left out) runs on the server, in `shared/`, and is proved. The app only draws.
- Playing needs one request, so a phone plays smoothly and offline once loaded.
- A House position is a fact with its evidence, reviewed like any other.

**Non-Goals:**

- Animating Possible relatives, Unrelated people or one Person's life path through time.
- Positions of fields and plots, or of Places (see proposal, "Out of scope").
- Reading positions out of map images by machine.

## Decisions

### Map lines: what they are

A **Map line** (new GLOSSARY term; "link" already means a Family link, and "weak link" a Family link without a confirming Citation) joins two points on the map that a Family link joins at a time:

- a **generation line** from a parent's birthplace to a child's, for each birth or adoptive child link (step and foster links give none: they say nothing of where the child came from), dated by the child's birth;
- a **marriage line** between the birthplaces of the two partners of a Family that has a marriage Event in which both are partners, dated by that Event.

A Person's **birthplace** is the position of their birth Event, else their baptism Event, in which they have the Role child: the House's position when the House has one, else the Place's. Nothing else stands in for it: a residence or a death says where someone lived later, not where they came from, and mixing them would make lines that mean different things. Older generations, born before the registers begin, therefore often have no birthplace; Open Question 2 asks whether their marriage Place should stand in.

A line is **dated** by the earliest year its Event could be (`date_earliest`), as Events are ordered (tree-model spec, "Dates allow uncertainty"). An Event with an open start (`../1805`) or no date gives no line, since its earliest year would be a guess.

Lines with the same kind and the same two ends (in order for generation lines, either way for marriage lines) are **one line** with several **crossings**: each crossing is one birth (the child, the parent) or one marriage (the two partners) with its year. Both ends must be Relatives (below); a line whose ends are the same point is not drawn, and is not counted.

Alternatives considered:

- **A line per Event a Person took part in, in life order** (every move). That is the life path, already on the map for one Person; for a few hundred Relatives at once it becomes a tangle with no meaning per line.
- **Marriage line from each partner's birthplace to the marriage Place.** Usually the bride's parish, so one end repeats the bride's birthplace and the line says less than the two villages the marriage joins.
- **Lines between Houses inside one village.** Drawn when both ends are Houses with their own positions; the lines are then short and only seen when zoomed in, which is what the Owner asked of House positions.

### Relatives only, recomputed with the relation

The server reads `person.relation` as last computed, so lines follow Family roots and the evidence without code of their own: a line needs every Person at its ends to be `relative`. Possible relatives are left out, not drawn differently: the Owner asked for the tree of Relatives (#166, answer 2), and a dashed "possible" line on a map already full of lines is hard to read. Open Question 1 asks whether to add them later as a switch. The switch for Unrelated people keeps working on pins only.

### Computed on the server, played in the app

`GET /api/map/lines` (action `read`; Members and Agents, as the other Tree routes):

- query: `from`, `to` (years, 1600 to 1950, as the slider) and optionally `step` (1, 5 or 10). Without `step` the answer has one **frame** for the range; with it, one frame for every range the play passes through, from `from`–`to` moving by `step` and keeping the width, the last shortened to end at 1950 (family-map spec, "Playing through time").
- answer (`shared/src/schemas/map-lines.ts`, in `server/openapi.json`):
  - `asOf`: the id and time of the newest `log_entry`;
  - `lines`: every line shown in at least one frame, each with `id`, `kind` and its two ends (`lat`, `lon`, `placeId`, `houseId` or null, the Place's name and house number), and its crossings (`year`, `personIds`);
  - `persons`: id and display name of each Person in a crossing;
  - `frames`: for each range, `from`, `to`, `left` (lines left out) and `shown`, a list of `[line index, crossings, width step 1–4, strength 1–3]`;
  - `legend`: the thresholds of the width steps and the strengths, so that the legend is written from the same numbers the rules used.
- **Size**: for 500 lines and 66 frames of up to 500 entries each, about 33,000 short arrays, some 300 KB of JSON and about 50 KB compressed. A frame holds only what changes on screen, so the app needs no rule of its own.
- **The line copy**: the server gathers the Relatives' birth and baptism Events with their positions, the Families with their child links and marriage Events, once per state of the Tree (the newest `log_entry` id), as `add-kinship` does for its link copy; if kinship's helper has landed, both use it. Each server slot keeps its own copy. A few hundred Relatives make a few thousand rows.

The app (`app/src/map-lines.js`, plain DOM and Leaflet like the rest of the map):

- asks once when the lines are switched on or the range is set by hand (debounced as the pins), and once per play, with `step`; it keeps the last answer in the cache (`map-lines:<from>:<to>:<step>`) for offline replay;
- plays by moving through `frames` on a timer (one frame every 800 ms), drawing only what changed since the previous frame, with CSS transitions of `stroke-width` and `stroke-opacity` (off under `prefers-reduced-motion`);
- while playing, pins are asked for once per frame as today, but late answers no longer hold back the lines.

Alternatives considered:

- **The rules in the app**, from all crossings sent once. Smallest answer, but the rules that the Owner's question 1 is about (which show, how wide) could not be proved, since the app cannot run `shared/`; a mirrored copy with a cross-check test is the fallback if answers grow too big.
- **One request per frame.** 66 requests per play, each a chance to stall on a phone's network, and no offline replay.
- **Precomputed change points per line** (when each line's width or strength changes). Smaller than frames, but harder to prove than a frame, and the app would need a lookup rule of its own.

### Width, colour and the legend

- **Width** steps by the number of crossings in the range: 1 → 2 px, 2–3 → 3.5 px, 4–7 → 5 px, 8 or more → 7 px. Steps of powers of two keep a busy road visible without one line drowning the map. Counted crossings, not Persons: a line with five children born is five, even if one father had all of them.
- **Strength** by the age of the newest crossing before the range's end: up to 10 years → full, up to 30 → middle, older → faint (opacity 1, 0.65, 0.35). With the default window of 30 years, a line fades out over one generation as play moves on.
- **Colour** by kind: two colours chosen from the app's palette so that they differ for protanopia and deuteranopia (checked by a simulated-vision contrast test in the app's unit tests) and keep a contrast of at least 3:1 against the base map and both military survey overlays at their default opacity. **Pattern** by kind: generation lines solid with a small dot at the child's end, marriage lines dashed, so colour is never the only cue. The life path keeps its own colour (`#b5541c`), which neither kind may use.
- **Legend**: a folding panel above the year control, written from `legend` and i18n keys; it opens folded on a phone after the first visit.

### Readable with 4,100 Persons

Only Relatives make lines, a few hundred Persons, so a few hundred lines at most in a range. Three further rules keep it readable:

- **Zoom** (app): lines take the ends of the pin groups of `clusterPins` at the zoom shown. Lines inside one group are not drawn; lines between the same two groups are drawn once with the widest step and strongest strength among them, and their tap list joins their crossings. This is display, like `clusterPins` itself, and is covered by unit tests.
- **Cap** (server, proved): a frame shows at most 500 lines, the widest first, then the newest, then by line id; `left` counts the rest, and the map says so.
- **Order**: lines are drawn under the pins, faint before strong, so strong lines sit on top.

### Playing, pausing, stepping

The play button keeps its place. Next to it: step back, step forward, and a step choice (1, 5, 10 years) in the range's menu. Play from the full range starts at 1600–1629 (one generation); from any other range it keeps that range's width. Dragging a slider pauses. The address does not change while playing.

Tests do not wait for real time: Playwright steps with the step buttons, and plays with its fake clock (`page.clock`), which the ESLint rule against fixed waits allows.

### Performance budgets

On a mid-range Android phone (the phone project in Playwright, with CPU throttled four times through the DevTools protocol, stands in for it in CI):

- **Answer**: at most 400 KB of JSON for a whole play (asserted on the generated Tree of 5,000 invented Persons with 400 Relatives); the server answers within 300 ms with a warm line copy, and rebuilds the copy within 1 s.
- **First frame**: drawn within 1 s of the answer.
- **Each step**: no long task (over 50 ms) while playing 20 steps, measured with a `PerformanceObserver`; the aim is under 8 ms of script work per step. At most 500 lines, drawn with Leaflet's SVG renderer, updating only the lines that changed.
- **Pan and zoom while playing**: lines are regrouped on `zoomend` only. The Owner checks smoothness on a real phone before the change is closed (task 8.2).
- **Memory**: under 10 MB more than the map without lines.

The SVG renderer was chosen over Canvas for its CSS transitions and per-line elements (tap targets, test ids). If the budget fails with 500 lines, Canvas with transitions written in script is the fallback, and only `map-lines.js` changes.

### The stable cadastre: what is available

Checked on 2026-11-14 from the build environment, by opening each page or service named here.

- **Images only.** ČÚZK's Ústřední archiv zeměměřictví a katastru (ÚAZK) holds the imperial imprints (císařské povinné otisky) of the stable cadastre, 1824–1843, at 1:2,880. Its Archiv viewer also shows the original maps and the indication sketches (indikační skici) of the Národní archiv, Moravský zemský archiv and Zemský archiv Opava ([ÚAZK news](https://cuzk.gov.cz/Urady/Zememericky-urad/Dalsi-informace/UAZK/Aktuality-a-sdeleni-Ustredniho-archivu-zememerictv.aspx), April 2014: "obě zásadní mapová díla stabilního katastru jsou nyní dálkově dostupná v celém dochovaném rozsahu"). The national catalogue describes them as raster scans ("colour raster copies", about 8,400 maps of Bohemia, [CZ-CUZK-COC-R](https://geoportal.gov.cz/php/micka/record/basic/CZ-CUZK-COC-R?dlang=eng); Moravia and Silesia in [CZ-CUZK-COM-R](https://geoportal.gov.cz/php/micka/record/basic/CZ-CUZK-COM-R?dlang=eng)).
- **No structured data.** No dataset of houses, house numbers, building outlines or parcels from the stable cadastre was found, at ČÚZK or elsewhere. ČÚZK's open data terms list today's data only ([open data terms](https://cuzk.gov.cz/Predpisy/Podminky-poskytovani-prostor-dat-a-sitovych-sluzeb/Podminky-poskytovani-prostorovych-dat-CUZK.aspx)). The written part (parcel and building-plot protocols with house numbers and holders) "se pro všechna katastrální území v úplnosti nedochoval" ([ÚAZK, about the archive](https://cuzk.gov.cz/Urady/Zememericky-urad/Dalsi-informace/UAZK/O-archivu-podrobnejsi-informace.aspx)) and was not found online. Building plots carry their numbers on the maps. House numbers are written on the indication sketches, as the projects that trace them record ([OpenHistoricalMap, Indication sketches](https://wiki.openstreetmap.org/wiki/OpenHistoricalMap/Projects/Indication_Sketches)); no sheet was read here.
- **A georeferenced layer, not for others.** The Archiv viewer (`https://ags.cuzk.gov.cz/archiv/`; the old `archivnimapy.cuzk.cz` now ends in a 404) draws a joined, georeferenced layer of the imperial imprints in S-JTSK (EPSG:5514). The layer is still incomplete ("Vrstva Císařských otisků vzniká postupně z dostupných dat", the viewer's own help). Its services under `https://ags.cuzk.gov.cz/arcgis4/rest/services/Archiv/` answer `{"error":{"code":499,"message":"Token Required"}}`, and the viewer gets its token from a service bound to its own address. ČÚZK's list of [public WMS](https://geoportal.cuzk.gov.cz/(S(0))/Default.aspx?mode=TextMeta&side=wms.verejne&text=WMS.verejne.uvod&head_tab=sekce-03-gp&menu=311) has no stable cadastre service, and its open ArcGIS folders (`arcgis`, `arcgis1`, `arcgis2`) have none either. Taking the viewer's token for Rodokmen would get round an access control, so the plan does not.
- **What the viewer allows.** Its help says a view may be placed on another site: "Prohlížím si archiválii a chci do své html stránky umístit právě zobrazený rozsah okna … Mohu? Ano, … tlačítko Sdílet archiválii … odkaz, který můžete na Vašich stránkách použít do tagu iframe" (in `https://ags.cuzk.gov.cz/archiv/assets/data-D47DtZz0.js`). It reads `extent`, `xy` and other parameters from its address. Their format is not documented, so task 6.1 finds it before the link opens at a Place.
- **Open but partial.** Two other services show imprints openly, both in S-JTSK only, and both answer an ArcGIS `export` in Web Mercator: Prague's (`https://gs-pub.praha.eu/imgs/rest/services/arch/stabilni_katastr_cisarske_otisky_2880/ImageServer`, Prague only, with a ČÚZK watermark) and the Národní památkový ústav's (`https://geoportal.npu.cz/arcgisr/rest/services/Polohopisy/StabKat/MapServer`, "© Ústřední archiv zeměměřictví a katastru, NPÚ", 176 sheets). Neither says that an outside app may show it, and neither covers the family's villages in general, so neither becomes an overlay here.
- **Today's aerial photograph is open.** ČÚZK's orthophoto service in Web Mercator (`https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer`, spatial reference 102100, that is EPSG:3857) is open data under CC BY 4.0, credited "ČÚZK" with the year ([open data terms](https://cuzk.gov.cz/Predpisy/Podminky-poskytovani-prostor-dat-a-sitovych-sluzeb/Podminky-poskytovani-prostorovych-dat-CUZK.aspx)). ČÚZK's network services are free for any use with the credit "ČÚZK – on-line" ([network service terms](https://www.cuzk.gov.cz/Predpisy/Podminky-poskytovani-prostor-dat-a-sitovych-sluzeb/Podminky-poskytovani-sitovych-sluzeb-CUZK.aspx)). Most old homesteads stand on the plot they stood on, so a Member who has found the building plot on the old map can find it again on the photograph.
- **The military surveys are broken as configured.** The CENIA address in `app/data/layers.json` answers 404. CENIA's current services (`https://gis.cenia.cz/mapcache/II_vojenske_mapovani/wms`, found through its [metadata record](https://micka.cenia.cz/en/record/full/4e678953-ba1c-49a2-a61e-3b96c0a80137?dlang=cze)) offer only EPSG:5514. That is outside this change and becomes its own issue. It also changes what #24's phone check will find.

### Licences of the cadastre maps

- **Archive scans** come under the Archives Act, not the open data licence. ČÚZK's terms of 2026 (č. j. ZÚ-01256/2026-13310, [Podminky_EN.pdf](https://geoportal.cuzk.gov.cz/Dokumenty/Podminky_EN.pdf)) say "Poskytování archiválií spravovaných Ústředním archivem zeměměřictví a katastru … upravuje zákon č. 499/2004 Sb., o archivnictví", and "Data jsou poskytována zákazníkovi vždy až po zaplacení" (3.3), through the Geoportal's e-shop. A scan of a sheet costs 25 Kč up to A3 and 60 Kč above it ([ÚAZK price list](https://cuzk.gov.cz/Urady/Zememericky-urad/Dalsi-informace/UAZK/Cenik-UAZK.aspx), revised 29 January 2025).
- **Publishing a reproduction** is free and needs no permission, with a credit: "Zveřejnění reprodukce archiválie ÚAZK se nezpoplatňuje a není třeba žádat o souhlas. Požadujeme však citovat zdroj alespoň v rozsahu názvu archivu, tedy „Ústřední archiv zeměměřictví a katastru“", ideally with the kind of map and its archival signature (same page). This covers an image of a sheet attached to a Citation (ADR 0002) and bought scans shown by Rodokmen. It does not cover using the viewer's token-protected services from another app.
- **The viewer in a frame** is allowed by the viewer's own help (above).
- **Paid licences** (#62) are not needed for any of this. Arcanum's cadastral layer could not be checked: every Arcanum page answered 403.

Task 1.1 records these terms in `docs/reference/licences.md`, with the day they were read.

### House positions: placed by hand, cited to the map

Since the maps are images, a person places each House. The flow:

1. **Start.** The place sheet gets a "Houses" section, from `GET /api/places/{id}/houses`, which exists. It lists each House with its numbers over time and "placed" or "not placed". Tapping one opens a House sheet with "Place on the map" (or "Move"). The work panel's kind chooser gets "House on the map" too, which asks for the Place and the House.
2. **Place.** The map zooms to the House's position, else the Place's point, at zoom 18, with the aerial photograph switched on and its opacity adjustable; the family layer and lines are hidden. On a phone, a cross stays fixed in the middle and the Member pans under it. On a computer, a click moves the cross and arrow keys nudge it by one screen pixel. A button opens the stable cadastre at the Place: on a computer in a panel beside the map (an iframe of the ČÚZK Archiv viewer; the CSP gets `frame-src https://ags.cuzk.gov.cz`), on a phone in a new tab. The Draft is saved before leaving, so returning restores the step.
3. **Cite.** The Citation step of the hand forms, with a new Source type `map`. It offers the map Sources already cited at that Place first. A new one is filled in: title "Stabilní katastr, <Place>", repository "Ústřední archiv zeměměřictví a katastru", reference the archival signature typed by the Member from the viewer, and URL the viewer's link. The Citation's page is the sheet, and its transcription says what the sheet shows ("building plot 12, čp. 7"). Its confidence is normal when the house number is on the indication sketch or another Source names the plot, and low when the House was placed by its neighbours or by elimination. A screenshot of the sheet may be attached as the Citation's image, which the ÚAZK terms allow with the credit.
4. **Submit and review.** The Proposal holds `createSource` (when new), `createCitation` and the new operation `setHouseLocation`. The review shows the old and the new point (or the Place's point) on a small map with the aerial photograph, the distance in metres, and the Citation with the viewer link. An Editor may place a House directly, logged the same way.

**The operation** `setHouseLocation { houseId, baseVersion, location: GeoPoint | null, citationId: Ref }` sets or clears the position and stores the Citation in a new column `house.location_citation_id`. The Citation must be created in the same Proposal or exist already. The conflict check compares the House's version as for other fields, so two Members placing the same House meet as a conflict. Undo restores the earlier position and Citation from the log. Agents may propose it like any other operation through the API; there is no MCP tool of its own.

**Why a fact with evidence.** A position says where the family lived, and a wrong one moves Events and Map lines. The evidence rule needs no change: `setHouseLocation` is not fact-free, so `satisfiesEvidenceRule` already asks for a Citation, and its proof gains an ensures that says so. #157 made a Citation's note fact-free because a note describes the evidence rather than the family; a position is the other way round. Open Question 8 asks whether a small move within the same building plot should be fact-free all the same.

Alternatives considered:

- **A field in `setField`** (`house.location`). It would need no new operation, but it could not carry the Citation, and `attachCitation` takes only Events and Names.
- **A Citation attached to the House** through a new link table, as Events have. More general, but a House has only this one fact that needs a Citation (its numbers come with their Events), so one column is enough.
- **RÚIAN address points** (today's house numbers, open data). Houses were renumbered, and today's number of a homestead often belongs to a different House in the Tree; matching them is research, not a lookup. Out of scope.
- **Machine reading of house numbers from the images.** There is no data to train or check on, and every position would still need a person to confirm it.

### The village points

The import's points are Places' points, and they stay as they are: a Place's point is right for the village, even when it is only its Municipality's. A House without its own position is never given one. It keeps sitting on its Place's point through `coalesce`, and the app never draws it as a House. The map API says which it is (`MapEvent` gains `precision`: `house` or `place`), so pins, life paths and Map lines treat a House-level point as precise and a Place-level one as the village. Moving a Place's point, for example a hamlet placed on its Municipality's point, is out of scope (Open Question 10).

### Houses on the family map

`pinsFromEvents` already gives a House with its own position its own pin. `lifePath` changes so that consecutive Events at two different Houses with their own positions are two points; Events at a Place and its unplaced Houses still merge. Map lines end at a House's position when the birth was at a placed House.

### Rules proved with LemmaScript

Each rule is a pure function in `shared/src/map-lines.ts` (the last in `shared/src/rules.ts`), proved with `lsc check` and naming its requirement with `//@ contract`. Gathering the rows, the cache, the route, drawing and the grouping by zoom are the unverified shell, covered by tests.

- **Birthplace** (`birthplaceOf`; family-map "Map lines between Places"). Proved: the birth Event wins over the baptism; only Events where the Person has the Role child count; a placed House wins over its Place; no Event with a position gives none.
- **Lines from the Families** (`mapLinesOf`; family-map "Map lines between Places" and "Map lines join Relatives only"). Proved: every crossing comes from a birth or adoptive child link or from a marriage Event of both partners; every Person at a line's ends is a Relative; a line never has two equal ends; each child link and each marriage gives at most one crossing; lines with the same kind and ends are one.
- **Year of a crossing** (`crossingYear`; family-map "Map lines follow the year range"). Proved: the earliest year the date could be; none for an open start or no date.
- **Frame** (`frameOf`; family-map "Map lines follow the year range", "Line width shows how many" and "Line colour shows kind and age"). Proved: a line is in the frame exactly when one of its crossings lies in the range; its count is the number of its crossings in the range; its width step and strength come from `widthStep` and `strengthOf`.
- **Width step** (`widthStep`; family-map "Line width shows how many"). Proved: 1 for 1, 2 for 2–3, 3 for 4–7, 4 for 8 or more, never decreasing in the count.
- **Strength** (`strengthOf`; family-map "Line colour shows kind and age"). Proved: 3 up to 10 years, 2 up to 30, 1 otherwise, never increasing in the age.
- **Cap** (`capFrame`; family-map "Readable at every zoom"). Proved: at most 500 lines kept; every kept line comes before every dropped one in the order widest, then newest, then id; `left` is the number dropped.
- **The play's ranges** (`playRanges`; family-map "Playing through time", tree-read-api "Map lines in one request"). Proved: every range has the width of the first; each starts `step` after the one before, except the last, which ends at 1950; none ends after 1950; from the full range the first is 1600–1629.
- **Order** (`compareLines`; tree-read-api "Map lines follow fixed rules"). Proved: antisymmetric, 0 only for the same line, and transitive, with ids compared by code units.
- **Evidence** (`isFactFreeOperation`, `shared/src/rules.ts`; house-positions "A House position is a fact with evidence"). A new ensures: `setHouseLocation` is not fact-free, so a Proposal of it without a Citation is refused.

Not proved: that the server gathers every Relative's Events and Families (tests on the fixture Tree), the app's drawing and grouping by zoom (unit and Playwright tests), and the House flow (Playwright).

## Risks / Trade-offs

- [Few Relatives have a known birthplace before the registers] → Fewer lines in the 17th and 18th centuries. Open Question 2 offers the marriage Place as a stand-in.
- [Answers grow with a larger Tree] → The cap of 500 lines per frame and the size budget, asserted on the generated Tree. Past it, the rules move into the app with a mirrored copy checked by a test.
- [The stable cadastre is not in the app] → Placing needs two views on a phone. The Draft keeps the step, and the aerial photograph is precise enough to find a plot found on the old map. An overlay comes once permitted (Open Question 7).
- [A homestead rebuilt elsewhere after 1843] → One position per House, the one its Citation supports; the Citation says which period it shows.
- [The viewer's address format changes] → The link falls back to the viewer's start page, and the weekly archive link check gets the viewer too.
- [ČÚZK changes or charges for the orthophoto service] → It is a layer in `layers.json` that can be switched off; placing still works on the base map.
- [Animation drains a phone's battery] → Play stops at 1950 and when the app is hidden (`visibilitychange`).
- [Colours on varying backgrounds] → Pattern carries the kind and opacity the age, and the contrast test runs against each layer.

## Migration Plan

One migration (the next free number) adds `house.location_citation_id` (references `citation`, set null on delete) and `map` to the Source types' check. Both work with the previous release still running, which never writes them. The new route, operation and optional fields break no client. Rollback is a revert. The down migration drops the column, keeping the positions, and refuses while a Source of type `map` exists. Cached `map-lines:` records are ignored by an older app and age out.

## Open Questions

Points for the Owner. The specs and tasks follow the planned answer. An answer marked "changes the spec" would change the requirement named, before implementation starts.

1. **Possible relatives**: left out of Map lines (planned), or shown faint and dotted behind a switch? Changes the spec, "Map lines join Relatives only".
2. **Birthplace**: a birth, else a baptism (planned), or also the marriage Place for those born before the registers begin? Changes the spec, "Map lines between Places".
3. **Which lines**: generation lines and marriage lines (planned), or also one family line's movement, chosen by a Label?
4. **Play**: from the full range a window of 30 years, moving 5 years every 0.8 s, with a choice of 1, 5 or 10 years (planned)? Changes the spec, "Playing through time", if a default changes.
5. **Width**: by the number of births and marriages on a line, in four steps 1, 2–3, 4–7, 8+ (planned), or by the number of Persons?
6. **Colour over time**: kind as the colour and age as its strength, over 10 and 30 years (planned), or colour by century, so that a line's colour says when it was made? Changes the spec, "Line colour shows kind and age".
7. **The stable cadastre in the app**: (a) the Owner asks ÚAZK whether Rodokmen may show its joined imperial imprint layer (planned, as an `owner-action` issue); (b) buy scans of the family's sheets at 25 Kč each and georeference them for our own overlay, which the publishing terms allow but which needs a georeferencing step and tile storage; or (c) the viewer beside the map only, for good?
8. **Small moves**: every position change needs a Citation (planned), or a move within the same building plot is fact-free, as #157 made a Citation's note? Changes the spec, "A House position is a fact with evidence".
9. **Confidence**: normal when the house number is on the indication sketch or another Source names the plot, low when placed by its neighbours (planned). Is that how the family wants to use it?
10. **Places on their Municipality's point**: a separate backlog item to move a Place's point the same way, with a Citation (planned: yes, a new issue)?
