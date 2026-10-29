# Tasks

## 1. Workspace

- [ ] 1.1 Turn the repo into a pnpm workspace with `app/`, `server/` and `shared/`; verify `pnpm -r build` and `pnpm -r test` run in CI
- [ ] 1.2 Add a CI guard that fails if the repo gains family data (any `.ged` file, a `people/` folder, or an image outside `app/` assets and test fixtures); verify with a deliberately added `.ged` file

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

- [ ] 4.1 Serve Fastify routes for Persons, Families, Events, Places, Houses, Sources and Citations, validated by the shared schemas; verify with integration tests on the fixture
- [ ] 4.2 Add diacritic-insensitive Person search across all Names (`unaccent` plus trigram index); verify "nowak" finds the Person whose primary Name is "Novák"
- [ ] 4.3 Add ancestors and descendants queries (recursive CTE, at least 6 generations); verify against the fixture's known pedigree
- [ ] 4.4 Add the map query (bounding box plus year range); verify that only Events of the range inside the box return
- [ ] 4.5 Generate and publish the OpenAPI description; verify the CI route comparison fails when a route is added without a schema
- [ ] 4.6 Reject requests without a session or token; verify the 401 scenario, including for unknown ids

## 5. Accounts

- [ ] 5.1 Implement invitations (Owner only, single use, 7 days); verify the accept and expired scenarios
- [ ] 5.2 Implement passkey registration and sign-in; verify with a virtual WebAuthn authenticator in Playwright
- [ ] 5.3 Implement emailed sign-in links (15 minutes, single use, stored hashed); verify the new-phone scenario with a captured email
- [ ] 5.4 Implement roles, the single-Owner rule, sessions list and disabling; verify the promote and disable scenarios
- [ ] 5.5 Write invitation and sign-in emails in Czech and English; verify each language renders in a snapshot test

## 6. Hosting and deploys

- [ ] 6.1 Write the Docker Compose stack (PostGIS, API serving `app/`, Caddy); verify locally with `docker compose up` and a health check
- [ ] 6.2 Provision the Hetzner VPS and bucket, point the domain, and enable HTTPS; verify the http → https redirect and certificate renewal dry run
- [ ] 6.3 Add the GitHub Actions deploy with health-checked switch and rollback; verify by deploying a build that fails its health check and seeing the old version keep serving
- [ ] 6.4 Connect the EU email service on the domain (SPF, DKIM, DMARC); verify a sign-in email arrives in under a minute and passes DKIM

## 7. Backups and alerts

- [ ] 7.1 Add the nightly `pg_dump` and bucket copy into restic at the second provider, with 30 daily and 12 monthly snapshots kept; verify one night's snapshot exists and is encrypted
- [ ] 7.2 Add the monthly restore test in CI; verify it fails when a table is deliberately emptied in the scratch restore
- [ ] 7.3 Add alerts to the Owner for a failing health check (over 5 minutes) and for a failed Backup; verify both by forcing each failure once

## Workflow follow-up

- Archive this change after deployment so its specs move to `openspec/specs/`.
