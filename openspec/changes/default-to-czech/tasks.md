# Tasks

## 1. Czech by default

- [x] 1.1 Change the language choice in `app/src/i18n.js` to: the reader's stored choice, else Czech; verify the English-phone-first-visit scenario with Playwright `locale: en-US` and the choice-remembered scenario
  - Note: `detectLanguage()` in `app/src/i18n.js`; both scenarios in `app/tests/e2e/i18n.spec.js` (also `de-DE` opens in Czech).
- [x] 1.2 Update the existing e2e tests that expect English for an `en-US` browser to set English explicitly; verify the whole app suite passes at both viewports
  - Note: the e2e fixture option `language` (default `'en'`) chooses English on the device before each test, as a reader would in Settings; tests of the default set it to `null`. `server/test/app-proposals.e2e.test.ts` does the same. The whole app suite passes at both viewports.
- [x] 1.3 Once Members sign in in the app (`add-family-view`), use the account's language when no device choice is stored; verify the Member's-setting scenario
  - Note: built with add-family-view in the same PR: the shell applies the account's language when no device choice is stored, and choosing a language in Settings sets both (`PATCH /api/me`). Verified in `app/tests/e2e/family-settings.spec.js` (the account's English on a Czech browser; a device choice wins) and against the real server (`server/test/passkeys.e2e.test.ts`, `server/test/family-view.e2e.test.ts`).

## Workflow follow-up

- If `add-map-core` is archived before this change, replace the language sentence of its "Czech and English interface" requirement with this rule when archiving.
