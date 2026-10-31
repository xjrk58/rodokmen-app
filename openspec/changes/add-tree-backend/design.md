# Design

## Context

The repo has planning documents and, in parallel, the map in `app/` (`add-map-core`). This change adds the server side decided in ADRs 0004–0007. Nothing writes to the Tree yet; that is `add-proposals-and-review`. The schema must already carry what review needs: a version on every record, and room for the log of accepted Proposals (ADR 0006).

## Goals / Non-Goals

**Goals:**
- A running, backed-up server on its own domain, with Members signing in from phones.
- A schema and shared types that later changes extend without migrations that rewrite data.

**Non-Goals:**
- No write endpoints beyond accounts.
- No horizontal scaling: one VPS is enough for one family.

## Decisions

### Monorepo with pnpm workspaces
`app/`, `server/` and `shared/` are workspace packages. `shared/` holds the Zod schemas for every record and API payload. The server validates with them, the OpenAPI description is generated from them, and the app imports their types through JSDoc. Separate repos were rejected: the shared schemas would then need publishing and versioning.

### Fastify with Zod type provider, Kysely for SQL
Fastify is small and fast, has first-class schema validation, and can generate OpenAPI from the routes. Kysely gives typed SQL without hiding it, and the recursive queries for ancestors and descendants stay hand-written CTEs. NestJS was considered (familiar) but adds a framework layer this API does not need. An ORM such as Prisma was rejected because recursive CTEs and PostGIS queries end up as raw SQL anyway.

### Identifiers and versions
Every record gets a UUIDv7 primary key and an integer `version`, incremented in the same transaction as each change. Human-readable slugs (for example `jan-novak-1801`) are generated for Exports only and never used as keys, because names and years get corrected.

### Dates
Each date is stored as the EDTF string as written, plus derived `earliest` and `latest` day columns for sorting and range filters. A shared parser in `shared/` keeps app and server in agreement.

### Places in PostGIS
Place and House locations are `geography(Point)` columns. The map query uses a bounding box plus the Event year range. Municipality links reuse the codes from the app's municipality list.

### Sign-in
Passkeys use WebAuthn through `@simplewebauthn/server`, with the domain as relying party. Emailed links carry a random single-use token, stored only as a hash. Sessions live in Postgres and are referenced by an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, which works because app and API share one origin (ADR 0007).

### Images
Images go to a private bucket in Garage, a small S3-compatible server in the Compose stack on the VPS (netcup offers no object storage). The API reaches it on the Docker network and hands out presigned GET links valid for 5 minutes, signed for `files.<domain>`, which Caddy passes to Garage unchanged so that the signatures stay valid; app and API keep their one origin. Streaming images through the API was rejected: it would put every upload and image through Node. Upload comes with Proposals in the next change, but the schema and bucket exist now.

### Hosting
Docker Compose on one netcup VPS in Germany (VPS 500 G12, 4 GB, Nürnberg) runs `postgis/postgis`, the API (which also serves `app/` as static files), Garage for the images, and Caddy for automatic HTTPS. GitHub Actions builds the image, pushes it to GHCR, and deploys over SSH with a health-checked switch. If the new version fails its health check, the old container keeps running.

### Backups
A nightly job runs `pg_dump` and copies every image out of the bucket. restic encrypts and deduplicates both into a repository at a second EU provider, keeping 30 daily and 12 monthly snapshots. A monthly CI job restores the latest snapshot into a throwaway container, compares record counts and image counts, and checks that every image of the Tree has its files.

## Risks / Trade-offs

- [One VPS is a single point of failure] → nightly Backups, a monthly restore test, and a documented rebuild; downtime of hours is acceptable for a family archive.
- [Passkeys confuse some relatives] → emailed sign-in links always work as a fallback.
- [Passkeys are bound to the domain] → the domain must be final before the first relative is invited.
- [Database and images on one VPS, one copy each] → Backups live with a different provider, and the monthly restore test checks the images as well as the records.

## Migration Plan

New system, no data to migrate. The research done so far enters later as Agent Proposals (`add-agent-access`).

## Open Questions

- Which domain name? Decided: `rodokmen.dev` (configuration; needed before the first invitation).
- Which EU email service, and which second provider for Backups? Both can be chosen at implementation; neither changes the specs.
