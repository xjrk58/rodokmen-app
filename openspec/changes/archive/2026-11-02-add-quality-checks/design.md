# Design

## Context

CI already runs ESLint with type information (with a suppressions file that can only shrink), Prettier, ShellCheck, type checking, the OpenAPI check, LemmaScript proofs and their trace check. The lint workflow gates deploys. The finding-to-tool table on #21 says which further tools would have caught real findings, and only those are added.

## Goals / Non-Goals

**Goals:**
- Every finding class in the #21 table that a tool can catch is caught in CI from now on.
- One command, `pnpm check`, runs the same checks locally as CI does.
- Each tool starts green: existing findings are fixed in this change.

**Non-Goals:**
- No tool for findings marked "needs judgement".
- No new tool where an existing one can be configured to do the job.

## Decisions

### ESLint restrictions instead of semgrep
The raw-`request.url`, `z.url()`-without-protocol and UTC-day patterns are single syntax shapes. ESLint's `no-restricted-syntax` with AST selectors catches them, scoped by file glob (sign-in hooks only for `request.url`; app only for the day pattern). Each restriction's message names the bug it prevents and the correct helper. Semgrep would add a second engine and a Python runtime for three rules.

### knip with workspace config
knip runs over the pnpm workspace with entry points declared per package: the app's `index.html` modules and service worker, the server's `main.ts` and `cli.ts`, shared's index, scripts, and tests. Class members are checked (L16 and the app's dead members). Public exports used only by the LemmaScript specs are entered as explicit `ignoreExportsUsedInFile` or tagged, with a comment pointing to `docs/verification.md`.

### dependency-cruiser rules
`forbidden` rules for the boundaries above, plus `no-circular` and `no-orphans` (warn). The Clock that sat in a Tree module (M5) is the motivating case. The app is plain ES modules and resolves through relative paths, so a plain resolver suffices.

### jscpd threshold
The default minimum (5 lines or 50 tokens) would flag one-line repeats such as LIKE escaping, which the review judged acceptable (M6, L15). A minimum of 30 lines catches the near-copy pickers (about 60 lines) without noise. Tests and generated files are excluded.

### Audit cadence
`pnpm audit --audit-level=high --prod` runs in the lint workflow, and also on a weekly schedule that opens an issue on failure. Dev-only advisories are reported but don't fail.

### gitleaks
gitleaks runs in CI with its default rules over the pushed commits, pinned by version. #36 extends it locally with a private denylist that never reaches CI.

### `pnpm check`
`pnpm check` runs, in order: typecheck, lint (ESLint, ShellCheck), format check, knip, dependency-cruiser, jscpd, audit, the OpenAPI check and the trace check. CI calls the same script, so local and CI can't drift.

## Risks / Trade-offs

- [False positives slow down agents] → every rule's message says how to fix or when to disable, and a disable needs a reason (already enforced by eslint-comments).
- [knip noise from dynamic entry points such as service workers and Playwright] → entries declared explicitly; the first run's findings are fixed or configured, not suppressed wholesale.
- [Audit failures outside our control] → only high and critical production advisories fail; an upgrade PR is the fix.

## Open Questions

None.
