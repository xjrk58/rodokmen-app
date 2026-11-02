# How to import the Vault

This guide takes the Owner through importing the Vault (the `rodokmen-data` repository) into the Tree once, as
one Import batch of Proposals (ADR 0010; OpenSpec change `add-vault-import`). The importer is a client of the
server's API with an Agent token: everything it submits is reviewed and logged like any Agent's Proposal, and
nothing changes in the Tree until the Owner accepts it.

## Before you start

- The server is running and you can sign in as the Owner.
- A checkout of `rodokmen-data` on your computer, at the commit you want to import.
- This repository with its dependencies installed (`pnpm install`), on the same computer.
- LibreOffice (`soffice`) on the PATH, to convert DOC files to PDF. Without it, each DOC is reported and left out.

## 1. Create the importing Agent

In the app, open **Settings → Agents**, create an Agent named `Vault importer`, and issue a token. Copy the token
(`rdk_ag_…`): it is shown once. Its requests to its Import batches count against a limit of 10,000 an hour of
their own, so the whole Vault fits in one run.

## 2. Mark the Family roots

On the person pages of the couple the family descends from, choose **Mark as Family root**. You can only do this
for Persons in the Tree, so on an empty Tree skip it now and pass the roots to the dry run by their Vault ids
instead (`--root jan-novak-1801 --root anna-novakova-1803`): the dry run then compares the relation to the family
it will compute with the Vault's `nepribuzny` and `mozny-pribuzny` tags.

## 3. Do a dry run

The dry run reads the Vault and the server's id map, and submits nothing. Run, from the repository root:

```sh
RODOKMEN_URL=https://rodokmen.example \
RODOKMEN_TOKEN=rdk_ag_… \
pnpm --filter @rodokmen/server cli vault-import --vault ../rodokmen-data --dry-run --report ~/vault-import-report.md
```

On the server itself, `node dist/cli.js vault-import …` takes the same options.

The report names Vault notes and the people in them, so write it **outside any repository** (here in your home
folder) and never paste it into an issue or a pull request. It lists:

- how many notes of each folder were read, and the folders and files not imported;
- how many records of each kind would be created, and the Proposals planned;
- every field the Tree has no place for, and every value that could not be mapped, by field;
- every link to a missing note, every date that is not valid EDTF, every file that is missing or cannot be read;
- the Persons the Tree will see as Living while the Vault says otherwise (a Person with no dates is Living);
- the Persons whose relation to the family will differ from their Vault tags.

Fix what you want fixed in the Vault, commit, and run the dry run again until you accept what is left.

## 4. Import

Run the same command without `--dry-run`:

```sh
RODOKMEN_URL=https://rodokmen.example RODOKMEN_TOKEN=rdk_ag_… \
pnpm --filter @rodokmen/server cli vault-import --vault ../rodokmen-data --report ~/vault-import-report.md
```

It opens one Import batch named `Vault import <day>`, uploads the scans and documents, and submits the Proposals in
order: the Vault provenance Source, Places, Parishes, Houses and registers, then each Source note with the Persons
and facts it supports, then one Proposal per Person for what no Source note covers.

## 5. Review and accept the batch

In the app, open **Review**. The batch is one entry with its size and progress. Open it, choose **Sample of 20**,
and read a few Proposals in full. When you are satisfied, choose **Accept the whole batch** and confirm: each
Proposal is accepted on its own, in batch order. Any that cannot be accepted stay pending and are listed, with
the ones that build on them; decide those one by one.

## 6. Run again for the Research leads

The Research leads from `plans/` and `log/` link Persons and Places that exist only once the batch is accepted.
Run the import command of step 4 once more: it submits nothing new and creates the leads.

## Later runs

The importer keeps a map from Vault keys to the records it created, on the server. A later run submits only what
is new: a new note becomes a new Proposal, and nothing is created twice. A note changed since it was imported is
listed in the report under **Changed notes**; change those records in the app.

## Afterwards

Freeze the Vault (task 4.3 of `add-vault-import`): a last commit with a note in its README, branch protection or
archiving on GitHub, and agents pointed at the API and the MCP server.
