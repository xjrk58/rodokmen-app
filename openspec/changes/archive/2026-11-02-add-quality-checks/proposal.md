# Proposal

## Why

Two code-quality rounds (#22) found about 150 problems by reading. For each one we checked whether a deterministic tool would have caught it (the table on #21). Most needed judgement, but about fifteen didn't: unused exports and class members, a module reaching into another it shouldn't, a 60-line copy, a few risky code patterns, a fixed wait in a browser test, and three advisories in a dependency. The working rules (AGENTS.md, "Tools before agents") say such problems must not come back. Tools give the same answer every time and cost no tokens; agent reviews stay for what needs judgement.

## What Changes

- **ESLint rules for the patterns that caused real bugs**:
  - no raw `request.url` in the server's sign-in hooks
  - no `z.url()` without a protocol list
  - no `toISOString().slice(0, 10)` for a local calendar day
  - `id-denylist` for words the glossary rejects as identifiers
- **eslint-plugin-playwright** for the browser tests: no fixed waits, no assertions that can't fail.
- **knip**: unused files, exports, dependencies and class members across the workspace.
- **dependency-cruiser**: which parts of the repo may import which:
  - the app never imports server code
  - sign-in, storage and ops code never import the Tree modules
  - shared never imports app or server
  - no circular imports
- **jscpd**: copies of 30 lines or more fail.
- **pnpm audit**: high and critical advisories fail on every PR and on a weekly schedule, because advisories appear without code changes.
- **gitleaks**: secrets in commits fail. It is the same tool the Vault-name guard (#36) builds on locally.
- **Type checking of `server/public/`** (the sign-in pages' scripts) with `checkJs` and `noUncheckedIndexedAccess`.
- One local command, `pnpm check`, runs all of it, and CI runs it in the lint workflow, which already gates deploys.

Out of scope: semgrep (ESLint's `no-restricted-syntax` covers the patterns found, so one tool fewer); SQL linting (no finding needed it); reviewing by agents (it stays for judgement); the local Vault-name denylist (#36).

## Capabilities

### New Capabilities

### Modified Capabilities

None: this changes the development tooling, not what the system does, so the change has no spec deltas (`skip_specs`).

## Impact

- New dev dependencies at the workspace root: knip, dependency-cruiser, jscpd, eslint-plugin-playwright. gitleaks runs as a pinned binary or image in CI.
- New config files: `knip.json`, `.dependency-cruiser.cjs`, `.jscpd.json`, `.gitleaks.toml`, and rules added to `eslint.config.js`.
- `.github/workflows/lint.yml` gains steps, plus a weekly scheduled audit; `deploy.yml` already waits for lint.
- Existing findings are fixed in this change, not baselined, except where a tool supports a baseline that can only shrink, as the ESLint suppressions do.
