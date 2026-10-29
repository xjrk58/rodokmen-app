# Current-state tables plus a log of accepted Proposals

The database keeps the Tree's current state in ordinary tables. Every accepted Proposal is also kept permanently, append-only, as the list of records it changed with their values before and after. That log answers who changed what, when and on which evidence, and it lets an Editor undo a whole Proposal, as Gramps Web undoes transactions. Full event sourcing, rebuilding the state from the log, was considered and rejected: it adds real complexity and gives little more at this size.

The one exception to append-only is erasure: when a Living relative asks to be removed, the Owner erases them from the Tree and from the log as well. A complete audit trail matters less than a relative's wish to be forgotten.
