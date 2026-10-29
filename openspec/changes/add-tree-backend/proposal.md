# Proposal

## Why

Several Members need to reach one Tree from their phones, with roles and Backups, before Proposals or the family view can exist. ADRs 0004–0007 fix the shape: our own TypeScript backend, one PostgreSQL database, one domain on an EU VPS.

## What Changes

- New `server/` (TypeScript on Node) and `shared/` (the data model and its validation, used by both app and server) in this repo.
- A PostgreSQL + PostGIS schema for the Tree: Persons with Names, Families, Events with Roles, Places, Houses, Parishes, Estates, Sources, and Citations with confidence and images.
- A read-only JSON API with an OpenAPI description, open to Members and Agents only.
- Member accounts: invitation by the Owner, sign-in with a passkey or an emailed link, and three roles (Contributor, Editor, Owner).
- Operations: one domain over HTTPS on a Hetzner VPS in Germany, deploys from CI, email through an EU transactional service, and nightly encrypted Backups to a second EU provider.

Out of scope: changing the Tree (Proposals, review, history and undo come in `add-proposals-and-review`); Agent accounts and the MCP server (`add-agent-access`); family screens in the app (`add-family-view`); Exports and erasure (`add-exports-and-erasure`); GEDCOM import. Until `add-proposals-and-review` lands, the Tree holds only test fixtures.

## Capabilities

### New Capabilities
- `tree-model`: what the Tree records and the rules its records follow.
- `tree-read-api`: reading the Tree over the API.
- `member-accounts`: invitations, sign-in, roles and sessions.
- `operations`: hosting, deployment, email, Backups and monitoring.

### Modified Capabilities

## Impact

- New packages `server/` and `shared/`; the repo becomes a pnpm workspace with `app/`.
- New infrastructure: a Hetzner VPS and object storage, a domain with DNS, an EU email service, a second EU provider for Backups.
- New GitHub Actions secrets for deployment, Backups and email.
