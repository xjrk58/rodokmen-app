# Design

## Context

Today two languages are wired in at three layers, each in its own way:

- **App.** `app/i18n/cs.json` and `en.json` are flat key-to-text tables (about 575 keys each). `app/src/i18n.js` holds `LANGUAGES = ['cs', 'en']`, picks the device choice (`localStorage` `rodokmen.language`), else the account's language, else Czech, and fills `data-i18n` elements. `t()` only replaces `{name}` placeholders, so there are no plural forms. Most counts avoid them with a colon ("Koncepty k odeslání: 3"), but some read wrong: `batch.size` gives "1 Proposals" and "2 návrhů". The language switches are written out as two options in `index.html`, `settings-screen.js` (account and invitation) and `sign-in-screen.js`. `review.js` picks `cs-CZ` or `en-GB` with a ternary, and `leads-screen.js` maps every language other than Czech to English. `precache.js` lists both tables. `app.js` has a fatal message in both languages.
- **Shared and server.** `UiLanguage = z.enum(['cs', 'en'])` types accounts, invitations and email templates. The API returns sentences as `Sentence = { cs, en }`, defined twice (`review.ts`, `leads.ts`), with a third copy in #103 (`reading.ts`). They are built in both languages on every read (`describeOperations`, `labels.ts`, `views.ts`, `history.ts`, `leads/suggestions.ts`), and none is stored, except that an accepted suggested lead keeps the text in the accepting Member's language. Label tables are `Record<SummaryLanguage, …>`, so TypeScript already demands every language for them. The sentence builders do not: they branch on `cs ? czech : english`, and a third language would fall silently into English. `account.language` and `invitation.language` have a database check `in ('cs', 'en')`.
- **Emails.** `mail/templates.ts` has an `if (language === 'cs')` branch per template (invitation, sign-in link, outcome, digest), with file snapshots per language. Owner alerts are English only.
- **Records.** Name and Place-name language tags (`LanguageTag`, `NAME_LANGUAGES` in the app) are BCP 47 tags of the record. They are a separate list and stay so.
- **Checks.** `app/tests/unit/i18n.test.mjs` compares the two tables' keys and placeholders and checks that every used key exists. It runs in App CI, not in `pnpm check`.

The app is static JavaScript without a build step, and imports nothing from `shared/` at runtime.

## Goals / Non-Goals

**Goals:**
- Adding a language is one list entry plus tables that the tools demand, not a hunt through ternaries.
- No text can be missing or left in English in a language without a check failing.
- Engineering does not wait for the reviewer, and readers see a language only after the review.

**Non-Goals:**
- No translation library or message format beyond plural forms.
- No change to which language a reader gets when they have chosen none (Czech).
- No machine translation at runtime. Agents draft the translations once, in the repo.

## Decisions

### One language list, kept equal in the app by a check

`shared/src/schemas/common.ts` defines `UI_LANGUAGES = ['cs', 'sk', 'de', 'en']` and `UiLanguage = z.enum(UI_LANGUAGES)`. The app keeps its own `LANGUAGES` in `i18n.js`, because it cannot import `shared/` at runtime. The new i18n check (below) compares it with the `UiLanguage` enum in `server/openapi.json`, which the OpenAPI check keeps equal to the schema. Generating the app's list in a build step was rejected, because the app has no build step.

