# Tasks

## 1. Czech by default

- [ ] 1.1 Change the language choice in `app/src/i18n.js` to: the reader's stored choice, else Czech; verify the English-phone-first-visit scenario with Playwright `locale: en-US` and the choice-remembered scenario
- [ ] 1.2 Update the existing e2e tests that expect English for an `en-US` browser to set English explicitly; verify the whole app suite passes at both viewports
- [ ] 1.3 Once Members sign in in the app (`add-family-view`), use the account's language when no device choice is stored; verify the Member's-setting scenario

## Workflow follow-up

- If `add-map-core` is archived before this change, replace the language sentence of its "Czech and English interface" requirement with this rule when archiving.
