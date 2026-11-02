# Rodokmen

Rodokmen is a private family Tree for one extended family, together with a public map of the Czech lands. Anyone can use the map to find which archive holds the parish registers of a village and to look at historical maps. Invited Members share the Tree and add to it through Proposals that an Editor reviews.

## What works today

- **The map**: search every Municipality of the Czech lands, see which archive holds its registers and open the archive's portal, lay the 19th-century military surveys over today's map, and install it as an app that works offline.
- **The Tree**: Persons, Names, Families, Events with their Roles, Places and Houses, Sources and Citations with private page images, for invited Members who sign in with passkeys.
- **Proposals and review**: Members submit each finding as a Proposal, offline too as a Draft. Editors accept, correct or reject it whole, merge duplicate Persons and undo whole Proposals, and every change has a history.
- **The family view**: for signed-in Members the tree around a Focus Person is the home screen, with people search, person pages and the family on the map through the decades. The Owner invites Members and sets their roles in the app.
- **The relation to the family**: from the Family roots the Owner marks, every Person is a Relative, a Possible relative or an Unrelated person, worked out from the evidence.
- **Agents and MCP**: in Settings, the Owner gives an AI assistant its own Agent account and tokens; through the MCP server it searches the Tree and submits Proposals, and nothing else.
- **Hosting**: one EU server, deploys that switch only to a healthy release without failing a request, nightly encrypted Backups with a monthly restore test, and email alerts.

In progress: Research leads ([#16](https://github.com/xjrk58/rodokmen-app/issues/16)), the one-time import of the Vault ([#17](https://github.com/xjrk58/rodokmen-app/issues/17)) and scan reading ([#18](https://github.com/xjrk58/rodokmen-app/issues/18)). Planned: Exports and erasure ([#19](https://github.com/xjrk58/rodokmen-app/issues/19)), and Country packs beyond the Czech lands ([#67](https://github.com/xjrk58/rodokmen-app/issues/67)).

## This repo is public

It holds code and public reference data only. Family data never goes here: no real people's names, research notes or register scans, and nothing from the Owner's private Vault. Examples, tests and the fixture Tree use invented people. CI and the Git hooks enforce this; see [AGENTS.md](AGENTS.md#keeping-vault-names-out) and [Privacy and the public/private split](docs/explanation/privacy.md).

## Run it locally

You need Node.js 22 or newer with pnpm 10 (`corepack enable`), and Docker.

```sh
pnpm install
docker run -d --name rodokmen-pg -p 5432:5432 -e POSTGRES_USER=rodokmen -e POSTGRES_PASSWORD=rodokmen -e POSTGRES_DB=rodokmen_dev postgis/postgis:16-3.4
until docker exec rodokmen-pg pg_isready -q -h 127.0.0.1 -U rodokmen; do sleep 1; done
pnpm --filter @rodokmen/server cli fixture load   # the invented fixture Tree
pnpm --filter @rodokmen/server dev                # app and API on http://localhost:3000
```

Then, in a second terminal, create the Owner; the sign-in link is printed instead of emailed:

```sh
pnpm --filter @rodokmen/server cli create-owner --email owner@example.org --name "Eva Example" --language en
```

The [tutorial](docs/tutorials/first-proposal.md) walks through this and your first Proposal step by step.

## Documentation

[`docs/`](docs/README.md) is organised along [Diátaxis](https://diataxis.fr): tutorials, how-to guides, reference and explanation. The words follow the [glossary](GLOSSARY.md), and the working rules are in [AGENTS.md](AGENTS.md).
