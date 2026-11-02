# Proposal

## Why

Relatives in neighbouring countries, such as Slovakia, Austria or Germany, may read neither Czech nor English well. The Owner decided (issue #65) to add Slovak and German interface languages next to Czech and English, so that these relatives can be invited, sign in and contribute in their own language. The research on the EU and UK ([Twenty-four interface languages matter less than record languages](../../../docs/research/eu-uk-expansion.md#twenty-four-interface-languages-matter-less-than-record-languages)) recommends adding interface languages one at a time, and keeping them apart from the languages records are written in.

## What Changes

- The app, its emails and the server's sentences come in four **Interface languages**: Czech (still the default), Slovak, German and English. The language switch, the account's language and the invitation's language offer all four, each named in its own language.
- Choosing a language works as today: the choice on the device, else a signed-in Member's account language, else Czech. The browser's language still does not decide it.
- Every interface text exists in all four languages. `pnpm check` fails on a key, placeholder or plural form missing in one language, and on a German or Slovak text that is still the English one, so no text stays untranslated. TypeScript refuses a server sentence or email missing a language.
- Counts read correctly in each language (one, few and other forms), and dates and numbers follow the language. This also fixes today's "1 Proposals" and "2 návrhů".
- Agents may write the German and Slovak drafts, but a native speaker reviews them. German and Slovak are offered to readers only after the review of every text in that language. Texts added later are listed as awaiting review until a native speaker has checked them.
- **BREAKING (API)**: every `Sentence` in the API (change summaries, record labels, the question and reason of suggested leads) gains `de` and `sk` next to `cs` and `en`. `UiLanguage` accepts `de` and `sk`. Old clients that read `cs` or `en` keep working.
- Record languages stay separate: a Name's language tag, Place names and archive names are not translated and do not depend on the interface language.

Out of scope:

- Polish or any further interface language. The design makes the next one a table, an email set and a review, but the Owner decides each language separately.
- Following the browser's language on a first visit (the Czech-by-default rule stays).
- Translating API error messages other than the two that are already in Czech and English (the evidence message and the invitation status). The others stay English, as they are for Czech readers today.
- Owner alert emails, which stay English.
- Regional variants (Austrian German, for example). German is standard German (`de`).
- Sorting of Tree and map data, which stays Czech, because the names are Czech.
- Scan reading's record languages and scripts (`add-scan-reading`) and country packs (`add-country-packs`).

## Capabilities

### New Capabilities
- `interface-languages`: the languages the app, its emails and the server's sentences come in; how a reader's language is chosen; that every text exists in every language and reads correctly with numbers and dates; that a language is offered only after a native speaker has reviewed it; and that the interface language never changes record languages.

### Modified Capabilities
- `member-accounts`: "Emails in the Member's language" says "Czech or English". A new requirement makes account and invitation languages the four Interface languages, and has invitations and sign-in emails written in all four.

Main specs are empty because no change is archived yet, so these deltas add requirements, as `default-to-czech` did. When this change is archived, it supersedes:

- `map-view` "Czech and English interface" (`add-map-core`) and "Czech by default" (`default-to-czech`), replaced by `interface-languages` "Four interface languages, Czech by default";
- `member-accounts` "Emails in the Member's language" (`add-tree-backend`), replaced by "Emails in every Interface language".

The notifications requirements already say "in the author's language" and need no change.

## Impact

- **App**: `app/i18n/` gains `sk.json` and `de.json` (about 575 keys today, about 645 once #103 is merged). `app/src/i18n.js` changes (language list, plural forms, locales, offered languages), and so do the language switches in `index.html`, `settings.js`, `settings-screen.js` and `sign-in-screen.js`, the date formats in `review.js`, the sentence language in `leads-screen.js`, the fatal message in `app.js`, the precache list in `precache.js` and the JSDoc types `'cs' | 'en'`.
- **Shared**: `UiLanguage` and `Sentence` (`shared/src/schemas/common.ts`, `review.ts`, `leads.ts`, and `reading.ts` after #103); the sentence builders in `proposal-summaries.ts`, `place-summaries.ts` and `summary-parts.ts`; `EVIDENCE_MESSAGE`.
- **Server**: a migration that widens the language checks of `account` and `invitation`; `proposals/labels.ts`, `views.ts`, `history.ts` and `service.ts`; `leads/suggestions.ts`; `auth/accounts.ts` (invitation messages); `mail/templates.ts` (invitation, sign-in link, outcome and digest emails); the CLI's `create-owner --language`; `server/openapi.json`.
- **MCP server**: no text of its own. It passes the API's JSON through, so Agents see the larger `Sentence`.
- **Checks and tools**: the i18n unit test, an ESLint rule against comparing a language to a literal, email snapshots in four languages, Playwright tests at phone and desktop size, a review script and record under `app/i18n/`, and a weekly workflow that opens an issue when texts await review.
- **Docs**: a reference page, a how-to guide and an explanation page for interface languages, GLOSSARY.md, `docs/reference/checks.md`, `docs/reference/api.md`, README.md, `docs/reference/cli.md`, `docs/reference/research-leads.md`, AGENTS.md and `openspec/config.yaml`.
- **People**: one native-speaker reviewer for Slovak and one for German, found by the Owner.
- **Depends on**: #103 (scan reading) should merge first, because it adds about 70 keys and a third copy of the `Sentence` schema (in `reading.ts`). Later changes (`add-country-packs`, `add-exports-and-erasure`, `add-scan-reading`'s follow-ups) then add their texts in four languages.
