# Tasks

## 1. Workspace

- [ ] 1.1 Turn the repo into a pnpm workspace with `app/`, `server/` and `shared/`; verify `pnpm -r build` and `pnpm -r test` run in CI
  - Note: done: root `package.json` and `pnpm-workspace.yaml` (app, server, shared); `pnpm -r build`, `pnpm -r typecheck` and `pnpm -r test` pass locally (shared 90 tests, server 92 tests) and `.github/workflows/server-ci.yml` runs them against a `postgis/postgis` service (actionlint clean). Remains: a first green run on GitHub Actions, which cannot run from this sandbox; `app/` joins when add-map-core is merged.
- [x] 1.2 Add a CI guard that fails if the repo gains family data (any `.ged` file, a `people/` folder, or an image outside `app/` assets and test fixtures); verify with a deliberately added `.ged` file
  - Note: verified locally: `.github/scripts/repo-guard.sh` (run by `repo-guard.yml`) fails on a deliberately added `family.ged`, a `people/` folder and a stray image, and passes for images under `app/` and test fixtures.

## 2. Shared model

- [x] 2.1 Write Zod schemas in `shared/` for Person, Name, Family (with child link types), Event, Role, Place, House, Parish, Estate, Municipality link, Source, Citation and image metadata; verify with unit tests of valid and invalid examples
- [x] 2.2 Write the EDTF-subset parser with `earliest` and `latest`; verify the table of examples in the tree-model spec
  - Note: the tree-model spec lists the forms but has no table of earliest/latest values. The table now lives in `shared/src/edtf.ts` ("about" widens by 2 years / 1 month / 7 days; "uncertain" keeps the range) and `shared/test/edtf.test.ts` checks every row.
- [x] 2.3 Write the Living rule as a pure function; verify the spec scenarios (no dates, born 1920, born 1950)

## 3. Database

- [x] 3.1 Create Kysely migrations for all Tree tables with UUIDv7 keys, `version` columns and PostGIS points; verify by migrating an empty database in a Testcontainers test
  - Note: Testcontainers cannot pull images in the build sandbox, so `server/test/migrations.test.ts` creates an empty throwaway database on the PostgreSQL given by `TEST_DATABASE_URL` (a `postgis/postgis` service container in CI) and migrates it from nothing; every test run creates and drops its own databases.
- [x] 3.2 Load an invented fixture tree (about 200 Persons over 6 generations, renumbered Houses, a parish change, an adoption); verify the House renumbering and parish-period scenarios against it

## 4. Read API

- [x] 4.1 Serve Fastify routes for Persons, Families, Events, Places, Houses, Sources and Citations, validated by the shared schemas; verify with integration tests on the fixture
- [x] 4.2 Add diacritic-insensitive Person search across all Names (`unaccent` plus trigram index); verify "nowak" finds the Person whose primary Name is "Novák"
- [x] 4.3 Add ancestors and descendants queries (recursive CTE, at least 6 generations); verify against the fixture's known pedigree
- [x] 4.4 Add the map query (bounding box plus year range); verify that only Events of the range inside the box return
- [x] 4.5 Generate and publish the OpenAPI description; verify the CI route comparison fails when a route is added without a schema
  - Note: `server/openapi.json` is generated from the shared schemas and served at `/api/openapi.json` to Members; `openapi:check` in server-ci fails when it is stale or when a route has no response schema or is missing (`server/test/openapi.test.ts` adds such a route and sees the comparison fail).
- [x] 4.6 Reject requests without a session or token; verify the 401 scenario, including for unknown ids

## 5. Accounts

- [x] 5.1 Implement invitations (Owner only, single use, 7 days); verify the accept and expired scenarios
- [x] 5.2 Implement passkey registration and sign-in; verify with a virtual WebAuthn authenticator in Playwright
  - Note: the sign-in screens (invitation, emailed link, passkey) are minimal server pages under `/auth/` (`server/public/auth/`), because `app/` has no sign-in screens yet; they can move into the app later without API changes.
- [x] 5.3 Implement emailed sign-in links (15 minutes, single use, stored hashed); verify the new-phone scenario with a captured email
- [x] 5.4 Implement roles, the single-Owner rule, sessions list and disabling; verify the promote and disable scenarios
- [x] 5.5 Write invitation and sign-in emails in Czech and English; verify each language renders in a snapshot test

## 6. Hosting and deploys

