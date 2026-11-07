# Commands

## Server CLI

`server/src/cli.ts`. It reads the same environment variables as the API server ([Configuration](configuration.md)).

- In a checkout: `pnpm --filter @rodokmen/server cli <command>` (runs the TypeScript directly).
- In production, inside the active API container:

  ```sh
  cd /opt/rodokmen
  docker compose --env-file .env --env-file state/images.env exec api-$(cat state/active) node dist/cli.js <command>
  ```

| Command                                               | What it does                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrate`                                             | applies the database migrations; prints `applied: …` or `database is up to date`                                                                                                                                                                                                                                                                  |
| `fixture load`                                        | migrates, then loads the invented fixture Tree (about 200 Persons over six generations); refused when `NODE_ENV=production`                                                                                                                                                                                                                       |
| `create-owner --email E --name N [--language cs\|en]` | migrates, creates the first account, the Owner, and emails a sign-in link (printed when `MAIL_TRANSPORT` is `outbox`); language default `cs`                                                                                                                                                                                                      |
| `openapi write [file]`                                | writes the OpenAPI description, default `server/openapi.json`; exits 1 if a route has no schema                                                                                                                                                                                                                                                   |
| `openapi check [file]`                                | exits 1 if the description is stale (`Run: pnpm --filter @rodokmen/server openapi`) or a route has no schema                                                                                                                                                                                                                                      |
| `alert --subject S [--details D]`                     | emails an alert to `ALERT_EMAIL`                                                                                                                                                                                                                                                                                                                  |
| `health [url]`                                        | exits 0 when the health check answers within 5 seconds, else prints why and exits 1; default `http://127.0.0.1:<PORT>/api/health`                                                                                                                                                                                                                 |
| `watchdog`                                            | runs until SIGTERM or SIGINT: every 30 seconds checks `WATCHDOG_URL` and, if set, `BACKUP_STATUS_FILE`, and alerts the Owner when the health check fails for over 5 minutes or a Backup failed or is missing. On the signal it lets a round of checks still running finish and exits 0, or exits 1 if that round is still running after 5 seconds |
| `export run`                                          | runs the nightly Export now: writes the notes and `family.ged`, and pushes a commit when something changed, or a single new commit after an erasure ([Exports](exports.md)); exits 1 while the Export is off (`RODOKMEN_EXPORT_ENABLED`)                                                                                                          |
| `export gedcom [file]`                                | writes the GEDCOM file of the Tree, as the nightly Export and the Owner's download make it, to `file` or to standard output                                                                                                                                                                                                                       |
| `erasures list`                                       | prints the erased Persons' ids and when they were erased, one per line, separated by a tab; the Backup keeps the same as `db/erasures.tsv`                                                                                                                                                                                                        |
| `erasures reapply [--list FILE]`                      | adds the ids in `FILE` (such as the newest Backup's `erasures.tsv`) to the list of erasures, then erases again every listed Person the database still holds, and fails if one remains or anyone else went. The API does the same, without a file, before it answers any request                                                                   |
| `vault-import --vault DIR [options]`                  | imports the Vault through the API as one Import batch, with an Agent token; see [the Vault importer](#the-vault-importer)                                                                                                                                                                                                                         |

Exit codes: 0 success; 1 failure, with the error printed; 2 an unknown command or missing option, with the usage printed.

### The Vault importer

`vault-import` (`server/src/vault-import/`) reads a checkout of the Vault and submits it through the API as an Agent, never to the database directly. How to run it: [Import the Vault](../how-to/import-the-vault.md).

| Option                   | Default                        | Meaning                                                                                                    |
| ------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `--vault DIR`            | required                       | the Vault checkout; its commit is recorded in the provenance Source                                        |
| `--dry-run`              | off                            | read the Vault and the server's id map, write the report, submit nothing                                   |
| `--report FILE`          | `vault-import-report.md`       | where the report goes; it names Vault notes and people, so keep it outside any repository                  |
| `--name N`               | `Vault import <day>`           | the name of the Import batch                                                                               |
| `--given-by N`           | `the Owner`                    | who gave the Vault, as the Family account of its provenance Source                                         |
| `--root ID` (repeatable) | none                           | Vault ids of the Family roots, for the dry run's comparison of the relation to the family on an empty Tree |
| `--municipalities FILE`  | `app/data/municipalities.json` | the list of Municipalities that Places are matched against                                                 |

It needs `RODOKMEN_URL` (the server) and `RODOKMEN_TOKEN` (an Agent token); without them it exits 2 and says what to set. LibreOffice (`soffice`) on `PATH` converts DOC files to PDF; without it, each DOC is reported and left out.

A run opens one Import batch, uploads the scans and documents, and submits the Proposals in order. A later run submits only what its id map (`GET`, `PUT /api/import-map`) does not have yet, and creates the Research leads once the Persons and Places they link exist. It prints the batch, the counts of Proposals and records, and the leads created or waiting.

## Workspace scripts

Run from the repo root with `pnpm <script>`.

| Script               | What it does                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `build`              | builds every package that has a build (`server`, `server/mcp`, `shared`) into its `dist/`                                               |
| `check`              | runs every code check in a fixed order, as the lint workflow does, and prints a summary ([Code checks](checks.md))                      |
| `typecheck`          | type-checks every package                                                                                                               |
| `test`               | runs every package's tests; the server's need PostgreSQL (`TEST_DATABASE_URL`), the app's need Playwright's Chromium                    |
| `test:scripts`       | tests the repo's own scripts in `scripts/test/`                                                                                         |
| `lint`               | `lint:js`, `lint:sh` and `lint:docs`                                                                                                    |
| `lint:js`            | ESLint with type information; no warnings allowed; known findings are in `eslint-suppressions.json`                                     |
| `lint:sh`            | ShellCheck on every tracked shell script, in the pinned Docker image, else a `shellcheck` on `PATH`                                     |
| `lint:docs`          | `scripts/docs-check.mjs`: fails on a broken relative link in a Markdown file, and on a page under `docs/` missing from `docs/README.md` |
| `format`             | formats the workspace with Prettier                                                                                                     |
| `format:check`       | fails on files Prettier would change                                                                                                    |
| `knip`               | knip: unused files, exports, dependencies and class members (`knip.jsonc`); `--fix` removes some                                        |
| `depcruise`          | dependency-cruiser: forbidden imports and cycles (`.dependency-cruiser.cjs`), ignoring the recorded ones                                |
| `depcruise:baseline` | removes recorded dependency-cruiser findings that no longer occur; never adds one                                                       |
| `jscpd`              | jscpd: copies of 30 lines or more (`.jscpd.json`)                                                                                       |
| `gitleaks [range]`   | `scripts/gitleaks.mjs`: secrets in the commits of a `git log` range, default `origin/main..HEAD`                                        |
| `verify`             | proves the rules in `shared/` (`lsc check`; needs Dafny 4.11 on `PATH`)                                                                 |
| `verify:trace`       | writes `docs/verification.md` (`scripts/verification-trace.mjs`; `--check` only compares)                                               |
| `vault-guard`        | `scripts/vault-guard.mjs` ([options](vault-denylist.md#the-guards-options))                                                             |

Package scripts, with `pnpm --filter <package> <script>`:

| Package            | Script                     | What it does                                                                                                                                     |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@rodokmen/server` | `dev`                      | the API on `HOST:PORT`, restarting on changes                                                                                                    |
| `@rodokmen/server` | `cli`                      | the server CLI above                                                                                                                             |
| `@rodokmen/server` | `openapi`, `openapi:check` | `cli openapi write` and `cli openapi check`                                                                                                      |
| `@rodokmen/server` | `bench:scan`               | the scan reader benchmark; needs `ANTHROPIC_API_KEY` and makes paid requests ([run the reader benchmark](../how-to/run-the-reader-benchmark.md)) |
| `@rodokmen/mcp`    | `stdio`, `http`            | the MCP server over stdio or HTTP, without a build                                                                                               |
| `@rodokmen/shared` | `verify:regen <file>`      | regenerates one file's Dafny (`lsc regen`)                                                                                                       |
| `@rodokmen/app`    | `serve`                    | serves `app/` on http://localhost:4173 (`--port`, `--base`)                                                                                      |
| `@rodokmen/app`    | `build-data`               | rebuilds the map data in `app/data/` from its sources                                                                                            |
| `@rodokmen/app`    | `check-links`              | checks every portal URL in `app/data/archives.json`                                                                                              |
| `@rodokmen/app`    | `vendor`                   | copies Leaflet, Preact and htm into `app/vendor/`                                                                                                |
| `@rodokmen/app`    | `test:unit`, `test:e2e`    | the app's unit tests and Playwright tests                                                                                                        |

## Other scripts

| Command                                                 | What it does                                                                                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `node scripts/audit.mjs [--issue [--dry-run]]`          | fails on a high or critical advisory in a production dependency; `--issue` opens or updates the GitHub issue ([Code checks](checks.md#the-audit-and-gitleaks-scripts))                                             |
| `node app/scripts/build-data.mjs [--refresh]`           | rebuilds districts, the border, Municipalities and `municipalityOverrides`; `--refresh` downloads the sources again                                                                                                |
| `node app/scripts/check-links.mjs [--extra "Name=URL"]` | exits 1 on a definite failure; timeouts, certificate-chain errors, 401, 403, 408, 429 and lasting server errors are warnings                                                                                       |
| `node app/scripts/stamp-version.mjs [--check]`          | writes the release version into `app/sw.js` and `app/src/version.js`; `--check` exits 1 if it is stale                                                                                                             |
| `node app/scripts/site-files.mjs [--copy DIR]`          | lists the deployed files of `app/`, or copies them to `DIR`                                                                                                                                                        |
| `node app/scripts/make-icons.mjs`                       | renders the app icons from their SVG drawing                                                                                                                                                                       |
| `docs/architecture/generate.sh`                         | validates the C4 model and regenerates every diagram (Docker)                                                                                                                                                      |
| `deploy/scripts/deploy.sh <image>\|rollback`            | on the VPS: starts the image in the idle API slot; once it is healthy, points Caddy at it (`state/api-slot/`), waits until the old slot has answered its requests in flight (at most `DRAIN_SECONDS`) and stops it |
| `deploy/scripts/storage-init.sh`                        | on the VPS: checks the image bucket and gives the Backup job its read-only key; safe to repeat                                                                                                                     |
