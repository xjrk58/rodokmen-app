# How to work on a change

This guide shows you how to take a piece of work from the GitHub backlog to a merged pull request, with OpenSpec for anything that changes behaviour. The rules behind it are in [AGENTS.md](../../AGENTS.md); read them once.

## 1. Find or open the issue

Every piece of work has one issue in this repo, written so that an agent can start cold: why, what, links to the OpenSpec change and ADRs, how it is verified, and what it depends on. Labels: `change` (an OpenSpec change), `task`, `bug`, `decision` (needs the Owner to choose), `owner-action` (needs the Owner's accounts or hands), `go` (the Owner's go-ahead) and `in-progress`.

- If the work is not in the backlog yet, open an issue and stop there.
- If it is really small (a clear defect, or exactly what was asked, in a few lines of one or two files, with no new behaviour and no spec change), you may do it without waiting.
- Otherwise, start only when the issue has the `go` label or the Owner asked for it explicitly.

Read the issue and every comment on it; the Owner's comments override the issue text. Add `in-progress` while you work on it.

## 2. Write or check the OpenSpec change

Work that changes behaviour has an OpenSpec change in `openspec/changes/<change>/`: a proposal, specs with the requirements, a design where needed, and tasks. If it has none yet, write it with `/opsx:propose`, link it from the issue, and wait for the go-ahead.

Validate it:

```sh
OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@1.15.0 validate <change> --strict
```

Each task names how it is verified, and one task updates the docs ([below](#4-update-the-docs)).

## 3. Implement it on a branch

```sh
git fetch origin && git switch -c feat/<short-name> origin/main
```

Work through `tasks.md` with `/opsx:apply`, ticking each task once it is verified the way it says. Use the [glossary](../../GLOSSARY.md) terms exactly, and invented people in every example and test. New work you find along the way becomes a new issue, not part of this branch.

Depending on what you changed:

- the API: `pnpm --filter @rodokmen/server openapi` regenerates `server/openapi.json`;
- a proved rule: [run the proofs and regenerate the verification page](run-the-proofs.md);
- the architecture: [regenerate the C4 diagrams](regenerate-the-c4-diagrams.md);
- files of the app: `node app/scripts/stamp-version.mjs`.

## 4. Update the docs

Change the page in the right [Diátaxis](https://diataxis.fr) section of [`docs/`](../README.md): a tutorial when the first steps change, a how-to guide for a task, reference for a command, setting, file or the API, explanation for a reason. List a new page in [`docs/README.md`](../README.md) with one line. If what works changes, update the [README](../../README.md) too.

## 5. Run the checks

```sh
pnpm lint            # ESLint, ShellCheck and the docs check
pnpm format:check    # Prettier; pnpm format fixes it
pnpm build && pnpm typecheck
TEST_DATABASE_URL=postgres://rodokmen:rodokmen@localhost:5432/rodokmen_dev pnpm test
```

The tests need PostgreSQL 16 with PostGIS and a role that may create databases, such as the container from the [tutorial](../tutorials/first-proposal.md); each run creates and drops its own databases. The app's browser tests need Chromium for Playwright: `pnpm --filter @rodokmen/app exec playwright install chromium`.

## 6. Push and open the pull request

1. Commit and push. The Git hooks check every commit for names from the Vault; never bypass them.
2. Write the pull request's description with `Closes #<issue>`, and check it before posting: `node scripts/vault-guard.mjs --text - < body.md`.
3. Open the pull request: `gh pr create --base main --body-file body.md`.
4. Comment on the issue with the result and the PR's link, or with a question you cannot answer.

`main` changes only through merged pull requests. After the merge, once every task of the OpenSpec change is done, archive it with `/opsx:archive`.
