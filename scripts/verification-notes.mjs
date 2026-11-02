// The hand-written parts of docs/verification.md, kept apart from the script that writes it
// (scripts/verification-trace.mjs): update them with the proofs they describe.

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
  'Checked for the swapped comparison: in every `//@ verify` function of shared/src/edtf.ts, shared/src/living.ts,',
  'shared/src/relation.ts, shared/src/rules.ts, shared/src/reading.ts and shared/src/matching.ts, no narrowed optional is',
  'an operand of `<`, `<=`, `>` or `>=`, in code or in a specification (optionals occur only in `===` and `!==`, where',
  'order does not matter; the `!` index reads of relation.ts compare two plain integers, emitted in their order;',
  'reading.ts and matching.ts have no optionals: an unknown house or Place is an empty text, an unknown birth year a',
  '`hasBirth` flag), and the generated `.dfy.gen` was read for it.',
  'Recheck this, and read the `.dfy.gen`, whenever a proof is added or changed.',
];

// Exactly what a proof covers where that is less than its requirement, written by hand: update it with the proof.
export const SCOPES = [
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
  `**The switch, the daily limit and what is sent** (\`mayRead\`, \`imagesToSend\`, shared/src/reading.ts; \`mayDo\`,
  shared/src/rules.ts; scan-reading "The Owner switches it on", evidence-media "Images sent for reading"). Proved: with
  the switch off nothing is read and no image is to be sent ("Switched off"); a Member with as many readings today as
  the daily limit is refused ("Daily limit"), and below it one more is allowed; exactly the requested scans are to be
  sent, in order, each as its marked crop or else its display copy, never the original ("Reading one page"); only the
  Owner may change the settings (\`manageSettings\`). Not proved: that the server counts the readings of the day under a
  lock and asks \`mayRead\` before it queues one, and \`imagesToSend\` again when the job starts
  (server/src/readings/service.ts and jobs.ts); that it sends the bytes of exactly those copies, and refuses portraits
  and others' uploads; that the switch states that scans go to Anthropic's API and the Owner sees the usage. The
  tests in server/test/readings.test.ts inspect the outgoing requests for these.`,
  `**The machine's reading is marked and modest** (\`capConfidence\`, \`stillReadByAi\`, shared/src/reading.ts).
  Proved: a Citation the reader drafted has very low, low or normal confidence, a higher one becomes normal and a lower
  one is kept, and one a person drafted keeps its confidence; a value is marked "read by AI" exactly while it comes from
  the reader and the Member has neither confirmed nor changed it ("Member confirms"). Not proved: that the server
  applies the cap to every new Citation of a Proposal that names a reading or has a read image
  (server/src/readings/proposals.ts); that the app keeps the marks with this rule (app/src/reading-draft.js mirrors it,
  and app/tests/unit/reading-draft.test.mjs checks the mirror against it); that the reader leaves illegible values empty
  ("Faded house number"), which the reading schema checks and server/test/readings.test.ts tests.`,
  `**Names are matched, not duplicated** (\`scoreCandidate\`, \`ranksAbove\`, \`isSuggested\`, shared/src/matching.ts).
  Proved: the reasons of a candidate are computed from the read person and the candidate's facts alone, and the score
  from the reasons; a candidate with the read name, House and a birth in the window scores above any candidate without
  all three ("Known father"); only candidates whose name matches are suggested. Not proved: the folding of names into
  variants and the birth window of a role (shared/src/name-variants.ts, tested in shared/test/reading.test.ts); the
  candidate query that gathers the facts from the Tree (server/src/readings/candidates.ts, tested against the fixture
  Tree in server/test/reading-proposals.test.ts); that a new Person is created only when the Member chooses so (the
  app's check screen and the Agent's builder, shared/src/reading-proposal.ts, which refuses a read person without a
  choice).`,
];
