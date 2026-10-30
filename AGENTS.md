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

- Checks run as tools in CI: type checking, ESLint, Prettier, ShellCheck, the OpenAPI check, LemmaScript proofs and the trace check. Fix what they report with their own autofix where they have one.
- When a review by an agent finds a problem a tool could have caught, the fix includes that tool or rule (as a backlog change if it is not really small), so the same problem cannot come back.
- Agent reviews are for what tools cannot judge: logic, design, and whether the code does what the spec says.

## Keeping Vault names out

The Owner's research lives in a private Vault (ADR 0010). Its names must never reach this repo, its issues or its PRs, all of which are public.

- **Hooks:** `pnpm install` sets `core.hooksPath` to `.githooks`. The pre-commit and pre-push hooks run `scripts/vault-guard.mjs` against a private denylist and refuse changes, file names or commit messages containing a listed name.
- **Issues and PRs:** before posting text to GitHub, check it with `node scripts/vault-guard.mjs --text -` (text on stdin).
- **The denylist** is never committed. It lives at `~/.config/rodokmen/vault-denylist.txt`, or wherever `$RODOKMEN_DENYLIST` points. The Owner builds it from a Vault checkout with `node scripts/vault-guard.mjs --build-from-vault <path>`. The result holds full names, Places and document names, minus terms already public in this repo. Edit it freely.
- **Without a denylist** the guard warns and passes, so contributors without the Vault aren't blocked. CI can't see the list, so it only tests the guard itself.

## Conventions

- Use the terms in [`GLOSSARY.md`](GLOSSARY.md) exactly; decisions are in [`docs/adr/`](docs/adr/).
- This repo is public: never put family data, real people's names or research notes in it. Examples use invented people.
- Pure rules are proved with LemmaScript and traced to their requirement (ADR 0009, [`docs/verification.md`](docs/verification.md)).
- Work on a branch and open a PR; `main` changes only through merged PRs.
