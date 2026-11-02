# Rodokmen documentation

The docs follow [Diátaxis](https://diataxis.fr): four kinds of page for four needs. Pick the section by what you need now.

- **Tutorials** teach by doing. Start here if you are new.
- **How-to guides** get one task done, for someone who knows what they want.
- **Reference** describes the machinery: commands, settings, files, the API.
- **Explanation** says why Rodokmen is built the way it is.

The words follow the [glossary](../GLOSSARY.md). The working rules for people and agents are in [AGENTS.md](../AGENTS.md).

## Tutorials

- [Run Rodokmen and make your first Proposal](tutorials/first-proposal.md): run it locally with the invented fixture Tree, sign in with a passkey, then submit a Proposal and accept it.

## How-to guides

Running Rodokmen:

- [Deploy to netcup and go live](how-to/go-live.md): the Owner's steps, still in the deploy guide for now.
- [Restore from a Backup](how-to/restore-from-a-backup.md): rebuild the server after a loss, or check that a Backup restores.
- [Connect an AI assistant through MCP](how-to/connect-an-assistant.md): create an Agent and its token, and connect the assistant.
- [Mark Family roots and link Members to their Persons](how-to/mark-family-roots.md): tell Rodokmen where the family starts and who each Member is.

Keeping the repo public-safe:

- [Build or refresh the Vault-name denylist](how-to/build-the-vault-denylist.md): the Owner's private list that the Git hooks check against.

Developing:

- [Work on a change](how-to/work-on-a-change.md): from a GitHub issue with the `go` label, through OpenSpec, to a merged PR.
- [Run the proofs and regenerate the verification page](how-to/run-the-proofs.md): LemmaScript and Dafny, and `docs/verification.md`.
- [Regenerate the C4 diagrams](how-to/regenerate-the-c4-diagrams.md): after changing the architecture model.
- [Add or change archive data](how-to/change-archive-data.md): an archive, its districts or its portal, and the link check.

## Reference

- [Configuration](reference/configuration.md): environment variables of the server, the MCP server, the production stack and the scripts.
- [Commands](reference/cli.md): the server CLI, the workspace scripts and the repo's own scripts.
- [The API](reference/api.md): where the OpenAPI description is, sign-in, errors and limits.
- [MCP tools](reference/mcp-tools.md): what an assistant with an Agent token can call.
- [Roles and actions](reference/roles-and-actions.md): what Agents, Contributors, Editors and the Owner may do.
- [Map data files](reference/app-data.md): the files in `app/data/`.
- [Vault denylist format](reference/vault-denylist.md): the private file the Vault-name guard reads, and the guard's options.
- [Glossary](../GLOSSARY.md): the words we use, and the ones we avoid.
- [Verification](verification.md): every proved rule and its requirement, and what the proofs assume (generated).
- [Deploy guide](../deploy/README.md): what runs on the server, its configuration and secrets, deploys, Backups and alerts (moving into these docs, [#88](https://github.com/xjrk58/rodokmen-app/issues/88)).
- [OpenSpec changes](../openspec/changes/): the requirements, one change per piece of work, each with its specs, design and tasks.

## Explanation

- [The architecture](explanation/architecture.md): one TypeScript codebase, one database, one domain, and how the parts fit. The diagrams are in [C4 architecture](architecture/README.md), also as [Mermaid](architecture/generated/mermaid.md).
- [Proposals and review](explanation/proposals-and-review.md): why every change to the Tree is a reviewed Proposal.
- [Privacy and the public/private split](explanation/privacy.md): the public map and the private Tree, Living people, images, the Vault and this public repo.
- [The relation to the family](explanation/relation-to-the-family.md): Relatives, Possible relatives and Unrelated people, and why they are computed from the evidence.
- [Offline and the app](explanation/offline.md): what works without a connection, and why offline means Drafts rather than sync.
- [Proofs with LemmaScript](explanation/proofs.md): which rules are proved, what that buys, and where the proofs stop.

Decisions (ADRs), the choices that are hard to reverse:

- [0001 Contributions go through reviewed Proposals](adr/0001-contributions-go-through-reviewed-proposals.md): every change from a Member or Agent is a Proposal an Editor accepts or rejects whole.
- [0002 Store private copies of cited register pages](adr/0002-store-private-copies-of-cited-pages.md): each Citation keeps an image of its page, for Members only, because archive links rot.
- [0003 Offline means Drafts, not sync](adr/0003-offline-means-drafts-not-sync.md): Drafts written offline are submitted later; the Editor resolves conflicts.
- [0004 Build the Tree backend from scratch](adr/0004-build-the-tree-backend-from-scratch.md): our own backend, copying what webtrees, Gramps and GEDCOM got right.
- [0005 One PostgreSQL database, no graph database](adr/0005-one-postgresql-database-no-graph-database.md): one transactional store with PostGIS; recursive SQL for family links.
- [0006 Current-state tables plus a log of accepted Proposals](adr/0006-current-state-plus-log-of-accepted-proposals.md): history and undo from an append-only log; erasure is the one exception.
- [0007 One TypeScript codebase, one interface, one domain](adr/0007-one-codebase-one-interface-one-domain.md): the PWA is the only interface; app and API share one origin for passkeys.
- [0008 rodokmen-data is a one-way Export](adr/0008-rodokmen-data-is-a-one-way-export.md): the database is the source of truth; the nightly Export is never edited by hand.
- [0009 Prove pure rules with LemmaScript](adr/0009-prove-pure-rules-with-lemmascript.md): pure rules are proved with Dafny and traced to their requirement.
- [0010 Import the Vault once, freeze it, and Export elsewhere](adr/0010-import-the-vault-once-and-freeze-it.md): the Vault comes in once as reviewed Proposals, then stays a read-only archive.
- [0011 Scan reading sends scans to Anthropic's API](adr/0011-scan-reading-sends-scans-to-anthropic.md): only while the Owner allows it, and always into something a person checks.

Research:

- [Extending Rodokmen to the EU and UK](research/eu-uk-expansion.md): what the map and the Tree would need beyond the Czech lands, country by country.

## Keeping the docs current

Every change updates the docs in the right section and lists new pages here, one line each; the README changes when what works changes (AGENTS.md, "Docs"). `pnpm lint:docs` fails on a broken relative link in any Markdown file and on a page under `docs/` that this index does not link.
