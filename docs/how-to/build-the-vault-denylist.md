# How to build or refresh the Vault-name denylist

This guide shows the Owner how to build the private denylist that keeps names from the Vault out of this public repo, and how to keep it current. The Git hooks check every commit and push against it (AGENTS.md, "Keeping Vault names out"); the file's format and the guard's options are in [Vault denylist format](../reference/vault-denylist.md).

You need a checkout of the Vault (the private `rodokmen-data` repo) and a checkout of this repo with `pnpm install` done, so that the hooks are on.

## Build the list

1. In this repo, fetch `main`, so the build knows which terms are already public: `git fetch origin`.
2. Build the list from the Vault checkout:

   ```sh
   node scripts/vault-guard.mjs --build-from-vault ~/src/rodokmen-data
   ```

   It writes `~/.config/rodokmen/vault-denylist.txt`, readable by you only, and prints counts, never names:

   ```text
   vault-guard: wrote /home/you/.config/rodokmen/vault-denylist.txt: generated <n> people, <n> places, <n> documents; kept <n> manual and <n> never-block terms.
   vault-guard: left out as already in origin/main: <n> people, <n> places, <n> documents; <n> notes yielded no name. Both are listed in the file.
   ```

3. Audit what is already public against the new list:

   ```sh
   node scripts/vault-guard.mjs --range origin/main --require-list
   ```

   It exits 0 when no listed name is in any commit, file name or message up to `origin/main`. `--require-list` makes it fail if it cannot find the list.

If you keep the list elsewhere, build it with `--out <file>` and set `RODOKMEN_DENYLIST=<file>` in the environment your Git hooks run in. To block surnames on their own too, add `--include-surnames`; expect false alarms, as many surnames are common words or other families' names.

## Refresh it

Rebuild the same way, after `git fetch origin`, when the Vault gains notes or `main` gains text. A rebuild replaces the generated sections and keeps your `manual` and `never-block` sections as they are.

Terms that already appear in `origin/main` are left out of the blocked terms and listed as comments in the `generated left-out` section. To block one anyway, copy it into `manual`.

## Block or unblock a term by hand

- To block a term the Vault does not yield, add it on its own line under `# == manual ==`.
- To stop a generic word from blocking, add it under `# == never-block ==`.

The next check uses the file as it is; there is nothing to rebuild.

## When the build refuses

The build writes nothing and exits 2 when:

- the path is not a Vault checkout (it has no `people/` or `places/` folder): give the Vault's root folder;
- there is no `origin/main`: run `git fetch origin` in this repo;
- the existing list has terms outside any section (an older format): move it away, rebuild, then copy your own additions into `manual`.

Notes that yielded no name are listed as comments in the `generated unnamed` section. Fix their frontmatter in the Vault and rebuild.

## When the guard blocks a commit or push

The hook names each file and line with the term it found. Replace the name with an invented one, then commit again; never bypass the hook. If the term is a false alarm, such as an ordinary word that is also a Place, add it under `never-block`.

To check an issue or PR text before posting it, pipe it through the guard: `node scripts/vault-guard.mjs --text - < body.md`.
