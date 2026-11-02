# Tasks

## 1. ESLint additions

- [x] 1.1 Add `no-restricted-syntax` rules (raw `request.url` in sign-in hooks, `z.url()` without `protocol`, `toISOString().slice(0, 10)` in the app) with messages naming the safe helper; verify each fires on a fixture file reproducing the original bug and that the repo passes
- [x] 1.2 Add `id-denylist` for identifiers the glossary rejects; verify it flags `town` in a fixture
  - The fixture's nine `proband` identifiers are recorded in `eslint-suppressions.json`; renaming them is #101.
- [x] 1.3 Add eslint-plugin-playwright (recommended, plus `no-wait-for-timeout`) for `app/tests/e2e` and server e2e tests; verify a fixed wait in a fixture fails and existing tests pass after fixes

## 2. New tools

- [x] 2.1 Add knip with workspace entries (app modules and service worker, server main and cli, shared index, scripts, tests); fix or configure every first-run finding; verify `pnpm knip` passes and an unused export added in a fixture fails
  - Pinned to knip 5.88.1, the last version that checks class members (v6 dropped them); the config is `knip.jsonc`, so each exception carries its reason. Exports used only in their own file are not reported (#101 asks whether they should be).
- [x] 2.2 Add dependency-cruiser with the boundary rules and `no-circular`; verify an import from `app/` into `server/` and from `server/src/auth` into `server/src/tree` each fail
  - Three existing cycles are recorded in `.dependency-cruiser-known-violations.json`, which only shrinks; breaking them is #101.
- [x] 2.3 Add jscpd with a 30-line minimum, excluding tests and generated files; verify a 40-line copy in a fixture fails and the repo passes
- [x] 2.4 Add `pnpm audit --audit-level=high --prod` to lint and a weekly scheduled run that opens an issue on failure; verify the scheduled run's issue path with a dry run
- [x] 2.5 Add gitleaks (pinned) to CI over the pushed commits; verify a fake token in a test commit on a branch fails the job
- [x] 2.6 Type-check `server/public/` scripts with `checkJs` and `noUncheckedIndexedAccess`; verify the L7 pattern (an unchecked language lookup) fails
  - Nothing to do here: `server/public/` is gone, since #48 moved signing in into the app, which tsc already checks with `checkJs`. `noUncheckedIndexedAccess` for the app reports 68 errors in 10 files and is #101.

## 3. One command

- [x] 3.1 Add `pnpm check` running all checks in a fixed order, and make the lint workflow call it; verify it passes locally and in CI on a clean branch
- [x] 3.2 Document the checks and how to fix each kind of finding in AGENTS.md ("Tools before agents"); verify the section lists every tool `pnpm check` runs

## Workflow follow-up

- Archive this change when merged; it has no specs to move.
