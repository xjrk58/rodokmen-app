# How to fix a failed check

This guide shows you how to find out why `pnpm check` (or the lint workflow) failed, fix it, and keep the records of known findings in step. What each check looks at, and its configuration: [Code checks](../reference/checks.md).

## Run the checks

```sh
pnpm check
```

It ends with a summary such as:

```text
pnpm check: 10 of 11 passed in 41 s
  ok    typecheck              5.8 s
  FAIL  knip                   3.3 s
```

Scroll up to the failed check's output, or run that check alone with the command in its line of the [reference](../reference/checks.md#pnpm-check). In GitHub Actions, open the lint job and expand the failed check's group.

## Fix the finding

First try the tool's own fix, then fix the code by hand. Do not turn a rule off to get green: a rule is turned off for one line only with the reason next to it (`// eslint-disable-next-line <rule> -- <reason>`).

- **typecheck**: fix the types. Narrow a value with a check, not a cast.
- **ESLint**: run `pnpm exec eslint --fix .`, then do what each remaining message says. The messages of the rules added for past bugs name the safe way:
  - in `server/src/auth/`, decide by `request.routeOptions.url` and `.config`, not `request.url`;
  - give `z.url()` a protocol list, `z.url({ protocol: /^https?$/ })`, or use `WebUrl` from `shared/src/schemas/common.ts` (`z.httpUrl()` refuses `localhost`);
  - in the app, take today's date from `today()` in `app/src/proposal-build.js`, not from `toISOString()`;
  - in a browser test, wait for what the page shows (`await expect(locator).toHaveText(…)`), not for a time; to check that nothing changes, install the page's clock (`page.clock.install()`) and run it on (`page.clock.runFor(ms)`); for a screenshot, pass `animations: 'disabled'`.
- **ShellCheck**: open the wiki page of the reported code, such as `https://www.shellcheck.net/wiki/SC2086`, and change the script as it says.
- **docs check**: fix the link, or add the new page's line to `docs/README.md`.
- **Prettier**: run `pnpm format`.
- **knip**: run `pnpm knip --fix` and read its changes in `git diff`: it removes unused dependencies and the `export` of unused exports. Then delete what is now unused (ESLint names it), and run `pnpm install` if `package.json` changed. If only the proofs use an export, add `@public` to its JSDoc with a pointer to `docs/verification.md`.
- **dependency-cruiser**: move what both sides need into a module of its own that neither side's rule forbids (as `server/src/clock.ts` serves sign-in and the Tree). For a cycle, move the shared part out of the modules in the cycle.
- **jscpd**: make one function or module of the two copies and call it from both places.
- **pnpm audit**: upgrade the package named in the advisory, in a pull request: `pnpm update <package>` (with `--filter <package>` for a workspace package), or, for a package another one pulls in, an override in `pnpm-workspace.yaml`. Then run `pnpm check` again.
- **OpenAPI check**: run `pnpm --filter @rodokmen/server openapi` and commit `server/openapi.json`.
- **trace check**: fix the `//@ contract` line it names, then run `pnpm verify:trace` and commit `docs/verification.md`.
- **gitleaks** (lint workflow, or `pnpm gitleaks`): take the secret out of the commits before you push them (`git rebase -i` and amend, or a new branch from `main`). If a secret was pushed, revoke it first. If the finding is not a secret, see the last section.

## Update a record of known findings

When your change fixes a finding that was recorded, the check fails until you prune the record:

```sh
pnpm exec eslint --prune-suppressions .   # eslint-suppressions.json
pnpm depcruise:baseline                   # .dependency-cruiser-known-violations.json
```

Commit the smaller file with the fix. Never add a finding to either file: the records hold only what was there when the rule came in.

## Add an exception for a false positive

When a tool reports something that is not a problem, configure the exception as narrowly as the tool allows, with the reason next to it:

- ESLint: a disable comment on that one line, with `-- <reason>`.
- knip: an entry in `knip.jsonc` (`ignoreDependencies`, `ignoreMembers`, an `entry`) with a comment.
- dependency-cruiser: a `pathNot` in the rule in `.dependency-cruiser.cjs`, with a comment.
- gitleaks: an `[[allowlists]]` entry in `.gitleaks.toml` with a `description`, matching the path and the value together (`condition = "AND"`).

Then run `pnpm test:scripts`: it checks that each check still fails on the bug it was added for.
