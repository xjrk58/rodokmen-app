// The hand-written texts of docs/verification.md, read by scripts/verification-trace.mjs.

// Shapes that lemmascript 0.6.5 translates wrongly or not at all (listed in docs/verification.md).
export const KNOWN_ISSUES = [
  `**Unsound: swapped comparison.** When a narrowed optional is the right operand of \`<\`, \`<=\`, \`>\` or \`>=\`, the
  Dafny puts it on the left. In code: \`best === null || x < best\` becomes \`best < x\`. In a spec:
  \`xs[i] !== null ==> k <= xs[i]\` becomes \`xs[i] <= k\`, so a false property can verify. Keep optionals out of
  verified comparisons, or write the optional on the left (\`best > x\`).`,
  `**Cross-file contracts lose their helpers.** A call into another file becomes an axiom carrying the callee's
  contract, but functions that contract mentions (from the callee's own file, or named only in \`//@\` lines)
  are not emitted, and Dafny reports an unresolved identifier. Keep a verified call graph in one file, or
  give cross-file callees contracts that mention only their parameters.`,
  `**Constant objects.** \`as const\` objects are not emitted, and \`Record<Union, number>\` constants get string keys
  (a Dafny type error). Pass such constants in as parameters.`,
  `**Disjunctive narrowing in specs.** \`a === null || a.f === null ==> P\` does not narrow \`a\`; write
  \`a === null ==> P\` and \`a !== null && a.f === null ==> P\`.`,
  `**Calls in \`?:\` branches** are lifted out and run unconditionally in the model. That is harmless for pure,
  total functions (at worst a proof fails), but their \`requires\` must hold on both branches.`,
  `**Regular expressions** cannot be extracted: put \`//@ skip\` before a regex constant.`,
  `**\`lsc regen\`** does not batch: give it the file (\`pnpm --filter @rodokmen/shared verify:regen src/x.ts\`).`,
  `**\`unknown\`** becomes an opaque type without \`null\`: a function that returns \`null\` as an \`unknown\` cannot be
  translated. Mark it \`//@ extern\` (as \`valueOf\` in rules.ts), so the proofs treat it as an unknown function.`,
  `**Narrowing after an early \`=== null\` return** makes a later \`!== null\` test of the same variable a Dafny type error.`,
  `**\`splice\`** is not supported: write \`[...a.slice(0, i), x, ...a.slice(i)]\`.`,
  `**Existential goals (Dafny).** Dafny proves "there is a …" only when a witness is already a term in the proof, and it
  rarely finds one inside a loop invariant. Name such a property with a \`.some(...)\` predicate (\`isBlocking\`,
  \`hasProposal\` in rules.ts), so that it is proved from the element at hand, and give \`.dfy\` hints (\`var x :| …\`)
  when a proof chains several.`,
];

// What was checked by hand for the unsound shape above (KNOWN_ISSUES[0]); recheck when adding a proof.
export const SWAP_CHECK = [
  'Checked for the swapped comparison: in every `//@ verify` function of shared/src/edtf.ts, shared/src/gaps.ts,',
  'shared/src/leads.ts, shared/src/living.ts, shared/src/relation.ts and shared/src/rules.ts, no narrowed optional is an',
  'operand of `<`, `<=`, `>` or `>=`, in code or in a specification (optionals occur only in `===` and `!==`, where order',
  'does not matter; the `!` index reads of relation.ts and gaps.ts compare two plain integers, emitted in their order;',
  'gaps.ts and leads.ts have no optionals at all: unknown years and Sources are a flag and 0, or the empty string), and',
  'the generated `.dfy.gen` was read for it. Recheck this, and read the `.dfy.gen`, whenever a proof is added or changed.',
];

