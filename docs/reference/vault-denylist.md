# Vault denylist format

The Vault-name guard, `scripts/vault-guard.mjs`, keeps names from the Owner's private Vault out of this public repo, its issues and its pull requests. It checks text against a private denylist. The names in this page are invented.

## Where the file is

`$RODOKMEN_DENYLIST`, else `~/.config/rodokmen/vault-denylist.txt`. The file is never committed. A build writes it readable by its owner only (mode 600, folder 700).

Without the file, every check prints a warning and passes, so contributors without the Vault are not blocked; with `--require-list` it fails instead.

## Lines

- One term per line.
- `#` starts a comment, anywhere on a line.
- A line `# == <name> ==` starts a section; text after the closing `==` is a description.
- Blank lines are ignored.

## Sections

| Section               | Written by | On rebuild | Holds                                                                                                                                                                  |
| --------------------- | ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manual`              | the Owner  | kept       | terms always blocked                                                                                                                                                   |
| `never-block`         | the Owner  | kept       | terms never blocked, even when another section lists them                                                                                                              |
| `generated people`    | the build  | replaced   | full names of Persons both ways round ("Given Surname" and "Surname Given"), birth surnames included, and full-name variants; surnames alone with `--include-surnames` |
| `generated places`    | the build  | replaced   | Place names, in every language the Vault gives                                                                                                                         |
| `generated documents` | the build  | replaced   | base names of the files in the Vault's `attachments/documents/`                                                                                                        |
| `generated left-out`  | the build  | replaced   | as comments: Vault terms already in `origin/main`, so not blocked                                                                                                      |
| `generated unnamed`   | the build  | replaced   | as comments: Vault notes that yielded no name                                                                                                                          |

The build reads Persons from the frontmatter of the Vault's `people/*.md`, Places from `places/*.md`, and document names from `attachments/documents/`. A list with terms outside any section (an older format) is not rebuilt.

Example, with invented names:

```text
# == manual == Your own additions: always blocked.
Bohumil Zrzavý
# == never-block == Terms never blocked, even when the Vault yields them (generic words).
Horní
# == generated people == Full names both ways round.
Ottilie Zrzavá
Zrzavá Ottilie
# == generated places == Place names; not checked in app/data/.
Horní Plachtín
```

## Matching

- Case, diacritics and punctuation are ignored: `Bohumil Zrzavý` matches `bohumil-zrzavy.md` and `ZRZAVÝ, Bohumil`.
- A term matches only as whole words.
- A term also matches when it is broken across lines.
- Terms shorter than 4 letters or digits, once folded, are ignored.
- Place terms are not checked in the public reference data in `app/data/`, which holds every Czech place name.
- Third-party code and the lockfile are never checked: `vendor/`, `node_modules/`, `pnpm-lock.yaml`.

## The guard's options

```text
node scripts/vault-guard.mjs --staged | --range REVS | --pre-push REMOTE | --text FILE|- [--require-list]
node scripts/vault-guard.mjs --build-from-vault PATH [--out FILE] [--include-surnames]
```

| Option                    | Checks or does                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--staged`                | the staged changes: added lines and file names (the pre-commit hook)                                                                                       |
| `--range A..B`            | each commit of the range: added lines, file names and messages                                                                                             |
| `--range REV`             | each commit of the whole history up to `REV`                                                                                                               |
| `--pre-push REMOTE`       | what a push publishes: every commit not yet on `REMOTE`, the pushed branch and tag names, tag messages (the pre-push hook; reads Git's ref lines on stdin) |
| `--text FILE`, `--text -` | a file, or text on stdin, such as an issue or PR body before posting it                                                                                    |
| `--require-list`          | with a check: fail when there is no denylist                                                                                                               |
| `--build-from-vault PATH` | writes the denylist from a Vault checkout, leaving out terms already in `origin/main` (fetch first)                                                        |
| `--out FILE`              | with a build: write there instead of the default path                                                                                                      |
| `--include-surnames`      | with a build: also block each surname alone                                                                                                                |

A hit prints the file and line (or the commit) with the term, and the advice to replace it with an invented name.

Exit codes: 0 clean; 1 a listed term was found; 2 a usage error, a Git error, a refused build, or no denylist with `--require-list`.

The Git hooks in `.githooks/` run `--staged` before each commit and `--pre-push` before each push; `pnpm install` turns them on (`core.hooksPath`).
