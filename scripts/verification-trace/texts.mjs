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
  `**Imported constants are not emitted.** A constant imported from another file is an unresolved identifier in the
  Dafny. Repeat it in the proved file (as shared/src/kinship-terms/cs.ts and en.ts repeat shapes.ts) with a test that
  the two match, or pass it in as a parameter.`,
  `**Quantifiers over neighbours (Dafny).** A quantifier that reads \`xs[k + 1]\` next to \`xs[k]\` gets no usable trigger
  (arithmetic is not allowed in one), so Dafny may neither use nor prove it, even right after the loop whose invariant
  it is. Name the property of index \`k\` with a predicate (\`linkedAt\`, \`joinsAt\` in kinship.ts) and quantify over that.`,
  `**Existential goals (Dafny).** Dafny proves "there is a …" only when a witness is already a term in the proof, and it
  rarely finds one inside a loop invariant. Name such a property with a \`.some(...)\` predicate (\`isBlocking\`,
  \`hasProposal\` in rules.ts), so that it is proved from the element at hand, and give \`.dfy\` hints (\`var x :| …\`)
  when a proof chains several.`,
];

// What was checked by hand for the unsound shape above (KNOWN_ISSUES[0]); recheck when adding a proof.
export const SWAP_CHECK = [
  'Checked for the swapped comparison: in every `//@ verify` function of shared/src/edtf.ts, shared/src/erasure.ts,',
  'shared/src/export.ts, shared/src/gaps.ts, shared/src/kinship.ts, shared/src/kinship-terms/cs.ts,',
  'shared/src/kinship-terms/en.ts, shared/src/leads.ts, shared/src/living.ts, shared/src/matching.ts,',
  'shared/src/presumed-death.ts, shared/src/reading.ts, shared/src/relation.ts and shared/src/rules.ts, no narrowed optional',
  'is an operand of `<`, `<=`, `>` or `>=`, in code or in a specification (optionals occur only in `===` and `!==`, where',
  'order does not matter; the `!` index reads of relation.ts, gaps.ts, export.ts, presumed-death.ts and kinship.ts are not',
  'compared at all or compare two plain integers, emitted in their order; erasure.ts, export.ts, gaps.ts, kinship.ts,',
  'kinship-terms/cs.ts, kinship-terms/en.ts, leads.ts, matching.ts, presumed-death.ts and reading.ts have no optionals at',
  'all: unknown years, houses, Places and Sources are a flag and 0, or the empty string, a Person without a chain has an',
  'empty one, and kinship marks "nobody", "no line" and "no degree" with -1 or 0), and the generated `.dfy.gen` was read',
  'for it. Recheck this, and read the `.dfy.gen`, whenever a proof is added or changed.',
];

