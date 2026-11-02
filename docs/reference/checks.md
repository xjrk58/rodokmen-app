# Code checks

The checks that `pnpm check` runs, and gitleaks, which CI runs beside it. How to fix what they report: [Fix a failed check](../how-to/fix-a-failed-check.md). The rules for when to use a tool rather than a review: [AGENTS.md](../../AGENTS.md#tools-before-agents).

## pnpm check

`scripts/check.mjs` runs the checks below in this order. Every check runs even after one fails, and the summary lists each one with its time. It exits 1 when any check failed. In GitHub Actions each check's output is a collapsed group, with an error annotation when it fails.

| Check              | Command                                        | Tool and version                                                   | Configuration                                                                            |
| ------------------ | ---------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| typecheck          | `pnpm typecheck`                               | TypeScript 7 (server/, shared/), 6 (app/)                          | each package's `tsconfig.json`; the app's three `tsconfig*.json`                         |
| ESLint             | `pnpm lint:js`                                 | ESLint 10.13.0, typescript-eslint, eslint-plugin-playwright 2.12.1 | `eslint.config.mjs`; known findings in `eslint-suppressions.json`                        |
| ShellCheck         | `pnpm lint:sh`                                 | ShellCheck 0.11.0 (Docker image)                                   | `scripts/shellcheck.mjs`                                                                 |
| docs check         | `pnpm lint:docs`                               | `scripts/docs-check.mjs`                                           | the index is `docs/README.md`                                                            |
| Prettier           | `pnpm format:check`                            | Prettier 3.9.10                                                    | `.prettierrc.json`, `.prettierignore`                                                    |
| knip               | `pnpm knip`                                    | knip 5.88.1                                                        | `knip.jsonc`                                                                             |
| dependency-cruiser | `pnpm depcruise`                               | dependency-cruiser 18.7.0                                          | `.dependency-cruiser.cjs`; known findings in `.dependency-cruiser-known-violations.json` |
| jscpd              | `pnpm jscpd`                                   | jscpd 5.4.2                                                        | `.jscpd.json`                                                                            |
| pnpm audit         | `node scripts/audit.mjs`                       | pnpm 10.28                                                         | in the script                                                                            |
| OpenAPI check      | `pnpm --filter @rodokmen/server openapi:check` | the server CLI                                                     | `server/openapi.json`                                                                    |
| trace check        | `node scripts/verification-trace.mjs --check`  | `scripts/verification-trace.mjs`                                   | `docs/verification.md`                                                                   |

Outside `pnpm check`:

| Check    | Command                 | Tool and version                                 | Configuration                                                                  |
| -------- | ----------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| gitleaks | `pnpm gitleaks [range]` | gitleaks 8.30.1 (Docker image, pinned by digest) | `.gitleaks.toml`                                                               |
| proofs   | `pnpm verify`           | LemmaScript 0.6.5 and Dafny 4.11.0               | `shared/LemmaScript-files.txt` ([run the proofs](../how-to/run-the-proofs.md)) |

ShellCheck and gitleaks run in their pinned Docker image and fall back to the tool on `PATH` when Docker cannot run.

## What each check fails on

- **typecheck**: a type error. The app is plain JavaScript checked through its JSDoc types (`checkJs`).
- **ESLint**: any finding (`--max-warnings 0`) not recorded in `eslint-suppressions.json`. Besides the recommended and type-aware rules: promises nobody awaits, `any` and unchecked casts, files over 400 lines, and these code shapes:
  - in `server/src/auth/`: `request.url`, `request.raw.url` or `originalUrl`;
  - in `server/` and `shared/`: `z.url()` without a `protocol` option;
  - in the app's browser code: a day taken from `toISOString()` (`.slice`, `.substring`, `.substr`, `.split`), and Leaflet tooltip or popup content given as a string;
  - everywhere: the identifiers GLOSSARY.md rejects and that mean nothing else here (`town`, `village`, `obec`, `farnost`, `manor`, `dominion`, `herrschaft`, `commune`, `moderator`, `superuser`, `proband`, and their plurals and capitals where listed);
  - in `app/tests/e2e/`: eslint-plugin-playwright's recommended rules, with `no-wait-for-timeout` an error and `test.skip(condition, reason)` allowed;
  - in `server/test/**/*.e2e.test.ts`: the plugin's rules on the page API only (fixed waits, `waitForSelector`, `networkidle`, element handles, `eval`, `force`, `page.pause()`, unused locators, needless `await`).
- **ShellCheck**: any finding at ShellCheck's default severity, in every tracked `*.sh` and `.githooks/*`.
- **docs check**: a relative link in a Markdown file to a file, folder or heading that does not exist; a page under `docs/` that `docs/README.md` does not link.
- **Prettier**: a file Prettier would change.
- **knip**: in the five workspaces (root, `app`, `server`, `server/mcp`, `shared`): unused files, unused dependencies and devDependencies, imports of packages not listed, unresolved imports, unused exports and types, duplicate exports, unused enum and class members. Not reported: an export used in its own file; an export whose JSDoc has `@public` (the proof-only predicates in `shared/`). shared/'s own entry exports are checked too, since only this workspace uses them.
- **dependency-cruiser**: in `app/`, `server/`, `shared/` and `scripts/`, an import that breaks one of these rules, unless it is recorded:
  - `app-not-server`: `app/` imports from `server/`;
  - `support-not-tree`: `server/src/auth/`, `storage/` or `ops/` imports from `server/src/tree/`;
  - `shared-stands-alone`: `shared/` imports from `app/` or `server/`;
  - `no-circular`: a cycle of imports, `import type` included;
  - `not-to-unresolvable`: an import the resolver cannot find;
  - `no-orphans` (a warning only): a module nothing imports, other than entry points, scripts, tests and configuration.
- **jscpd**: a copy of 30 lines or more (and 50 tokens) in JavaScript or TypeScript, outside tests, `app/vendor/`, `app/data/`, `openspec/` and `.claude/`.
- **pnpm audit**: a high or critical advisory in a production dependency. Every other advisory is listed and passes.
- **OpenAPI check**: `server/openapi.json` is not what the routes describe, or a route has no schema.
- **trace check**: a proof traced to no requirement, or `docs/verification.md` is not what the script would write.
- **gitleaks**: a secret, by gitleaks' own rules, in the added lines of the commits scanned; `.gitleaks.toml` lists the exceptions, each with its reason.

## Records of known findings

Two tools record findings that were there before their rule. A record only shrinks: a new finding fails, and so does a recorded one that no longer occurs, until the record is pruned.

| File                                        | Tool               | Prune with                                   |
| ------------------------------------------- | ------------------ | -------------------------------------------- |
| `eslint-suppressions.json`                  | ESLint             | `pnpm exec eslint --prune-suppressions .`    |
| `.dependency-cruiser-known-violations.json` | dependency-cruiser | `pnpm depcruise:baseline` (shrink-only mode) |

Both files are written by their tool, never by hand, and Prettier skips them.

## Where they run

- **The lint workflow** (`.github/workflows/lint.yml`), on every push and pull request and before every deploy (`deploy.yml` waits for it): gitleaks, then `pnpm check`, also when gitleaks failed. gitleaks scans a pull request's commits, a push's new commits, or, for a new branch or a force push, the commits not on `main`.
- **The audit workflow** (`.github/workflows/audit.yml`), on Mondays at 05:23 UTC: `node scripts/audit.mjs --issue`. On failure it opens an issue titled "pnpm audit: high or critical advisories in production dependencies" (label `bug`), or comments on that issue while it is open. Run by hand from the Actions tab, it defaults to a dry run.
- **The proofs** run in the verify workflow ([run the proofs](../how-to/run-the-proofs.md)).

`scripts/test/quality-checks.test.mjs` (`pnpm test:scripts`) gives each check the code of the bug it was added for and expects it to fail, and checks that AGENTS.md lists every check `pnpm check` runs.

## The audit and gitleaks scripts

| Command                                    | What it does                                                                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/audit.mjs`                   | runs `pnpm audit` for all and for production dependencies, lists every advisory, exits 1 on a failing one                                                        |
| `node scripts/audit.mjs --issue`           | as above, and on failure opens the issue or comments on the open one (`gh`, needs `GH_TOKEN` in CI)                                                              |
| `node scripts/audit.mjs --issue --dry-run` | looks for the open issue, then prints the `gh` command it would run instead of running it                                                                        |
| `node scripts/gitleaks.mjs [range]`        | scans the commits of a `git log` range (default `origin/main..HEAD`; `--all` for every branch); exits 1 on a finding, 2 when neither Docker nor gitleaks can run |