- [x] 6.1 Write the Docker Compose stack (PostGIS, API serving `app/`, Caddy); verify locally with `docker compose up` and a health check
  - Note: done: `deploy/docker-compose.yml` (PostGIS, two API slots serving `app/`, Garage for images, Caddy, watchdog, backup job), `deploy/Dockerfile`, `deploy/caddy/Caddyfile`. Verified locally with images from Docker Hub: a copy of `deploy/` with `.env` and `backup.env` made from the examples (`DOMAIN=localhost`, other host ports), the API image built from the repo and served by a local registry, then `scripts/deploy.sh <image>`, which runs `docker compose up -d`: `db`, `garage` and `api-blue` became healthy, `https://localhost/api/health` answered `{"status":"ok","database":"ok"}` through Caddy, and Chromium loaded the app from `https://localhost/`. A second deploy switched to `api-green`.
- [ ] 6.2 Provision the netcup VPS, point `rodokmen.dev` and `files.rodokmen.dev` at it, and enable HTTPS; verify the http → https redirect and certificate renewal dry run
  - Note: needs the Owner's netcup account and DNS for `rodokmen.dev` (deploy/README.md, steps 1–3). The images live on the VPS (Garage in the Compose stack), so there is no bucket to provision. Prepared and checked locally: Caddy with `deploy/caddy/Caddyfile` answers http://localhost/x and http://files.localhost/x with 308 to https; an image uploaded through the API with a presigned PUT to `https://files.localhost` opens through the API's redirect, while unsigned or altered links get 403 and other paths 404. Remains: provisioning, real certificates, renewal dry run.
- [ ] 6.3 Add the GitHub Actions deploy with health-checked switch and rollback; verify by deploying a build that fails its health check and seeing the old version keep serving
  - Note: done: `.github/workflows/deploy.yml` (tests and repo guard, GHCR image, SSH) and `deploy/scripts/deploy.sh` (blue/green slots, switch only when healthy, alert and exit 1 otherwise, rollback); `deploy/scripts/deploy.test.sh` checks the switch, failed-health-check and rollback paths with a fake docker and runs in server-ci. Remains: deploying a failing build to the real VPS.
- [ ] 6.4 Connect the EU email service on the domain (SPF, DKIM, DMARC); verify a sign-in email arrives in under a minute and passes DKIM
  - Note: done: mail interface with dev/test outbox and an SMTP transport (nodemailer, STARTTLS required) configured by env; tested against a local SMTP server with STARTTLS and auth. Remains: choosing the EU provider, SPF/DKIM/DMARC records, and checking real delivery under a minute with DKIM pass (needs the Owner's accounts).

## 7. Backups and alerts

- [ ] 7.1 Add the nightly `pg_dump` and bucket copy into restic at the second provider, with 30 daily and 12 monthly snapshots kept; verify one night's snapshot exists and is encrypted
  - Note: done: `deploy/backup/backup.sh` (pg_dump and record counts in one snapshot, rclone copy of every image out of Garage with a read-only key, restic with `--keep-daily 30 --keep-monthly 12 --prune`, status file), backup image and systemd timer. Verified locally against a local restic repository: snapshot created, no plaintext in the repository files, wrong password refused, and the retention keeps 30 daily + 12 monthly of 401 back-dated snapshots. With Garage, run as the systemd unit does (`docker compose --profile jobs run --rm backup`): 35 tables and all 8 image files of the bucket in the snapshot; rebuilding a wiped stack from it with the README's steps brought back the database and a 19 MB original byte for byte. Remains: the second provider's account and one real night on the VPS.
- [ ] 7.2 Add the monthly restore test in CI; verify it fails when a table is deliberately emptied in the scratch restore
  - Note: done: `.github/workflows/backup-restore-test.yml` (monthly, throwaway PostGIS service) and `deploy/backup/restore-check.sh`. Verified locally with a local repository: passes on the intact restore (4,199 records in 28 tables, 2 images) and fails when `EMPTY_TABLE=name` empties a table in the scratch restore. It also checks images: the number of image files, and that every image of the Tree has its original and display copy. Verified locally against a Garage-backed Backup: passes (49 records in 35 tables, 8 image files, the 4 files of the Tree's 2 images), and fails with `REMOVE_IMAGE=1`, with `EMPTY_TABLE=image`, and for a Backup whose image copy came from the wrong source (file counts equal, the Tree's files missing). Remains: running it in CI against the real Backups (needs the `backups` secrets).
- [ ] 7.3 Add alerts to the Owner for a failing health check (over 5 minutes) and for a failed Backup; verify both by forcing each failure once
  - Note: done: watchdog (`node dist/cli.js watchdog`, compose service) alerts after 5 minutes of failing health checks, on a failed Backup and when none succeeded for 26 hours; unit-tested with a fake clock. Forced once locally with real processes: against a closed port the health alert arrived after exactly 5 minutes, and a Backup run with a wrong restic password produced the "Nightly Backup failed" alert, both by SMTP to a local server. Remains: forcing both on the VPS with the real email service.

## Workflow follow-up

- Archive this change after deployment so its specs move to `openspec/specs/`.