// Exactly what a proof covers where that is less than its requirement, written by hand: update it with the proof.
export const SCOPES = [
  `**Presumed death** (\`presumedDead\`, shared/src/presumed-death.ts; vault-import "Presumed death when birth is provably
  long ago"). Proved, for any Persons, facts, parent links and offered chains: a Person is presumed dead only if they have
  no death or burial and no birth or baptism date of their own, and the chain offered for them ends at them, starts at a
  fact of its first Person (a birth, a marriage at 12 or older, or a parent's death at most a year before the birth), takes
  each further step along a parent link by one of the bounds (a parent at least 12 years older, a child at most 60 years
  after the mother), and bounds their birth before the cutoff; with no fact and no parent link, nobody is presumed dead
  ("No dates, no relatives"). The lemma \`ChainBoundsBirth\` in presumed-death.dfy proves such a chain sound: for any
  birth days that keep the bounds, everyone on it was born on or before the chain's value for them. Not proved: the search
  for the tightest bounds and the chains behind them (\`presumeDeaths\`; the proved check accepts or refuses what it
  offers, so a mistake there can only leave a death unpresumed), the facts the importer reads from the Vault
  (server/src/vault-import/map-presumed.ts: the latest days of EDTF dates, the marriages of either spouse's note, fathers
  and mothers), and that the cutoff is the day 125 years before the run; shared/test/presumed-death.test.ts and
  server/test/vault-import-mapping.test.ts test those.`,
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
  that concerned Living people only is left out. Not proved: that the Export writes its leads through
  server/src/leads/export.ts, which marks who is Living with the proved Living rule, and that erasure uses the same
  rule (server/src/leads/erasure.ts, \`living\` meaning the erased Person); server/test/exports.test.ts and
  server/test/erasure.test.ts test both with a lead linked to a Living person.`,
  `**The Export view of a record** (\`exportRecord\`, \`reducePerson\`, \`exportLinks\`, shared/src/export.ts; exports "Living
  people are reduced in every Export", "No images in any Export" and "GEDCOM download for the Owner"). Proved, for any
  record: a Living person keeps the given name and surname of their primary Name (no other Name, no spelling as found,
  no Citation), their sex, only their \`childOf\` and \`partnerIn\` relations, and their birth year, and nothing else: no
  Event (so no exact date, Place or House), fact, note or link ("Living grandchild in GEDCOM": born in 2010, the view
  holds 2010 and no place or other fact); no record keeps an Event in which a Living person has a Role; a record that
  concerns a Living person keeps no notes; no record, Event Citation or Name Citation keeps a link to an image or a
  document, and every other link is kept ("Citation with a page image": its transcription, page and confidence stay);
  any other record keeps its facts and relations. Not proved: who is Living (the proved Living rule, which the server
  asks), what the server gathers into a record (server/src/export/gather.ts: which links are images, the image embeds
  it takes out of notes, the birth year from the dates, which Families concern a Living person, a Family account given
  by a Living person), that both writers write only the view (server/src/export/markdown.ts and gedcom.ts), and that
  the download and the nightly file are the same; server/test/exports.test.ts tests those.`,
  `**Erasure** (\`mayErase\`, \`theirsAlone\`, \`theirRows\`, \`citationsLeft\`, \`rewriteLog\`, \`toEraseAgain\`,
  \`afterReapplying\`, shared/src/erasure.ts; \`mayDo\`, shared/src/rules.ts; erasure "Owner erases a Living person",
  "Erasure reaches the log" and "Restores keep erased people erased"). Proved: only a Living person is erased, and only
  when the confirmation is their name ("Not Living", "A cousin asks to be removed"); only the Owner may (\`erase\`); the
  Events and images that go are exactly those whose every Person is the erased one, so none another Person took part in
  or is shown in; the rows that go are exactly the erased Person's; the Citations that go are exactly those attached
  only to records that go; every log entry that mentions an erased record becomes a marker with only "erased" and the
  time, and every other entry stays as it was ("History after erasure"); a restore erases again exactly the listed
  Persons it holds, so none remains and nobody else goes ("Restore from an old Backup"). Not proved: which rows,
  Events, Citations, images and log entries the server gathers and which ids a snapshot or an operation mentions, that
  it deletes and rewrites them in one transaction (server/src/erasure/service.ts), that a Proposal involved in an
  erased entry loses its operations and notes, that the Export replaces its history afterwards
  (server/src/export/run.ts), and that the API and the monthly restore test erase again before anything else;
  server/test/erasure.test.ts tests those, the last with a database restored from before the erasure.`,
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
  `**Kinship: line and degree** (\`kinshipDegree\`, \`kinshipLine\`, shared/src/kinship.ts; kinship "Line and degree of
  kinship by birth" and "Line and degree of kinship by marriage"). Proved, for any kind of path and generations up and
  down: by birth and by marriage the degree is up plus down, and the line is direct exactly when one of them is 0, else
  collateral ("Great-grandfather" 3, "Sibling" 2, "Uncle" 3, "First cousin and once removed" 4 and 5,
  "Brother-in-law" 2, "Daughter-in-law" 1); the reader, partners, step-siblings, co-parents-in-law and foster pairs have
  no line and no degree ("Wife"). Not proved: that the shell counts up and down from the steps of each path, the number
  of child links of its part by birth (shared/src/kinship-paths.ts), which shared/test/kinship-paths.test.ts tests.`,
  `**Kinship: chains up and the closest path** (\`chainsUp\`, \`chainDown\`, \`closestPath\`, shared/src/kinship.ts; kinship
  "Kinship is computed from Family links" and "Paths in a fixed order"). Proved, for any Persons and parent links: the
  search up from a Person follows birth and adoptive links only (step and foster links never), at most 12 generations;
  the start is at 0 and nobody else is; it is closed within the limit (a followed parent of a Person d generations up,
  d below 12, is at most d + 1 up), so every distance is the fewest generations; and everyone it reached above the start
  came through a followed link from a child one generation lower, so a chain of Family links leads down to the start
  ("Godparent": a Role at an Event is no input). The closest path is found exactly when the two have a common ancestor
  within the limits; its degree is at most the generations to every common ancestor ("Two cousinships"); its two chains
  are chains of followed links down from the common ancestor to each, and the lemma \`MeetOnlyAtTop\` in kinship.dfy proves
  that they meet only there. Not proved: that the shell builds the closest paths by marriage from the same rule through
  each partner, and lists them when a bound cuts the search (kinshipPaths), which the tests check on a dense pedigree.`,
  `**Kinship: the order of paths** (\`compareKinshipPaths\`, shared/src/kinship.ts; kinship "Paths in a fixed order").
  Proved: it is -1, 0 or 1, antisymmetric, and 0 only for paths of the same rank, marks, generations and Persons ("Equal
  paths"); the reader and partners come first, then a lower degree ("Brother-in-law and cousin"), kinship by birth before
  kinship by marriage at the same degree, confirmed before possible; the lemma \`CompareKinshipPathsTransitive\` in
  kinship.dfy proves it transitive, so a sort gives one order whatever order the paths come in. Persons are indexes in
  the order of their ids by code units, which the shell sets up (shared/src/kinship-graph.ts) and tests check with the
  records shuffled.`,
  `**Kinship: evidence** (\`isPossiblePath\`, shared/src/kinship.ts; kinship "Kinship follows the evidence"). Proved: a path
  is possible exactly when one of its links, the partner step of kinship by marriage included, is not strong by the
  proved \`isStrongLink\` of relation.ts, whose contract (a Citation of normal, high or very high confidence supports the
  link) names its parameter alone, so the call across files keeps it; a Citation of normal or higher confidence on
  every link makes the path confirmed ("Evidence improves"), and the lemma \`WeakLinkMakesPossible\` in kinship.dfy says
  that a link with no such Citation makes it possible ("Weak father link"). Not proved: which Citations the server
  gathers for each link (server/src/tree/kinship.ts), which server/test/kinship.test.ts tests.`,
  `**Kinship: half, step, adoptive and foster** (\`isHalf\`, \`namesOwnParentOrChild\`, \`isFollowed\`,
  shared/src/kinship.ts; kinship "Half, step, adoptive and foster kinship"). Proved: half exactly when both chains are
  at least one generation long and enter the common ancestor through children of two different couples ("Half-brother";
  one couple recorded as two Families is one couple); a path by marriage is dropped exactly when a partner step sits next
  to a step up or down through a child of the same couple ("Own child, not a stepchild"; "Stepmother" is kept); only
  birth and adoptive links are followed. Not proved: that the shell names step and foster child links between their own
  pair only and never beyond, and that it counts an adoptive link as a birth, which the tests check ("Foster child of
  the grandparents", "Through adoption").`,
  `**Kinship: the connection** (\`connectionChain\`, shared/src/kinship.ts; kinship "Limits of the kinship search").
  Proved, for any Persons and Family links: when found, the chain runs from the reader to the Person through real Family
  links, one after another ("Through two marriages"); when not, nothing is listed and the search from the Person reached
  a set closed under every link that leaves the reader out, so no chain exists ("No chain"); the search stops (a round
  that reaches someone new leaves fewer unreached: a \`decreases\` added in kinship.dfy). Not proved: that the chain is
  the shortest, which the tests check, and the limits of 12 generations and 100 paths in the shell.`,
  `**Kinship terms** (\`termCs\`, \`termEn\`, shared/src/kinship-terms/cs.ts and en.ts; kinship "Kinship terms by birth",
  "Kinship terms by marriage", "Half, step, adoptive and foster kinship"). Proved, for every shape, generations up and
  down, sex and marks: the word, the number of "pra" or "great", the "koleno", generation, cousin number and removes
  follow the tables of design.md (modern strýc and teta on both sides, "z n. kolena", "pra" written out three times at
  most, then "předek v n. pokolení"; "n-th cousin, m times removed"); the form and gender follow the sex, with the
  neutral or both forms when it is not recorded ("Sex not recorded"); half only by birth, and adoption as a word for one
  adoptive link alone, else after the term ("Through adoption"); the in-law, step, co-parent and foster words of the
  tables. Not proved: the spelling of the chosen term (spellCs, spellEn), which the golden files
  shared/test/golden/kinship/cs.txt and en.txt check, and that the server writes every Interface language.`,
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
