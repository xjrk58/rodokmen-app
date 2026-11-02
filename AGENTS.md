# Working on Rodokmen

These rules apply to every person and agent working in this repo.

## Backlog first

Never start implementing anything unless it is really small. Put everything else in the backlog and wait.

- **Really small** means a clear defect fixed, or exactly what was asked, in a few lines of one or two files, with no new behaviour and no spec change. When in doubt, it is not small.
- **The backlog** lives in GitHub issues of this repo (see below). Work that changes behaviour also gets an OpenSpec change: write it with `/opsx:propose` (proposal, specs, design where needed, tasks), validate it with `openspec validate <change> --strict`, and link it from its issue.
- **Implementation** of a backlog item starts only when the Owner gives the go-ahead for that item: the `go` label on its issue, or an explicit request. A plan, a suggestion or an earlier "yes" to the design is not that go-ahead.

## Backlog on GitHub

Issues in this repo are written for agents; humans steer them with comments.

- **One issue per backlog item.** It holds the context an agent needs to start cold: why, what, links to the OpenSpec change and ADRs, how it is verified, and what it depends on.
- **Labels:** `change` (an OpenSpec change), `task` (smaller work), `bug`, `decision` (needs the Owner to choose), `owner-action` (needs the Owner's accounts or hands), and `go` (the Owner's go-ahead to implement).
- **Before starting**, an agent reads the issue and every comment on it; human comments override the issue text. It works on a branch, opens a PR that says `Closes #<n>`, and comments on the issue with the result or with a question it can't answer.
- **New work found along the way** becomes a new issue, not part of the current PR.

## Tools before agents

For code quality, use a deterministic, reliable tool wherever one can do the job, and an agent only where judgement is needed. Tools give the same answer every time and cost no tokens.

- **Run `pnpm check` before you push.** It runs the checks listed below in that order, as the lint workflow does in CI (deploys wait for it), and ends with a summary. CI also runs gitleaks over the new commits (`pnpm gitleaks` locally) and the LemmaScript proofs (`pnpm verify`, which needs Dafny).
- Fix what a check reports with its own autofix where it has one, otherwise in the code. Never weaken a rule to get green: a rule is turned off for one line only with the reason next to it, and an exception in a tool's configuration carries its reason there.
- Known findings are recorded only where the tool lets the record shrink and never grow: `eslint-suppressions.json` and `.dependency-cruiser-known-violations.json`. A recorded finding that no longer occurs fails the check until you prune the record (commands below).
- `scripts/test/quality-checks.test.mjs` (`pnpm test:scripts`) feeds each check the bug it was added for, so a configuration change cannot switch one off unnoticed.
- When a review by an agent finds a problem a tool could have caught, the fix includes that tool or rule (as a backlog change if it is not really small), so the same problem cannot come back.
- Agent reviews are for what tools cannot judge: logic, design, and whether the code does what the spec says.

The checks, in the order `pnpm check` runs them, and how to fix what they find:

- **typecheck**: type errors in server/, shared/ and the app's JSDoc. Fix the types; narrow with a check, not a cast.
- **ESLint**: promises nobody awaits, `any` and unchecked casts, and the shapes of past bugs: `request.url` in the sign-in hooks, `z.url()` without a protocol, a day from `toISOString()` in the app, Leaflet content as HTML, words GLOSSARY.md rejects, fixed waits in browser tests. Run `pnpm exec eslint --fix .`, then do what the message says. After fixing a recorded finding, `pnpm exec eslint --prune-suppressions .`.
- **ShellCheck**: shell script mistakes. Follow the wiki page of the SC code.
- **Prettier**: layout. Run `pnpm format`.
- **knip**: unused files, exports, dependencies and class members. `pnpm knip --fix` removes unused exports and dependencies (check its changes); then delete what that leaves unused. An export only the proofs use gets `@public` in its JSDoc.
- **dependency-cruiser**: imports across a boundary (app to server; sign-in, storage and ops to the Tree modules; shared to app or server) and circular imports. Move what both sides need into a module of its own, as `server/src/clock.ts`. After removing a recorded cycle, `pnpm depcruise:baseline`.
- **jscpd**: copies of 30 lines or more. Make one function or module of them.
- **pnpm audit**: high or critical advisories in production dependencies (also weekly, as an issue). Upgrade the package in a PR: `pnpm update <package>`, or an override in `pnpm-workspace.yaml` for a transitive one.
- **OpenAPI check**: the routes and `server/openapi.json` disagree. Run `pnpm --filter @rodokmen/server openapi` and commit the file.
- **trace check**: a proof traced to no requirement, or `docs/verification.md` out of date. Fix the `//@ contract` line; `node scripts/verification-trace.mjs` rewrites the file.
- **gitleaks** (CI, not `pnpm check`): secrets in commits. Take the secret out of the commits before pushing, and revoke one that was pushed. A false positive gets a reasoned exception in `.gitleaks.toml`.

## Keeping Vault names out

The Owner's research lives in a private Vault (ADR 0010). Its names must never reach this repo, its issues or its PRs, all of which are public.

- **Hooks:** `pnpm install` sets `core.hooksPath` to `.githooks`. The hooks run `scripts/vault-guard.mjs` against a private denylist. Pre-commit refuses added lines and file names with a listed name. Pre-push checks every commit not yet on the remote one by one (lines, file names, messages), and the names of the pushed branches and tags. Never bypass them.
- **Issues and PRs:** before posting text to GitHub, check it with `node scripts/vault-guard.mjs --text -` (text on stdin). To audit history, run `node scripts/vault-guard.mjs --range origin/main`.
- **The denylist** is never committed. It lives at `~/.config/rodokmen/vault-denylist.txt`, or wherever `$RODOKMEN_DENYLIST` points. The Owner builds it from a Vault checkout with `node scripts/vault-guard.mjs --build-from-vault <path>` after a `git fetch`. It holds full names both ways round ("Given Surname", "Surname Given"), Places and document names, minus terms already in `origin/main`. Those are listed as comments in the file. `--include-surnames` adds surnames alone, which is off by default.
- **Editing the denylist:** add your own terms under `# == manual ==` and terms that must never block under `# == never-block ==`. A rebuild keeps both sections and replaces only the generated ones. Matching ignores case, diacritics and punctuation, and also finds a name broken across lines.
- **Without a denylist** the guard warns and passes, so contributors without the Vault aren't blocked. CI can't see the list, so it only tests the guard itself.

## Conventions

- Use the terms in [`GLOSSARY.md`](GLOSSARY.md) exactly; decisions are in [`docs/adr/`](docs/adr/).
- This repo is public: never put family data, real people's names or research notes in it. Examples use invented people.
- Pure rules are proved with LemmaScript and traced to their requirement (ADR 0009, [`docs/verification.md`](docs/verification.md)).
- Work on a branch and open a PR; `main` changes only through merged PRs.