// Exactly what a proof covers where that is less than its requirement, written by hand: update it with the proof.
export const SCOPES = [
  `**The gap finder** (\`suggestGaps\`, shared/src/gaps.ts; research-leads "Gap finder suggests leads"). Proved, for any
  Persons, marriages, registers, decided keys and margin: every suggestion is a real gap of its kind (a Relative with no
  birth or baptism Citation; a Relative with unknown parents and a known Parish and years; a Relative's marriage with
  no Citation), with a register of the right kind, Parish and years that fits it, or with none when no register fits;
  every key is the stable key of its kind, subject and Source; no dismissed or accepted key is suggested ("Dismissed
  suggestion"); every gap with a fitting register and an undecided key is suggested with that register and the years
  both cover ("Missing baptism": born about 1801, a register for 1784–1820, the years 1798–1804), and every gap with no
  fitting register on its own. Not proved: the inputs the server gathers (server/src/leads/gaps.ts: who is a Relative,
  which Events have Citations, the Parishes of the Place in the years, the years from EDTF dates, the registers' Parish,
  kinds and years), the archive a suggestion names (its register's, else the archive lookup of the Place's
  Municipality), that suggestions are recomputed nightly and after each accepted Proposal for the Persons it touched,
  and that they are shown apart from the leads until a Member decides; server/test/gap-finder.test.ts tests those.`,
  `**Leads answered by a Proposal** (\`leadsOnAccept\`, \`leadsOnUndo\`, shared/src/leads.ts; research-leads "Findings link
  back to leads"). Proved: accepting marks exactly the leads the Proposal names as found, linked to it, and leaves the
  others as they were; undoing reopens exactly the leads it marked found that nobody closed otherwise since, and leaves
  every other lead, one found by hand or through another Proposal included. Not proved: that the server applies them in
  the transaction of every accept and undo and never on a rejection; server/test/leads.test.ts tests that.`,
  `**Leads in an Export** (\`exportedPersonLinks\`, shared/src/leads.ts; exports "Living people are reduced in every
  Export"). Proved for one lead's links to Persons: no link to a Living person is kept, every other link is, and a lead
  that concerned Living people only is left out. The Export itself is not built yet (add-exports-and-erasure); its entry
  for leads is server/src/leads/export.ts, which marks who is Living with the proved Living rule and is tested in
  server/test/leads.test.ts. Erasure is to use the same rule (\`living\` meaning the erased Person).`,
  `**The relation to the family** (\`relationLevels\`, shared/src/relation.ts; tree-model "Relation to the family is
  computed" and "Relation follows the evidence"). Proved, for any Persons, Family roots and links: both searches
  (\`reachFrom\`) stop (a round that reaches someone new leaves fewer unreached: a \`decreases\` added in relation.dfy);
  every Family root is a Relative; a link with a Citation of normal or higher confidence to a Relative leads to a
  Relative, whatever its other Citations ("Linked through a confirmed marriage", "Evidence improves"); any link to a
  Relative or Possible relative leads to at least a Possible relative; whoever is no root and has only links whose
  Citations are all of low or very low confidence, or that have none, is no Relative ("Only a weak link"); whoever
  is no root and has no Family link is Unrelated ("Godparent from the same village": a Role at an Event is no input);
  with no Family root everyone is Unrelated; \`isConfirming\` holds for normal, high and very high and not for low or
  very low. Each search also returns a certificate: everyone it reached who is no start came through a link it may
  follow from someone reached earlier (\`isSupported\`, \`order\`). The lemmas \`ReachedIsLeast\` and
  \`EvidenceOnlyAdds\` in relation.dfy prove that a certified search reached exactly the least set closed under its
  links, so no one without a chain of such links from a root, and that with links that only gain Citations it
  reaches everyone it reached before; relation.dfy asserts that both searches of \`relationLevels\` are certified.
  Not proved: that \`relationLevels\` as a whole never lowers a relation when evidence improves (it follows from the
  two lemmas applied to its two searches, which no lemma composes); the Family links and Citations the server
  gathers (server/src/tree/relation.ts) and that it recomputes after every accepted change, which
  server/test/relation.test.ts tests against the fixture Tree.`,
];
