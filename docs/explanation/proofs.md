# Proofs with LemmaScript

A few rules decide things that must never quietly go wrong: who may accept a Proposal, what an Agent may do, who counts as Living, who counts as family. Tests check such a rule on the cases someone thought of. Rodokmen also proves these rules for every input (ADR 0009). This page explains how, what that buys, and where it stops.

## Which rules are proved

The proved rules are pure functions in `shared/src/`: no database, no clock, no network, no `await`, no regular expressions. Today they are:

- who may decide on Proposals, and what each role may do (`mayDecide`, `mayDo`);
- that a Proposal carries evidence, when it conflicts with the current Tree, and when an undo is blocked;
- the hourly window of an Agent's rate limit;
- who is Living, and the date ranges of uncertain dates (EDTF);
- the relation to the family.

[`docs/verification.md`](../verification.md) lists each proof with the requirement it proves.

## How a proof works

The specification is written next to the code, as `//@` lines in the TypeScript: `//@ ensures role === 'agent' && action === 'accept' ==> !\result`, for example, says an Agent never accepts. LemmaScript translates the function and its specification into Dafny, and Dafny, with the Z3 solver, proves that the code meets the specification for every possible input. CI fails if it cannot.

Each proved function also names the OpenSpec requirement it proves, with `//@ contract <capability>: <Requirement>`. A script checks every such name against the specs, and generates the verification page from them. So a proof cannot drift away from the requirement it was written for without CI noticing, and a reader can go from a requirement to the code that is proved to meet it.

## Why prove, not only test

Proofs are expensive to write, so Rodokmen spends them only where a mistake would be costly and hard to notice. A wrong permission does not crash anything; it just lets an Agent do what it should not, until someone happens to look. A wrong Living rule exposes a living cousin in an Export. These rules are small and pure, which is what makes them practical to prove.

Writing the specification has a second benefit: it states the requirement's scenarios precisely, as properties of the code. Vague requirements show up quickly when they have to be written that way.

## The shell around the proofs

Real code needs what proofs cannot model: reading the database, the current date, parsing text with regular expressions. That code stays in a thin unverified shell that gathers the inputs, calls the proved function, and acts on its answer. The shell is covered by tests, not proofs. For example, the server's code that collects Family links and Citations for the relation rule, and the wiring that makes every API route ask `mayDo`, are tested.

Where the shell calls a proved function, the function's preconditions are assumed rather than proved. The verification page lists each such assumption, so the gap is visible.

## Where the proofs stop

A proof is only as good as what it trusts:

- **LemmaScript's translation.** It is a tech preview with known bugs, one of which can make a false property verify. The known issues are listed in the verification page, the code avoids them, and the generated Dafny is committed and read in review.
- **Dafny and Z3**, pinned by version in CI.
- **The model.** In the proofs, numbers are mathematical integers with no overflow or floating point, and strings are sequences of characters.
- **The specification.** A proof shows the code meets its `//@` lines, not that those lines say what the family needs. That is why they are written to follow the requirement's scenarios, and reviewed.

Some properties are proved only in part; the verification page says exactly what, under "Scope". Everything assumed rather than proved is kept to a minimum and listed there.

How to run the proofs and add one is in [How to run the proofs](../how-to/run-the-proofs.md).
