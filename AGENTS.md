# Working on Rodokmen

These rules apply to every person and agent working in this repo.

## Backlog first

Never start implementing anything unless it is really small. Put everything else in the backlog and wait.

- **Really small** means a clear defect fixed, or exactly what was asked, in a few lines of one or two files, with no new behaviour and no spec change. When in doubt, it is not small.
- **The backlog** is OpenSpec: write the change with `/opsx:propose` (proposal, specs, design where needed, tasks), validate it with `openspec validate <change> --strict`, push it on a branch and open a PR.
- **Implementation** of a backlog change starts only when the Owner says so for that change (`/opsx:apply <change>`). A plan, a suggestion or an earlier "yes" to the design is not that go-ahead.

## Conventions

- Use the terms in [`GLOSSARY.md`](GLOSSARY.md) exactly; decisions are in [`docs/adr/`](docs/adr/).
- This repo is public: never put family data, real people's names or research notes in it. Examples use invented people.
- Pure rules are proved with LemmaScript and traced to their requirement (ADR 0009, [`docs/verification.md`](docs/verification.md)).
- Work on a branch and open a PR; `main` changes only through merged PRs.
