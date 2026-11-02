# The relation to the family

A Tree built from parish registers fills up with people who are not family. A baptism names godparents, a marriage names witnesses, a census sheet lists everyone in a House. They are worth keeping: the godparent may turn out to be an aunt, and the neighbours show who lived around the family. But a relative opening the People list wants the family first, not every godparent in three villages.

So Rodokmen sorts every Person into one of three relations: **Relative**, **Possible relative** or **Unrelated person**, as the [glossary](../../GLOSSARY.md) defines them.

## Family roots are the starting points

"Related" needs a starting point. The Owner marks one or more Persons as Family roots, typically the couple a research effort descends from. Everyone else's relation is worked out from them.

Until the first Family root is marked, there is nothing to measure from. Rather than call everyone Unrelated, the app then shows everyone as family, and Settings asks the Owner to mark a root ([How to mark Family roots](../how-to/mark-family-roots.md)).

## Computed from the evidence, never set by hand

A Person is a Relative when a chain of Family links (parent, child or partner) connects them to a Family root, and every link in that chain is supported by at least one Citation of normal or higher confidence. If every chain includes a link without such a Citation (its Citations are all of low or very low confidence, or it has none), the Person is a Possible relative. Anyone with no chain at all is an Unrelated person.

Two choices in that rule matter:

- **Roles are not links.** Being a godparent or a witness at a family Event says the Person was there, not that they were kin. A godparent from the same village stays Unrelated until a Family link says otherwise.
- **The evidence decides.** A father link inferred from a hard-to-read entry is not the same as one read clearly from the register. Marking such Persons as Possible relatives keeps the doubt visible: the tree draws them with a mark and a dashed box, and their weak link dotted.

The relation is never entered by hand, because a hand-set label would go stale the moment the evidence changed. Instead it is recomputed whenever an accepted Proposal changes a Family link, a Citation's confidence or the Family roots. When a second, clear Citation is added to a weak father link, that Person becomes a Relative as soon as the Proposal is accepted.

## What Members see

Once there is a Family root, the People list, search and the family on the map show Relatives and Possible relatives, each with a switch to include Unrelated people. The tree hides Unrelated people, except the Focus Person.

## Proved, within limits

The rule itself is a pure function, `relationLevels` in `shared/src/relation.ts`, proved with LemmaScript. The proofs show, for any Tree, that every Family root is a Relative, that a well-supported link to a Relative leads to a Relative, that a Person reached only through weak links is no Relative, and that a Person with no Family link is Unrelated. They do not cover the server gathering the links and Citations from the database, or that it recomputes after every change; tests cover those. The exact scope is in [verification](../verification.md#scope).

The requirements are in the OpenSpec change `add-vault-import`, spec `tree-model`: "Family roots", "Relation to the family is computed" and "Relation follows the evidence".
