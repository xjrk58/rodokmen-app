# Proposal

## Why

A Member opening a person page wants to know first how that Person is related to them: "your great-grandfather", "your second cousin", "your brother-in-law". Today the app says only whether someone is a Relative, a Possible relative or an Unrelated person, which is the relation to the family as a whole, not to the reader. Working the kinship out by hand through six generations is slow and error-prone, and in villages that intermarried two Persons are often related in more than one way. The Owner asked: "We should display degree of relative", and decided that it is shown relative to the signed-in Member's own Person.

## What Changes

- **Kinship to the reader's own Person**: wherever the app shows a Person to a Member whose account is linked to their own Person, it says how that Person is related to them. The reference is always the Member's own Person. The Focus Person and the Family roots are not references in this change.
- **What is shown**:
  - the **kinship term** in the reader's Interface language, chosen by the Person's sex with its grammatical gender: Czech otec, děd, praděd, strýc, teta, prastrýc, bratranec, sestřenice, "z 2. kolena", synovec, neteř, and through a partner tchán, tchyně, zeť, snacha, švagr, švagrová; English father, great-grandfather, uncle, first cousin once removed, brother-in-law. German and Slovak follow `add-interface-languages`;
  - the **line and degree** as Czech law counts them: the number of births between the two Persons in the direct or the collateral line (civil code § 771), and for in-laws the line and degree of the relative they married into (§ 772);
  - half, step, adoptive and foster kinship, as far as the Tree's Family links record them.
- **Several paths**: when two Persons are related in more than one way (pedigree collapse, or a cousin who is also a brother-in-law), the closest is shown with the number of others, and the person page lists every path with its common ancestors and each step.
- **Evidence**: a path through a link with no Citation of normal or higher confidence is shown as "possibly", in the same way as a Possible relative.
- **Where it appears**: the person page (a "How you are related" section with all paths), search results, the tree (the focus Person's kinship in a strip above the tree), Chart cards on screen once `add-tree-charts` (#126) is built, and a new MCP tool that returns kinship as data.
- **No own Person yet**: a Member whose account is not linked sees a prompt instead. They can press "This is me" on their own person page, which asks the Owner to link it. The Owner confirms or refuses in Settings, or links the account directly as today. Only the Owner sets the link.
- **Fixed rules**: kinship is computed on the server by a pure function in `shared/` from the Family links: nearest common ancestors along the shortest paths, a total and stable order, and no AI model. The rules that decide degree, line, order, evidence and term are proved with LemmaScript (ADR 0009) and traced in `docs/verification.md`. The terms of each language are checked against golden files.
- **Performance**: the server keeps one in-memory copy of the Tree's Family links per state of the Tree and answers from it. The aim is a Tree of about 5,000 Persons, with a fixed bound on the work done for one request.
- **Privacy**: kinship is derived from Family links that every Member and Agent already reads, so it reveals nothing new about Living people. It is computed from the caller's own Person only, never reveals which Person another Member is, and stays out of Exports and printed Sheets.

Out of scope:

- Kinship relative to the Focus Person, a Family root or any Person other than the reader's own. The API can take another starting Person for Agents, so a later change can offer it in the app without changing the API.
- Kinship on a printed or downloaded Sheet (`add-tree-charts`), in an Export, or for visitors who are not signed in.
- A coefficient of relationship (the share of DNA expected), DNA matches, and "double cousin" as a term of its own. The count of paths says that instead.
- Members linking their own account without the Owner, and linking an account to more than one Person.
- Older or regional Czech words (ujec, strýna, ujčina) beyond the planned list, unless the Owner asks for them (design.md, "Open Questions").
- Changing the relation to the family (Relative, Possible relative, Unrelated person) or the glossary's definition of a Relative.

## Capabilities

### New Capabilities

- `kinship`: how one Person is related to another: the paths of Family links between them, the closest and the others, the kinship term in each Interface language, the line and degree as Czech law counts them, half, step, adoptive and foster kinship, kinship by marriage, the evidence behind a path, fixed rules and limits, the API, and what kinship may reveal.

### Modified Capabilities

Main specs are empty because no change touching these capabilities is archived yet, so these deltas add requirements, as `add-tree-charts` and `add-research-leads` did.

- `family-view` (from `add-family-view`): kinship on the person page, with every path and the prompt for a Member with no own Person; kinship in search results.
- `family-tree` (from `add-family-view`): the focus Person's kinship in the tree; a Member asking the Owner to link their own Person.
- `agent-access` (from `add-agent-access`): an MCP tool that returns the kinship of two Persons as data.
- `tree-charts` (from `add-tree-charts`): kinship on Chart cards on screen, never on a Sheet.

## Impact

- **Shared**: new pure rules in `shared/src/kinship.ts` (paths, common ancestors, closest path, degree, line, evidence, order) and term rules per language in `shared/src/kinship-terms/` (Czech and English now; Slovak and German with #113), with Zod schemas in `shared/src/schemas/kinship.ts`. The proofs reuse `isStrongLink` from `shared/src/relation.ts`.
- **Server**: `server/src/tree/kinship.ts` gathers the Family links with their link types, the Persons' sex and the marriage Events (extending `familyLinks()` of `server/src/tree/relation.ts`), keeps them in memory per state of the Tree, and calls the pure rules. New route `GET /api/persons/{id}/kinship` (action `read`). A short form on the Person summaries of search, the person page and the hourglass for a Member with an own Person. Link requests: `PUT` and `DELETE /api/me/person-request`, `DELETE /api/members/{id}/person-request`, the request in `me` and in the Owner's list of Members. `server/openapi.json`.
- **Database**: one migration adds the requested Person and its time to `account`. Nothing about kinship is stored.
- **MCP server**: one new tool, `get_kinship`.
- **App**: `app/src/kinship.js` (the one module that reads kinship from the API, as `relation.js` does for the relation), a section on the person page with the list of paths, the term in search results, a strip above the tree, "This is me" and the Owner's confirmation in Settings, Chart cards once #126 is built, and new i18n keys in every Interface language. Cached for offline reading with the records they belong to.
- **Fixture Tree**: invented second cousins who married, double first cousins, a half-sibling, a stepchild, a foster child and a weak link, so that each case has a test.
- **Checks**: golden term tables per language (`shared/test/golden/kinship/`), a deterministic generated Tree of 5,000 invented Persons for the work bound, an ESLint block that keeps the clock, randomness and `localeCompare` out of the kinship modules, and Playwright tests at 390 px and desktop size under the app's Content-Security-Policy.
- **Docs**: GLOSSARY.md (Kinship, Degree of kinship), an explanation page, a how-to guide, a reference page of the terms and degrees, `docs/reference/api.md`, `docs/reference/mcp-tools.md`, `docs/reference/roles-and-actions.md`, `docs/how-to/mark-family-roots.md`, `docs/explanation/privacy.md`, `docs/explanation/relation-to-the-family.md`, `docs/explanation/proofs.md`, README.md and the regenerated `docs/verification.md`.
- **Depends on**: `add-family-view` (built: person page, search, tree, the Member's own Person, cache). Kinship on Chart cards waits for `add-tree-charts` (#126). Slovak and German terms come with `add-interface-languages` (#113) and its native review. The Living rule (#58, 125 years) changes nothing here: kinship is shown where Members already see the Person, and never where Living people are reduced.
