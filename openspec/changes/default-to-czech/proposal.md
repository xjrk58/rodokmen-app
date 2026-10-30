# Proposal

## Why

The family and the places are Czech, and most Members and visitors read Czech. Today the app follows the browser's language and falls back to English, so a relative whose phone is set to English, or a browser abroad, opens the map in English. The app should open in Czech unless the reader chooses otherwise.

## What Changes

- The app opens in Czech by default, whatever the browser's language.
- English stays one tap away in the language switch, and the reader's choice is remembered on the device as before.
- A signed-in Member's language setting, which already exists for emails, also sets the app's language on their devices.

Out of scope: a third language (German stays a later idea); translating place names (Places keep their own names and periods); email language, which already follows each Member's setting.

## Capabilities

### New Capabilities

### Modified Capabilities
- `map-view`: the default interface language becomes Czech instead of the browser's language.

`map-view` comes from `add-map-core`, which is not archived yet. This delta adds the new rule. When `add-map-core` is archived first, the language sentence of its "Czech and English interface" requirement must be replaced by this one.

## Impact

- `app/src/i18n.js` (language choice), the language switch, and the Playwright tests that assume English for an `en-US` browser.
- After `add-family-view`: the signed-in Member's language comes from their account.
