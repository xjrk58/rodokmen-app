# How to import the Vault

This guide takes the Owner through importing the Vault (the `rodokmen-data` repository) into the Tree once, as
one Import batch of Proposals. The importer is a client of the server's API with an Agent token: everything it
submits is reviewed and logged like any Agent's Proposal, and nothing changes in the Tree until the Owner accepts
it. Why the Vault comes in once and then freezes: [ADR 0010](../adr/0010-import-the-vault-once-and-freeze-it.md);
why a batch is reviewed as one entry: [Import batches](../explanation/proposals-and-review.md#import-batches). The
command's options and the routes it calls: [Commands](../reference/cli.md#the-vault-importer) and
[the API](../reference/api.md#routes).

## Before you start

- The server is running and you can sign in as the Owner.
- A checkout of `rodokmen-data` on your computer, at the commit you want to import.
- This repository with its dependencies installed (`pnpm install`), on the same computer.
- LibreOffice (`soffice`) on the PATH, to convert DOC files to PDF. Without it, each DOC is reported and left out.

## 1. Create the importing Agent

In the app, open **Settings → Agents**, create an Agent named `Vault importer`, and issue a token ([Connect an AI
assistant](connect-an-assistant.md) shows the screen). Copy the token
(`rdk_ag_…`): it is shown once. Its requests to its Import batches count against a limit of 10,000 an hour of
their own, so the whole Vault fits in one run.

## 2. Mark the Family roots

On the person pages of the couple the family descends from, choose **Mark as Family root**
([Mark Family roots](mark-family-roots.md)). You can only do this
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
- every field the Tree has no place for, and every value that could not be mapped, by field (the import keeps them
  as lines below the research notes of their record, or in a register entry's Citation note);
- every link to a missing note, every date that is not valid EDTF, every file that is missing or cannot be read;
- the Persons presumed dead, with the bound on their birth: they have no dates of their own, but their marriages and
  their relatives' dates prove them born more than 125 years before the run, so they get a death Event without a date
  (shown as "†");
- the Persons the Tree will see as Living while the Vault says otherwise (a Person with no dates is Living, unless a
  death is presumed);
- the Persons whose relation to the family will differ from their Vault tags;
- the marriages both spouses record without a Source note but with different dates or Places, which become two
  Events.

Fix what you want fixed in the Vault, commit, and run the dry run again until you accept what is left.

## 4. Import

Run the same command without `--dry-run`:

```sh
RODOKMEN_URL=https://rodokmen.example RODOKMEN_TOKEN=rdk_ag_… \
pnpm --filter @rodokmen/server cli vault-import --vault ../rodokmen-data --report ~/vault-import-report.md
```

It opens one Import batch named `Vault import <day>`, uploads the scans and documents, and submits the Proposals in
order: the Vault provenance Source, Places, Parishes, Houses and registers, then each Source note with the Persons
and facts it supports (in parts when a note is too big for one Proposal, as a long register index is), then
one Proposal per Person for what no Source note covers.

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

A later run also brings what a newer importer makes of notes already imported, attached to the records already in
the Tree. An import made before #133 gave a fact that cites a register note directly only the Vault's Citation;
the next run gives each such Person note a small Proposal that adds the register's Citation to their Events. Accept
the run's batch as in step 5. Those Events then carry a Citation at the Person's confidence, so a probable or
confirmed parent or partner link no longer makes anyone a Possible relative. An Event whose Proposal is still pending
waits, listed in the report, until a run after it is accepted.

An import made before #132 presumed no deaths. The next run adds a death Event without a date to each Person the
bounds prove born more than 125 years ago, in a small Proposal per Person, so the Tree stops treating them as Living. A
Person you have since given a death, burial or birth date in the app is left out and listed under **Presumed deaths left
out**.

An import made before #134 left out the fields the Tree has no place for, such as a Person's occupation. The next run
adds them below the research notes of each record whose notes still hold exactly what that import wrote, in a small
Proposal per record. Notes you changed in the app since are left as they are, and the report lists their lines under
**Fields not mapped, on records imported before #134**. It also lists the evidence classes of register entries,
which belong in their Citation's note: no Proposal can change that without new evidence yet (#157).

An import made before #136 kept the first 4,000 characters of a long log or plan note in its Research lead. The
next run gives such a lead the whole note, if the lead still holds exactly what that run wrote. A lead you changed
in the app since is left as it is and listed in the report under **Research leads**: add the rest of the note by
hand if you want it.

An import made before #149 gave a marriage both spouses record without a Source note two Events, one from each
spouse's note. The next run attaches the second note's Citation to the first Event, and the report lists each such
pair under **Marriage Events imported twice**, with the Event to keep and the other one. The app cannot merge two
Events yet (#154), so leave the other one for now: it does no harm, as the partner link rests on both.

## Afterwards

Freeze the Vault (task 4.3 of [`add-vault-import`](../../openspec/changes/add-vault-import/tasks.md)): a last
commit with a note in its README, branch protection or archiving on GitHub, and agents pointed at the API and the
[MCP server](connect-an-assistant.md).
