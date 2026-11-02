# How to run the proofs and regenerate the verification page

This guide shows you how to prove the pure rules of the Tree on your computer, how to add a proof for a new rule, and how to keep [`docs/verification.md`](../verification.md) up to date. CI runs the same in the `verify` workflow. Why the rules are proved, and what a proof does not cover, is in [Proofs with LemmaScript](../explanation/proofs.md).

## Install Dafny 4.11

CI pins Dafny 4.11.0 (`.github/workflows/verify.yml`, by release and SHA-256). Download the zip for your system from the [Dafny 4.11.0 release](https://github.com/dafny-lang/dafny/releases/tag/v4.11.0), unpack it, and put its `dafny` folder on your `PATH`. It bundles .NET and Z3. `dafny --version` should print `4.11.0`.

LemmaScript itself comes with `pnpm install`.

## Run the proofs

```sh
pnpm verify
```

It runs `lsc check` over every file in `shared/LemmaScript-files.txt`: it regenerates each file's Dafny (`shared/proofs/src/*.dfy.gen`), checks that the hand-written `.dfy` only adds to it, and has Dafny prove it. Each file ends with a line such as:

```text
Dafny program verifier finished with 17 verified, 0 errors
```

Then run `git status`. If `pnpm verify` changed or created files under `shared/proofs/`, commit them with your code: CI fails when the committed Dafny is not what the TypeScript generates. To regenerate the Dafny of one file only, give that file to `verify:regen` (it takes one file at a time):

```sh
pnpm --filter @rodokmen/shared verify:regen src/rules.ts
```

## Regenerate the verification page

```sh
pnpm verify:trace
```

It rewrites `docs/verification.md` from the `//@ contract` lines and fails when a contract names a requirement that does not exist. To check without writing, as CI does:

```sh
node scripts/verification-trace.mjs --check
```

It prints, for example, `docs/verification.md is up to date: 18 proof(s) of 13 requirement(s).` Commit the page together with the code it describes.

## Prove a new rule

1. Put the rule in a pure function in `shared/src/`: no I/O, no clock, no `await`, no regular expressions. Keep what it cannot model in the code that calls it.
2. Mark the function `//@ verify`, state the requirement's scenarios as `//@ ensures` lines, and name the requirement it proves with `//@ contract <capability>: <Requirement>`, where `<Requirement>` is the exact text after `### Requirement:` in the spec.
3. If the file is new to the proofs, add it to `shared/LemmaScript-files.txt`.
4. Run `pnpm verify` and `pnpm verify:trace`.
5. Break the rule on purpose, see `pnpm verify` fail, and put it back.

Before you write the proof, read the known LemmaScript issues at the end of [`docs/verification.md`](../verification.md#known-lemmascript-issues), and read the generated `.dfy.gen` when a proof surprises you.
