# The architecture

Rodokmen is small on purpose: one family, a few thousand Persons, a handful of Members, one server. Most of its shape follows from that, and from two needs that pull against each other: a map anyone can use, and a Tree only the family may see. The C4 diagrams in [`docs/architecture/`](../architecture/README.md) show the parts; this page says why they are cut the way they are.

## One codebase

The app, the API and the MCP server are TypeScript in one public repo (ADR 0007):

- `app/` is the progressive web app, the only interface. It has no bundler: Leaflet, Preact and htm are copied into `app/vendor/`, and browsers load the modules as they are. The public map is plain static files that need no server at all, which is why GitHub Pages can host a preview of it.
- `server/` is the API: Fastify with Zod schemas, Kysely for SQL, on PostgreSQL with PostGIS. It also serves the app's files, so app and API share one origin.
- `server/mcp/` is the MCP server for AI assistants. It is a client of the public API with the caller's Agent token and has no database access, so it cannot offer more than the token allows. A lint rule keeps it from importing the server's code.
- `shared/` holds what the others must agree on: the Zod schemas of every record and operation, the date parser, and the pure rules (who may do what, who is Living, the relation to the family), which are proved ([Proofs with LemmaScript](proofs.md)).

Sharing the schemas is the main reason for one language. The API validates requests with the same schemas the app builds them from, and the OpenAPI description is generated from them, so the three cannot drift apart unnoticed.

We built the backend rather than adopt a genealogy system (ADR 0004). webtrees came closest, with moderation and automatic privacy for the living, but its API depends on a small third-party module; Gramps Web has a strong API but no review before publishing, and privacy is a manual flag. We copied their best ideas instead: webtrees' rules for the living and its moderation, the Gramps event and place model, and undo of whole change sets from Gramps Web.

## One database

Everything lives in one PostgreSQL database (ADR 0005): the Tree, Proposals, the log of accepted changes, accounts and sessions. A family tree is a graph, and a graph database was the first idea. But a Tree of a few thousand Persons is small enough for recursive SQL, and one transactional store lets a Proposal's changes, its review state and its history commit together or not at all. It is also one system to run and back up.

The Tree is kept as its current state in ordinary tables, plus an append-only log of every accepted Proposal with each record before and after (ADR 0006). The log gives history and undo. Rebuilding the state from the log (event sourcing) would add complexity that a Tree this size does not repay.

## One domain

App and API are served from one domain over HTTPS (ADR 0007). Passkeys are bound to a domain, and the session cookie is safest when it never leaves its own origin. The earlier plan, an app on GitHub Pages reading a private Git repo with a personal token, could do neither.

Images are the one exception. Page images and portraits live in Garage, a small S3-compatible store on the same server, and browsers fetch them from `files.<domain>` through signed links that expire within minutes. A signed S3 link covers its host and path, so it cannot be served under the main domain without breaking the signature; and streaming every image through Node would cost memory the 4 GB server needs elsewhere. The session cookie is host-only, so it never reaches the files host.

## One server

Production is one VPS in the EU, run with Docker Compose: the database, two API slots, Garage, Caddy for HTTPS, the MCP server and a watchdog. A deploy starts the new release in the idle API slot and switches only when it passes its health check, so a bad release never replaces a good one. Migrations therefore have to work with the previous release still running. Nightly Backups go encrypted to a second EU provider, and a monthly job restores the latest one to prove it can be read.

The details, and the reasons behind the memory limits, are in the [deploy guide](../../deploy/README.md).

## What is not here yet

Several parts in the diagrams are Planned: the one-way nightly Export to a private repo (ADR 0008), the one-time import of the Vault (ADR 0010), Research leads, and scan reading (ADR 0011). The diagrams mark each element as Built, In progress or Planned.
