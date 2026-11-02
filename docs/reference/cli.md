# Commands

## Server CLI

`server/src/cli.ts`. It reads the same environment variables as the API server ([Configuration](configuration.md)).

- In a checkout: `pnpm --filter @rodokmen/server cli <command>` (runs the TypeScript directly).
- In production, inside the active API container:

  ```sh
  cd /opt/rodokmen
  docker compose --env-file .env --env-file state/images.env exec api-$(cat state/active) node dist/cli.js <command>
  ```

| Command                                               | What it does                                                                                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrate`                                             | applies the database migrations; prints `applied: …` or `database is up to date`                                                                                                                   |
| `fixture load`                                        | migrates, then loads the invented fixture Tree (about 200 Persons over six generations); refused when `NODE_ENV=production`                                                                        |
| `create-owner --email E --name N [--language cs\|en]` | migrates, creates the first account, the Owner, and emails a sign-in link (printed when `MAIL_TRANSPORT` is `outbox`); language default `cs`                                                       |
| `openapi write [file]`                                | writes the OpenAPI description, default `server/openapi.json`; exits 1 if a route has no schema                                                                                                    |
| `openapi check [file]`                                | exits 1 if the description is stale (`Run: pnpm --filter @rodokmen/server openapi`) or a route has no schema                                                                                       |
| `alert --subject S [--details D]`                     | emails an alert to `ALERT_EMAIL`                                                                                                                                                                   |
| `health [url]`                                        | exits 0 when the health check answers within 5 seconds, else prints why and exits 1; default `http://127.0.0.1:<PORT>/api/health`                                                                  |
| `watchdog`                                            | runs until stopped: every 30 seconds checks `WATCHDOG_URL` and, if set, `BACKUP_STATUS_FILE`, and alerts the Owner when the health check fails for over 5 minutes or a Backup failed or is missing |

Exit codes: 0 success; 1 failure, with the error printed; 2 an unknown command or missing option, with the usage printed.

## Workspace scripts

Run from the repo root with `pnpm <script>`.

| Script         | What it does                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `build`        | builds every package that has a build (`server`, `server/mcp`, `shared`) into its `dist/`                                               |
| `typecheck`    | type-checks every package                                                                                                               |
| `test`         | runs every package's tests; the server's need PostgreSQL (`TEST_DATABASE_URL`), the app's need Playwright's Chromium                    |
| `test:scripts` | tests the repo's own scripts in `scripts/test/`                                                                                         |
| `lint`         | `lint:js`, `lint:sh` and `lint:docs`                                                                                                    |
| `lint:js`      | ESLint with type information; no warnings allowed; known findings are in `eslint-suppressions.json`                                     |
| `lint:sh`      | ShellCheck on every tracked shell script, in the pinned Docker image, else a `shellcheck` on `PATH`                                     |
| `lint:docs`    | `scripts/docs-check.mjs`: fails on a broken relative link in a Markdown file, and on a page under `docs/` missing from `docs/README.md` |
| `format`       | formats the workspace with Prettier                                                                                                     |
| `format:check` | fails on files Prettier would change                                                                                                    |
| `verify`       | proves the rules in `shared/` (`lsc check`; needs Dafny 4.11 on `PATH`)                                                                 |
| `verify:trace` | writes `docs/verification.md` (`scripts/verification-trace.mjs`; `--check` only compares)                                               |
| `vault-guard`  | `scripts/vault-guard.mjs` ([options](vault-denylist.md#the-guards-options))                                                             |

Package scripts, with `pnpm --filter <package> <script>`:

| Package            | Script                     | What it does                                                |
| ------------------ | -------------------------- | ----------------------------------------------------------- |
| `@rodokmen/server` | `dev`                      | the API on `HOST:PORT`, restarting on changes               |
| `@rodokmen/server` | `cli`                      | the server CLI above                                        |
| `@rodokmen/server` | `openapi`, `openapi:check` | `cli openapi write` and `cli openapi check`                 |
| `@rodokmen/mcp`    | `stdio`, `http`            | the MCP server over stdio or HTTP, without a build          |
| `@rodokmen/shared` | `verify:regen <file>`      | regenerates one file's Dafny (`lsc regen`)                  |
| `@rodokmen/app`    | `serve`                    | serves `app/` on http://localhost:4173 (`--port`, `--base`) |
| `@rodokmen/app`    | `build-data`               | rebuilds the map data in `app/data/` from its sources       |
| `@rodokmen/app`    | `check-links`              | checks every portal URL in `app/data/archives.json`         |
| `@rodokmen/app`    | `vendor`                   | copies Leaflet, Preact and htm into `app/vendor/`           |
| `@rodokmen/app`    | `test:unit`, `test:e2e`    | the app's unit tests and Playwright tests                   |

## Other scripts

| Command                                                 | What it does                                                                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `node app/scripts/build-data.mjs [--refresh]`           | rebuilds districts, the border, Municipalities and `municipalityOverrides`; `--refresh` downloads the sources again          |
| `node app/scripts/check-links.mjs [--extra "Name=URL"]` | exits 1 on a definite failure; timeouts, certificate-chain errors, 401, 403, 408, 429 and lasting server errors are warnings |
| `node app/scripts/stamp-version.mjs [--check]`          | writes the release version into `app/sw.js` and `app/src/version.js`; `--check` exits 1 if it is stale                       |
| `node app/scripts/site-files.mjs [--copy DIR]`          | lists the deployed files of `app/`, or copies them to `DIR`                                                                  |
| `node app/scripts/make-icons.mjs`                       | renders the app icons from their SVG drawing                                                                                 |
| `docs/architecture/generate.sh`                         | validates the C4 model and regenerates every diagram (Docker)                                                                |
| `deploy/scripts/deploy.sh <image>\|rollback`            | on the VPS: starts the image in the idle API slot and switches when it is healthy                                            |
| `deploy/scripts/storage-init.sh`                        | on the VPS: checks the image bucket and gives the Backup job its read-only key; safe to repeat                               |
