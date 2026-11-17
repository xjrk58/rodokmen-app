# Design

## Context

See proposal.md for why. What the change builds on:

- **The relation to the family** (`add-vault-import`, built under #15). `relationLevels` in `shared/src/relation.ts` is proved. `familyLinks()` in `server/src/tree/relation.ts` gathers every Family link with the confidences of its Citations: a partner link between the two partners of a Family (Citations of the Events where both have the Role `partner`), and a parent link between each partner and each child (Citations of the Events where the child has the Role `child` and the parent `father` or `mother`). `isStrongLink` decides whether a link is confirmed. The server recomputes `person.relation` at the end of every accepted change.
- **The Tree's records**. `family` has `partner1_id` and `partner2_id`. `family_child` has `link_type` `birth`, `adoptive`, `foster` or `step`. `person.sex` is `female`, `male` or `unknown`. Roles at Events never link anyone.
- **The Member's own Person** (`add-family-view`). `account.person_id` is set by the Owner only (`PUT /api/members/:id/person`), shown as `me.person` to that Member alone, and never part of an Export. Agents have no Person.
- **The app** has no build step and no TypeScript, and imports nothing from `shared/` at runtime. It caches the records it has loaded in IndexedDB (`app/src/cache.js`, at most 400), and reads the relation in one module, `app/src/relation.js`. The person page, search and the hourglass get Persons as `PersonSummary`. A tree box is 88 by 50 px.
- **Interface languages** (`add-interface-languages`, #113). Every API response keeps every language (`Sentence = Record<UiLanguage, string>`), Slovak and German are offered only after a native review of the tables and snapshot files, and `UiLanguage` is `cs` and `en` until then.
- **Tree charts** (`add-tree-charts`, #126, planned). Charts select on the server and draw in the app, keep a screen and a Sheet variant of the model, check determinism with an ESLint block and golden files, and hand Agents the model through MCP.
- **The server** runs in 512 MB per slot, two slots during a deploy (#39).

## Goals / Non-Goals

**Goals:**

- The first path shown is the closest the Tree records, by proof, and the terms are ones a Czech genealogist accepts.
- One answer for the app and for Agents, with everything both need in it.
- A request on a Tree of about 5,000 Persons does a bounded amount of work, however much the villages intermarried.

**Non-Goals:**

- Storing kinship. It is derived on each request, so it cannot go stale.
- Computing kinship in the app.
- Proving the spelling of words. The choice of word is proved, and the spelling is checked by golden files.

## Decisions

### Computed on the server from a copy of the Family links kept in memory

Kinship is computed on the server by pure functions in `shared/`, from an in-memory copy of the Tree's Family links.

- **The link copy** (`server/src/tree/kinship.ts`): the Persons (id, sex), the Families (partners, and whether a marriage Event of both is recorded), the child links (Family, child, link type, the confidences of each parent link) and the partner links (confidences). `familyLinks()` gains the link type and the record ids it already has; one more query reads sex and the marriage flag. Everything is sorted by id when the link copy is built, so the search visits links in a fixed order.
- **Keyed by the state of the Tree**: the id of the newest `log_entry`, which every accepted change writes (a Proposal, a direct change, a merge, an undo, a Family root). A request reads that id with one indexed query. If it changed, the link copy is rebuilt once, and requests that arrive meanwhile wait for the same rebuild. Each server slot keeps its own copy.
- **Size**: for 5,000 Persons, about 2,000 Families and 5,000 child links, a few MB in plain arrays, well inside 512 MB.

Alternatives considered:

- **In the app, from cached data.** The cache holds only what the Member viewed, so the answer would depend on what happened to be cached. The app cannot run `shared/`, so the rules could not be proved, and Agents would get another answer.
- **Stored per Member and Person**, recomputed on every change. 5,000 rows per Member, recomputed for everyone after every accepted Proposal, to answer a question that takes milliseconds.
- **Recursive SQL per request** (ADR 0005 uses it for ancestors). Listing paths that meet only at their common ancestors, and ordering them totally, is awkward in SQL and cannot be proved.

### The Kinship model

`shared/src/schemas/kinship.ts`, in `server/openapi.json`:

- `from`, `to`: the two Persons. `asOf`: the id and time of the newest log entry the answer was computed from.
- `paths`: every path, in order, the closest first. Each has:
  - `kind`: `self`, `partner`, `birth` (adoption included), `marriage`, `stepSibling`, `coParentInLaw` or `foster`;
  - `line` (`direct`, `collateral` or null) and `degree` (a number or null);
  - `up` and `down`: the generations from `from` up to the common ancestors, and from them down to `to` (of the part by birth, for kinship by marriage);
  - `half`, `adoptive`, `possible`;
  - `commonAncestors`: one Person, or the two partners of one Family, or none;
  - `steps`: from `from` to `to`, each with the next Person, the link (`parent`, `child` or `partner`), its link type, whether it is weak, and the id of the Family or child link;
  - `term`: `Record<UiLanguage, { text, gender }>`, gender being `m`, `f`, `n`, or null for a combined form such as "bratranec/sestřenice".
- `more`: true when a limit cut the search.
- `connection`: when there is no path, the shortest chain of any Family links and its number of partner links, or null when there is none.

The **short form** (`KinshipShort`: the first path's term, `possible`, `line`, `degree`, the number of other paths and whether there may be more) is a new optional field `kinship` of `PersonSummary`. It is filled only for a Member with an own Person, on `GET /api/persons`, `GET /api/persons/{id}` and `GET /api/persons/{id}/hourglass`. Old apps ignore it.

### Finding the paths

The rules live in `shared/src/kinship.ts`. For the reader R and the Person T:

1. **Up from each**: every chain of birth and adoptive child links up from R, and from T, to at most 12 generations, with each Person's shortest distance and the link it was first reached through.
2. **The closest path by birth**: a common ancestor A with the smallest distance from R plus distance from T. Its two shortest chains meet only at A, since a Person shared lower down would be a common ancestor with a smaller sum. This path is built first, from the shortest distances, so no limit can cut it.
3. **Every path by birth**: for each common ancestor A, each pair of chains from R and from T to A that share no Person but A. Two pairs that enter A and A's partner through children of the same Family are one path, with both partners as common ancestors. A pair that enters A through children of two of A's Families is **half**, with A alone. T as R's ancestor, or R as T's, is the direct line.
4. **By marriage**: for each Family in which R is a partner, with partner P, every path by birth from P to T, after the step from R to P. For each partner Q of T, every path by birth from R to Q, before the step from Q to T. A path that would name R's own child as a stepchild is dropped: the one from P that goes straight down through the Family of R and P. So is the one that would name R's own parent as a step-parent: the one that comes straight up to Q through a child of the Family of Q and T.
5. **Two named shapes with a partner link in the middle**: a step-sibling (a child of a parent's partner, with no parent in common) and a co-parent-in-law, svat or svatka (a parent of a child's partner).
6. **Step and foster child links**: a child link of type `step` names the child a stepchild of each partner of the Family who is not their parent by birth or adoption. A `foster` link names the foster parent and child. Neither is followed further.
7. **Partners and self**: the partners of a Family, and R itself.
8. **Order and limits**: all paths are sorted with `compareKinshipPaths` (below) and the first 100 kept.
9. **Connection**: with no path at all, a breadth-first search over every Family link, of any type and in either direction, gives the shortest chain and its number of partner links.

**The work bound**: every step of a chain built counts one unit. A request stops listing at 200,000 units and sets `more`, and the closest path from step 2 is never cut. The short form for a list (search, hourglass) computes R's chains once per request and stops each target at 5,000 units, so a page of 50 results costs at most 50 short searches. The units, not the time, are what the tests assert, so they do not depend on the machine.

Alternatives considered: a bidirectional breadth-first search over all Family links finds the shortest chain, but not the nearest common ancestors, so it says nothing about half, the line or the degree. A coefficient of relationship was left out (proposal, "Out of scope").

### Degree and line, as Czech law counts them

`kinshipDegree` and `kinshipLine` in `shared/src/kinship.ts`:

- **By birth** (civil code §§ 771 to 773): the direct line when `up` or `down` is 0, else collateral. The degree is `up + down`, the number of births, one per child link. An adoptive link counts as a birth: Czech law gives adoption the effect of kinship. The docs task cites the section after checking the current text of the civil code.
- **By marriage** (§ 774): the line and degree of the part by birth, the kin married into.
- **None** for `self`, `partner`, `stepSibling`, `coParentInLaw` and `foster`, and for a connection.

German law counts degrees the same way (BGB § 1589). English-speaking readers know another count, so the English and German texts say "degree (Czech law)", and the reference page explains it. The degree is shown in every language because the Owner asked for the degree as Czech law has it.

### Terms: chosen by proved rules, spelled from tables

Terms are rules of a language, not labels: "pra" per generation, "z n. kolena", "n-th cousin m times removed", neutral forms. The app cannot run `shared/`, and the API keeps every language. So the server writes each term in every Interface language, as it writes the `Sentence`s of `add-interface-languages`, in two steps:

1. **Selection** (proved): `termCs(path)` and `termEn(path)` in `shared/src/kinship-terms/cs.ts` and `en.ts` return a structured term: a word from a closed list, the number of "pra" or "great", the "koleno" or cousin number, the removes, the qualifiers, and the grammatical gender.
2. **Spelling** (golden files): the word forms by sex, and the joins. The terms are a `Record<UiLanguage, KinshipTerms>`, so TypeScript refuses a missing language. Slovak (`sk.ts`) and German (`de.ts`) come with #113 as drafts for its native reviewer, after the reviewer confirms the terms table.

Czech, with `a` = `up` and `b` = `down`, and the forms for male, female and sex not recorded:

| Kinship | Term |
|---|---|
| direct, up | a = 1 otec, matka, rodič; a = 2 děd, babička, prarodič; then "pra" × (a − 2) before děd, babička, prarodič, up to 3 times; beyond that "předek v a. pokolení" (předkyně) |
| direct, down | b = 1 syn, dcera, dítě; b = 2 vnuk, vnučka, vnouče; then "pra" × (b − 2), up to 3 times; beyond that "potomek v b. pokolení" |
| a = b = 1 | bratr, sestra, sourozenec |
| a > b ≥ 1 | "pra" × (a − b − 1) + strýc, teta, strýc/teta, with "z b. kolena" when b ≥ 2 |
| b > a ≥ 1 | "pra" × (b − a − 1) + synovec, neteř, synovec/neteř, with "z a. kolena" when a ≥ 2 |
| a = b ≥ 2 | bratranec, sestřenice, bratranec/sestřenice, with "z (a − 1). kolena" when a ≥ 3 |
| more than 3 "pra" in the collateral line | příbuzný, příbuzná (the line and degree beside it say the rest) |
| half | polorodý, polorodá before the term |
| adoptive | one adoptive link alone: adoptivní otec, matka, syn, dcera; otherwise the term with "(přes osvojení)" |
| partner | manžel, manželka with a recorded marriage; partner, partnerka without |
| a partner's kin | parent: tchán, tchyně; sibling: švagr, švagrová; child: nevlastní syn, dcera, dítě; otherwise sešvagřený, sešvagřená |
| the partner of the reader's kin | child's: zeť, snacha; sibling's: švagr, švagrová; parent's: nevlastní otec, matka; grandparent's: nevlastní děd, babička; uncle's or aunt's: přiženěný strýc, přivdaná teta; otherwise sešvagřený, sešvagřená |
| step-sibling | nevlastní bratr, sestra, sourozenec |
| co-parent-in-law | svat, svatka |
| foster | pěstoun, pěstounka; svěřený syn, svěřená dcera, svěřené dítě |

English:

| Kinship | Term |
|---|---|
| direct | father, mother, parent; grandfather, grandmother, grandparent; then "great-", "great-great-", and from 3 greats "3rd great-"; the same for son, daughter, child and grandson, granddaughter, grandchild |
| a = b = 1 | brother, sister, sibling |
| min(a, b) = 1 | uncle, aunt, "aunt or uncle" when T is older; nephew, niece, "niece or nephew" when younger; with d − 1 greats, as above, d being the difference between a and b |
| min(a, b) ≥ 2 | "first", "second" … cousin (min − 1), and "once removed", "twice removed", "n times removed" for the difference between a and b |
| half | "half-" before one word, "half " before a cousin term |
| adoptive | adoptive father, mother, parent; adopted son, daughter, child; otherwise the term with "(through adoption)" |
| partner | husband, wife, spouse with a recorded marriage; partner without |
| by marriage | father-, mother-, parent-in-law; brother-, sister-, sibling-in-law; son-, daughter-, child-in-law; stepfather, stepmother, step-parent; stepson, stepdaughter, stepchild; step-grandfather, step-grandmother; uncle, aunt by marriage; otherwise "related by marriage" |
| step-sibling, co-parent-in-law, foster | stepbrother, stepsister, step-sibling; co-father-in-law, co-mother-in-law; foster father, mother, parent; foster son, daughter, child |

"Possibly" is not part of the term. The path's `possible` flag makes the app write it through an i18n key ("možná {term}", "possibly {term}"), with the "?" mark of a Possible relative. A Person's own page says "To jste vy" ("This is you").

The terms are always nominative and stand alone, under a heading such as "Jak jste příbuzní" ("How you are related"). The steps of a path use the colon form of `add-interface-languages` ("otec: Petr Novák"), so no name or term is ever declined.

Alternatives considered: i18n keys in the app per word, with the rules in app JavaScript. The rules would be unproved, Agents would get no terms, and the app would need the rules once per language anyway. The words and rules stay in one place, on the server.

### Evidence

Each link on a path carries its confidences. `isPossiblePath` is true when one of them is not strong (`isStrongLink`), the partner step of kinship by marriage included. This is the rule of the Possible relative, applied to one path. The closest path is chosen by degree first, and evidence only breaks ties: the closest path comes first even when it is only "possibly" (the Owner, 2026-11-14, Open Questions 1).

### Order

`compareKinshipPaths` in `shared/src/kinship.ts`: `self`, then `partner`; then by degree, lowest first, kinship by birth before kinship by marriage at the same degree; then confirmed before possible; then the kinds with no degree (step-sibling, co-parent-in-law, foster); then by `up`; then by the ids of the Persons along the steps, compared by code units, the shorter first. It is total, so no two paths tie.

### Where it is shown

- **Person page**: a section "Jak jste příbuzní" ("How you are related") under the name. It holds the term (with "možná" and the "?" mark when possible), the line and degree ("linie přímá, 3. stupeň"; "švagrovství, linie vedlejší, 2. stupeň"), the common ancestors with links, and "a 2 další cesty" ("and 2 more paths"), which opens the list. The page asks `GET /api/persons/{id}/kinship` alongside the Person and caches the answer as `kinship:<id>`, so it shows offline with the page's "as of".
- **Search results and the people list**: the term after the life years, one line, cut with an ellipsis, in full in the accessible name.
- **The tree**: a strip above the tree with the Focus Person's term, line and degree, which opens the person page at the section. Each box's accessible name gains the term. The boxes show no visible line and keep their size (the Owner, 2026-11-14, Open Questions 7).
- **Charts** (once #126 is built): a switch "Příbuzenství ke mně" ("Kinship to me") on the Chart screen, off by default and remembered on the device. With it on, the app asks for the screen variant with `kinship=1`, its Persons carry the short form, and each card shows the term on one line. The option is new on both Chart routes, is refused with `sheet` (400), and adds nothing for a caller with no own Person. It stays out of the Chart's address, because the switch belongs to the device and the terms to the reader, so a shared link opens the same Chart with each Member's own kinship. `get_chart` never sends it, so an Agent's model stays what `add-tree-charts` says. Offline, a Chart shows kinship only if it was cached with it. The Sheet variant's schema has no kinship field, and the SVG builder refuses a model with one, as it refuses an unreduced model.
- **The Member's own Person** reads "vy" ("you") in lists and in the tree.
- **No own Person**: the section shows the prompt, with "Toto jsem já" ("This is me") for a Member, or a link to Settings for the Owner. Lists and the tree show nothing.

### Linking: the Owner keeps the link, a Member can ask

Today only the Owner links an account to a Person. The options:

- (a) Only a prompt, telling the Member to ask the Owner outside the app.
- (b) The Member asks in the app with "This is me", and the Owner confirms or refuses. **Chosen.**
- (c) The Member links their own account.

(c) was rejected because the Owner knows the family and a wrong link would make every kinship wrong. (a) works, but the Owner then has to find the Person the Member means. (b) costs two columns and three routes:

- `account.person_request_id` (references `person`, set null on delete) and `account.person_request_at`. Accounts are never part of an Export.
- `PUT /api/me/person-request` with `personId` (action `ownAccount`; 409 when already linked, 404 for an unknown Person, and a new request replaces the old one), and `DELETE /api/me/person-request`. `me.personRequest` holds the Person's summary and the time.
- The Owner sees each request in the list of Members (`GET /api/members`), and a count on the Settings tab. Confirming is the existing `PUT /api/members/:id/person` with that Person, which clears the request. Refusing is `DELETE /api/members/:id/person-request` (action `manageAccounts`).
- A request for a Person who is later merged follows the kept Person, as the link does.
- `mayDo` needs no change: Agents are refused `ownAccount` already.

### The API and the MCP tool

- `GET /api/persons/{id}/kinship`, action `read`. `from` defaults to the caller's own Person. `?from=<personId>` names another, and an Agent must name one. The answer is 422 (`no-own-person`) when there is no own Person and no `from`, 404 for an unknown Person, and 308 for a merged one, as on the other Person routes. The app never sends `from` in this change, so a later change can offer the Focus Person without a new route.
- The route never takes a Member or account id, so no answer can tell which Person another Member is.
- MCP: `get_kinship` with `fromPersonId` and `toPersonId`, which calls the route and passes the JSON through. It counts as one read request. The server's instructions say to name both Persons.

### Determinism and the tools that keep it

- Ids are compared by code units, never with `localeCompare`. Names never decide anything. Terms come from tables, not from `Intl`.
- The ESLint block of `add-tree-charts`, which forbids `Math.random`, the clock, `localeCompare`, `toLocale*String` and `Intl.*` in the Chart modules, also covers `shared/src/kinship*.ts` and `shared/src/kinship-terms/`. Whichever change is built first writes the block.
- A test gives the same link copy shuffled and expects the same answer.
- On small invented trees (seeded, up to 30 Persons), a naive search over every chain must find the same set of paths as `kinshipPaths`. This is the test of completeness, which is not proved.
- Golden files: `shared/test/golden/kinship/<lang>.txt` lists every combination of `up` and `down` up to 8, each sex, half, adoptive, and each shape by marriage, with its term. Server golden files hold the fixture Tree's answers, with a fixed clock. They change only with `UPDATE_GOLDEN=1`, so a change shows in the PR's diff, and the native reviewer of #113 reads the Slovak and German ones.

### Privacy

Every Member already sees the whole Tree, Living people included, and Agents read it too. Kinship is derived from Family links that are already shown, so it reveals nothing about a Living person that the reader could not see. An Export keeps a Living person's relationships, so even an Export would reveal nothing new, but no Export or Sheet carries kinship. The protection that is new is the Member's own Person: it is used only for that Member's own requests, and it is never in an answer to anyone else. The request to be linked is seen by the Member and the Owner only. Kinship follows the Living rule wherever Persons are shown or reduced, so #58, which kept the Living rule at 100 years, and #59 change nothing here.

### Rules proved with LemmaScript

Each rule is a pure function proved with `lsc check`, naming its requirement with `//@ contract`. Gathering the link copy, the cache, the routes and the app are the unverified shell, and tests cover them.

- **Degree and line** (`kinshipDegree`, `kinshipLine`, `shared/src/kinship.ts`; kinship "Line and degree of kinship by birth" and "Line and degree of kinship by marriage"). Proved: direct exactly when `up` or `down` is 0; the degree is `up + down`, equal to the number of child links on the part by birth; kinship by marriage takes the degree of its part by birth; null exactly for `self`, `partner`, `stepSibling`, `coParentInLaw` and `foster`. The ensures state the scenarios (3, 2, 3, 4 and 5; brother-in-law 2; daughter-in-law 1).
- **Chains up** (`chainsUp`, `shared/src/kinship.ts`; kinship "Kinship is computed from Family links"). Proved in the manner of `reachFrom`: the start is at distance 0; within 12 generations, every followed parent of a Person at distance d is at distance d + 1 at most; every distance is realised by a chain of followed links, its `order` falling at each step; only birth and adoptive links are followed. The input holds Family links only, so no Role can relate anyone.
- **Closest path** (`closestPath`, `shared/src/kinship.ts`; kinship "Paths in a fixed order"). Proved: its degree is at most the sum of the two distances to every common ancestor within the limits, and its chains meet only at its common ancestors. A hand-written lemma states that a common ancestor with the smallest sum has shortest chains that meet only there.
- **Order** (`compareKinshipPaths`, `shared/src/kinship.ts`; kinship "Paths in a fixed order"). Proved: antisymmetric, 0 only for the same path, and transitive.
- **Evidence** (`isPossiblePath`, `shared/src/kinship.ts`; kinship "Kinship follows the evidence"). Proved: true exactly when a link of the path has no Citation of normal or higher confidence, through the proved `isStrongLink`; a confirming Citation on every weak link makes it false.
- **Half and own lines** (`isHalf`, `namesOwnParentOrChild`, `shared/src/kinship.ts`; kinship "Half, step, adoptive and foster kinship"). Proved: half exactly when the common ancestor is one Person reached through two different Families; no path by marriage or step names the reader's parent or child by birth or adoption through the same Family; foster and step links are never followed beyond their own pair.
- **Terms** (`termCs`, `termEn`, `shared/src/kinship-terms/cs.ts` and `en.ts`; kinship "Kinship terms by birth", "Kinship terms by marriage", and "Half, step, adoptive and foster kinship"). Proved: for every `up` and `down` within the limits, the word, the number of "pra" or "great", the "koleno" or cousin number and the removes follow the tables above; the gender follows the sex; the qualifiers appear exactly when the path's flags say so. Spelling the words is the shell, checked by golden files. If LemmaScript proves string joins reliably, the spelling joins the proof.
- **Connection** (`connectionChain`, `shared/src/kinship.ts`; kinship "Limits of the kinship search"). Proved: the chain is made of real Family links from one Person to the other, and is empty exactly when no chain exists. That it is the shortest is tested.

Not proved: that `kinshipPaths` lists every path within the limits (the naive-search test covers it), the server's gathering and its cache key, and the app's display.

## Implementation notes

Recorded when the change was built (PR #176), where the code differs from the text above:

- **The answer** also holds `persons` (the summaries of everyone its paths name, as the tree shows them), and each step a `term`: the next Person as the one before names them (otec, syn, manželka), so the app writes the steps without rules of its own. The short form also holds the path's `kind`, so the reader's own Person reads "vy". The Owner's `me` holds `openPersonRequests`, the count on the Settings tab.
- **The error code** is `no_own_person`, in the API's snake_case like its other codes.
- **The work bound**: the paths of the closest degree are always listed whole, up to the 200,000 units of a full answer, also for a Person in a list; the 5,000 units of the short form apply after that degree. So the short form always names the first path of the full answer, and one Person of a list can cost up to 200,000 units on an adversarial pedigree. A search also stops once whole degrees hold 100 paths.
- **Couples**: a Family with one known partner is a couple of its own, so children of two such Families are half-siblings. Paths through the same Persons by other links are one path, the confirmed one kept.
- **Evidence**: `isStrongLink` got a contract over its parameter alone, which proves, so `isPossiblePath` calls it across files and the shell passes no strong flags.
- **Civil code**: kinship § 771, lines § 772, degree § 773, kinship by marriage § 774 (zákon č. 89/2012 Sb. as in force in 2026).
- **Determinism**: the ESLint block is written by this change and covers `shared/src/kinship*.ts` and `shared/src/kinship-terms/`; `add-tree-charts` adds its modules to it.

Recorded when group 8 was built (PR #181, once `add-tree-charts` was merged):

- **The Sheet schema** is a variant of the Chart model. `DescendantChart` and `HouseChart` are each a screen variant (`sheet: null`, cards `ScreenChartPerson` with an optional `kinship`) or a Sheet's (cards `ChartPerson`, strict, with no kinship field), told apart by `sheet`. Their JSON is otherwise unchanged.
- **A proved rule** decides when cards carry kinship: `chartShowsKinship` in `shared/src/chart-kinship.ts` (tree-charts "Kinship on Chart cards"). The design listed none for Charts.
- **The Sheet writer** refuses a model with kinship, and the screen variant, in print as well as in the SVG and PNG files; before, only the files refused the screen variant.
- **On the cards** the term is on the line at the foot, before the marks, and after the life years on a sibling card of the line form. The children lists of the line form and the House chart are lists of names, and show none.
- **Offline**, the device keeps the kinship variant under the reader's own Person. When the variant asked for cannot be loaded, the other one kept is shown without kinship, and with kinship switched on the Chart says so.
- **The work bound**: past the closest degree, a short form can cost more than 5,000 units, up to 7,750 on the dense generated Tree, because the chains built to check the next degree come on top. Search does the same. A Chart of 454 cards with kinship takes about 0.5 s on that Tree. Both are filed as #182 for the Owner to decide.

## Risks / Trade-offs

- [Czech usage differs by region and age ("koleno", ujec, strýna)] → One table per language, in the reference page. The Owner chose the modern strýc and teta on both sides, "z n. kolena", and "pra" up to three times (Open Questions 2 to 4).
- [Pedigree collapse makes paths explode] → The work bound, the limit of 100 paths, and the closest path computed apart from the listing.
- [Many links have no Citation yet, so much kinship reads "possibly"] → The same rule as the Possible relative. The mark is small, and it goes as soon as the evidence is added.
- [A Family with no recorded marriage] → Its partners are named partner, not husband or wife, but its in-laws are named and counted as by marriage. In the registers a missing marriage is usually a gap in the research, not a couple who never married. The reference page says so.
- [A `step` child link does not say which partner is the birth parent] → A birth or adoptive link elsewhere wins. Otherwise it is read as recorded, and the hourglass shows the same data for an Editor to correct.
- [The same couple recorded as two Families] → Counted as one couple for half and full, so their children are not called half-siblings. The merge tool fixes the data.
- [The cache key misses a change] → A test makes each kind of change (Proposal, direct change, merge, undo, Family root) and expects a new key. `add-exports-and-erasure` must make erasure move it too, and its issue (#19) gets a comment.
- [Slovak and German drafts read wrong] → Not offered until the native review of #113.
- [English readers misread the degree] → "degree (Czech law)" and the reference page.
- [Long Czech terms on a phone ("praprababička", "bratranec z 3. kolena")] → They wrap on the person page and are cut with an ellipsis in lists, in full in the accessible name. Playwright checks that nothing overflows at 390 px.
- [Search gets slower] → One computation of the reader's chains per request and a per-target bound, measured on the generated Tree.

## Migration Plan

One migration (the next free number) adds `account.person_request_id` and `account.person_request_at`, both nullable. It works with the previous release still running, which never reads them. The new route and the new optional field of `PersonSummary` break no client. Rollback is a revert. The down migration drops the two columns, losing open requests but no link. Cached `kinship:<id>` records are ignored by an older app and age out.

## Open Questions

None are open. The Owner answered all nine on 2026-11-14, each as planned, so the specs and tasks stand as written:

1. **Closest path on weak evidence**: the closest path comes first even when it is only "possibly". Evidence only breaks ties at the same degree ("Paths in a fixed order").
2. **Uncles and aunts in Czech**: the modern strýc and teta on both sides. No ujec, strýna or ujčina.
3. **"Koleno"**: a parent's first cousin is "strýc z 2. kolena", a cousin's child "synovec z 2. kolena", and a second cousin "bratranec z 2. kolena".
4. **Long Czech terms**: "pra" written out up to three times (praprapraděd), then "předek v 6. pokolení".
5. **By marriage and by birth**: ranked together by degree, so a brother-in-law (2nd degree) comes before a third cousin (8th).
6. **Asking to be linked**: "This is me", confirmed by the Owner in Settings. A request sends no email; the Owner sees a count on the Settings tab.
7. **Tree boxes**: kinship in the strip above the tree and in each box's accessible name, with no visible line in the boxes, which keep their size.
8. **Charts**: kinship on Chart cards on screen behind a switch, off by default, and never on a Sheet.
9. **Step-siblings and svat or svatka**: named.