Each language is named in its own language (`Čeština`, `Slovenčina`, `Deutsch`, `English`) from one map in `i18n.js`, with a `lang` attribute. Every switch and picker (the map's Settings dialog, account Settings, the invitation form, the invitation screen) is drawn from the list, not written out. The order is Czech, Slovak, German, English.

### Supported and offered languages

All four languages are **supported** from the first implementation PR: the API, the database, the emails, the server's sentences and the app's tables. Only **offered** languages appear in the switches. `OFFERED` in `i18n.js` starts as `['cs', 'en']`, and a language is added to it by its release PR after the review (see "Native review"). The i18n check refuses an offered language other than Czech and English whose review record is not marked released.

A reviewer opens a language that is not offered yet with `?lang=sk` in the address. `app.js` stores it as the device choice and takes the parameter off the address. The switch then shows it as a preview, marked as one. This works on the public map preview (GitHub Pages) and on the server alike. The address sets only the device. A signed-in reviewer who then picks the previewed language in Settings also sets their account's language, as any choice there does, so their emails come in it too.

The gate sits in the app, not in the API. The reviewer's account, the email snapshots and the tests all need the language before release, and an account in Slovak harms no one.

Merging the whole change only after the review was rejected. It would hold up engineering on one person's free time, and the reviewer could not see the texts in place on the real app.

### Choosing a language

The order stays as today (`detectLanguage`): the device choice, else the account's language, else Czech. On the invitation screen, the invitation's language comes before Czech. Any supported language counts, offered or not, so a preview survives a reload. A stored value that is no longer supported is ignored. The browser's language still does not count.

There is no fallback between tables at runtime. The tables are complete by check, and the service worker caches one version's tables together. `t()` keeps showing the key for an unknown key, which the end-to-end tests would catch. API sentences are read as `sentence[lang] ?? sentence[FALLBACK[lang]]`, with Slovak falling back to Czech and German to English. This covers an app version that is newer than the server for a moment during a deploy.

### Plural forms

A text that needs a plural has one key per plural category, with `#` before the category: `batch.size#one`, `batch.size#few`, `batch.size#other`. `t('batch.size', { count })` picks the category with `Intl.PluralRules(locale)`, and falls back to `#other`. The `#` keeps these keys apart from keys that already end in `.other` with another meaning (`eventType.other`, `role.other`). The check demands, for each such key, exactly the categories that `Intl.PluralRules` gives for whole numbers 0–1000 in that language: one, few and other in Czech and Slovak, one and other in German and English. Czech's "many" applies only to fractions, which no text counts.

The colon form stays the first choice ("Koncepty k odeslání: {count}"). Plural keys are only for a number that reads before its noun. Today that is `batch.size`, and the implementer looks for others (`familyMap.pin`, `leads.searchCount`). The server uses the same rule through a small helper in `shared/` where an email needs it.

An ICU MessageFormat library was rejected. The app has no bundler, so the library would have to be vendored, and it would serve a handful of keys.

### Locales for dates and numbers

One map serves both the app (`i18n.js`, as `locale()`) and `shared/` (for emails): `cs → cs-CZ`, `sk → sk-SK`, `de → de-DE`, `en → en-GB`. `en-GB` keeps today's English dates. Every `Intl` call takes `locale()`: `review.js`'s `formatDate`, `screen-parts.js`, `settings-agents.js` and `formatKm`. Emails keep the `Europe/Prague` time zone. Sorting of Tree and map data stays Czech (`czechCollator`, the server's `'cs'`), because the names are Czech whatever the reader's language.

### The server's sentences: one `Sentence`, and one sentence set per language

`Sentence` is defined once in `common.ts` from `UI_LANGUAGES`, as `Record<UiLanguage, string>`. `review.ts`, `leads.ts` and (after #103) `reading.ts` import it. A helper `inEveryLanguage(lang => …)` builds one. It replaces the `{ cs: …, en: … }` pairs in `views.ts`, `history.ts`, `labels.ts` (`both`, `quoted`, `linked`, `within`) and `suggestions.ts`.

The sentence builders in `proposal-summaries.ts` and `place-summaries.ts` become one sentence set per language: `Record<UiLanguage, Sentences>`, where `Sentences` maps every operation type to a function. TypeScript then refuses a language or an operation type that is missing. One file per language under `shared/src/schemas/summaries/` keeps each language readable as a whole, for the translator and for the reviewer. `quote()` uses „…“ for Czech, Slovak and German and “…” for English. Names keep the colon form ("osobě: Jan Novák", "osobe: …"), so that names are never declined.

Every API response keeps every language. Answering only in the reader's language was rejected. Switching the language would then have to fetch every screen again, data cached for offline use would hold one language only, and Agents would see the account's language rather than all of them. The cost is about twice the text in review and history responses, which hold tens of Proposals, not thousands. The MCP server passes the JSON through unchanged.

An ESLint `no-restricted-syntax` rule in `app/src`, `shared/src` and `server/src` refuses comparing anything with `'cs'`, `'sk'`, `'de'` or `'en'` as a literal. Its message says to choose with a `Record<UiLanguage, …>`. Code that compares a record's language tag (the Vault importer, for example) disables the rule on that line, with a reason.

### Emails, invitation messages, the evidence message

Each template becomes `Record<UiLanguage, (e) => Body>` around the existing `render()`. `INVITATION_MESSAGES` and `EVIDENCE_MESSAGE` become `Record<UiLanguage, string>`. The digest formats days with the locale map. `emails.test.ts` loops over `UiLanguage.options`, so each email gets a text and an HTML snapshot in every language, and the reviewer reads those files. Owner alerts stay English.

### Database

One migration (the next free number) replaces the checks on `account.language` and `invitation.language` with the four languages. The default stays `'cs'`. The down migration refuses to run while any row uses `sk` or `de`, rather than changing someone's language without telling them. `create-owner --language` already parses with `UiLanguage`.

### Tools that catch missing and untranslated texts

A new `pnpm check` step, **i18n check** (`scripts/i18n-check.mjs`), takes over and extends the table checks of `i18n.test.mjs`. It runs in seconds and needs no browser:

- every language in `LANGUAGES` has a table, the tables have the same keys (plural keys compared by their base), and no text is empty;
- each text has the same placeholders as Czech, and each plural key has exactly its language's categories and uses `{count}`;
- a Slovak or German text that is the English text unchanged fails, unless its key is listed in `app/i18n/same.json` (names such as `app.name`, OpenStreetMap or a portal's name);
- every key the code and `index.html` use exists (moved from the unit test);
- `LANGUAGES` equals the OpenAPI `UiLanguage`, `precache.js` lists every table, and every offered language is released (see below).

TypeScript covers the server, through the `Record<UiLanguage, …>` types and the per-language sentence sets. ESLint covers comparisons with language literals. The email snapshots and a new snapshot of sample sentences cover wording. The sample sentences are invented operations rendered in every language, in `server/test/__snapshots__/sentences/<lang>.txt`.

### Native review

What is reviewed: the language's table, its sentence snapshot and its email snapshots. Czech is the source for placeholders and for the review, and the reviewer also sees English.

- **Terms first.** Before the full review, the reviewer confirms a short table of the GLOSSARY terms in their language: Member, Proposal, Draft, Tree, Person, Family root, Relative, Source, Citation, Family account, Research lead, Label, Parish, Estate, House (and the abbreviation for its number), Municipality. The Czech column is what the app says today (návrh, koncept, pramen, doklad, rodinné vyprávění, badatelská stopa, štítek, farnost, panství, čp., obec). The agent drafts the Slovak and German columns, for example Slovak návrh and prameň, German Vorschlag, Quelle and Pfarrei. All drafts are unconfirmed until the reviewer says so. The table lives in the reference page, and translations follow it.
- **Record.** `app/i18n/reviewed/<lang>.json` maps each reviewed key, and each snapshot file, to a short hash of the Czech text, the English text and the translation as reviewed, plus `released: true` once the language is offered. A text whose Czech, English or translation changed since then counts as awaiting review.
- **Script.** `scripts/i18n-review.mjs` has four commands. `status <lang>` lists what awaits review, and `--strict` makes it exit 1 when anything does. `sheet <lang>` writes a review sheet outside the repo: key, Czech, English and the draft, grouped by screen, followed by the sentence and email snapshots. `record <lang>` records the reviewed hashes after the reviewer's corrections are committed. `release <lang>` sets `released`, but only when `status --strict` passes.
- **Screenshots.** `pnpm --filter @rodokmen/app screens <lang>` uses Playwright to sign in to the invented fixture Tree, as the end-to-end tests do. It saves phone-size screenshots of the main screens in that language for the reviewer, outside the repo: map, place sheet, tree, person page, people, propose form, review, history, Research leads, Settings, sign-in and invitation.
- **After release.** New and changed texts ship with the agent's draft and are listed as awaiting review. CI writes `status` for every language into the job summary. A weekly workflow, modelled on `audit.yml` and `scripts/audit.mjs`, opens or updates one `owner-action` issue listing the texts that await review, and closes it when none do. The Owner sends a batch to the reviewer when it suits them.

Blocking every merge until a native review was rejected. It would stop all work whenever the reviewer is away. The Owner can still choose it (see Open Questions).

### Layout

German texts run about a third longer than Czech, and Slovak about as long. A Playwright test at the phone size opens the main screens in German and Slovak. It fails when a tab, button, chip or heading overflows its box (`scrollWidth > clientWidth`) or the page scrolls sideways. Where a German word does not fit, the translation gets a shorter word, agreed with the reviewer, rather than the layout getting smaller text.

### Rules proved with LemmaScript

None qualifies. The language choice is a three-way fallback in the app's JavaScript, and LemmaScript checks the TypeScript in `shared/`. Plural categories and formats come from `Intl` (CLDR), not from a rule of ours. The review gate compares hashes of files, which is I/O. Unit tests, the i18n check and Playwright cover them.

## Risks / Trade-offs

- [Agent translations sound wrong, or use the wrong word for a genealogy term] → terms are confirmed first, the reviewer reads everything before release, and later texts are listed until reviewed.
- [No reviewer is found for one language] → that language stays supported but not offered. Nothing else waits for it, and the other language can be released alone.
- [Every later change now writes four languages] → the agent drafts them, and the i18n check tells it exactly what is missing. The how-to guide shows the steps.
- [Longer German texts break the phone layout] → the overflow test at phone size, and shorter words where needed.
- [Bigger API responses and MCP results] → small in absolute terms. If it ever matters, a `?lang=` filter can come later without breaking clients.
- [The Owner's Czech sentences change in the refactor] → the sentence and email snapshots of Czech and English are written before the refactor and must stay byte for byte the same.
- [#103 or other open work adds Czech and English texts in the meantime] → the i18n check fails on the merge, which shows exactly which keys need Slovak and German.

## Migration Plan

1. #103 merges first.
2. The implementation PR (or a few) lands with Slovak and German supported but not offered. The migration widens the checks, and nothing changes for existing Members.
3. The reviewer confirms the terms, then reviews the sheet, the screenshots and the `?lang=` preview. The corrections are committed and recorded.
4. One release PR per language runs `release <lang>` and adds the language to `OFFERED`.

Rollback: taking a language out of `OFFERED` hides it from the switches, while accounts that use it keep working. The down migration runs only once no account or invitation uses Slovak or German.

## Open Questions

- Who reviews Slovak, and who reviews German? This is an `owner-action` and does not change the plan.
- Should German follow Austrian usage where it differs ("Jänner", some words)? The default is standard German with `de-DE` formats. A switch to `de-AT` formats is one entry in the locale map.
- After release, should a text that awaits review block the merge instead of being listed? The default is to list it. Blocking would make `status --strict` part of the i18n check for released languages, which is a one-line change to the check and to the requirement's last sentence.
- The order of the languages in the switch (default: Czech, Slovak, German, English).
