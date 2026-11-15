/**
 * The merge of two Events (review spec, "Merging duplicate Events", "A merged Event fills the gaps
 * of the kept one" and "Merging Events refuses disagreeing facts"; family-view spec, "Merge
 * duplicate Events from the person page"), as small pure functions: no I/O, no `await`, no regular
 * expressions. The server reads both Events and their Roles and asks these; the reading, and
 * applying the merge to the database, are not proved.
 *
 * Proved with LemmaScript (ADR 0009, docs/verification.md): each `//@ verify` function meets its
 * `//@` specification. An unknown value is the empty string, never null, so no optional is ever
 * compared (docs/verification.md, "Known LemmaScript issues").
 */

/** What a merge reads of an Event; '' where the Event has nothing. */
export interface EventFacts {
  readonly type: string;
  readonly typeDetail: string;
  /** The EDTF date as written. */
  readonly date: string;
  readonly placeId: string;
  readonly houseId: string;
  readonly description: string;
  /** The research notes. */
  readonly notes: string;
}

/** A Person's Role in an Event. */
export interface EventRole {
  readonly personId: string;
  readonly role: string;
}

/** What a merge finds: the facts the two Events disagree on (none: they may be merged), and what the kept Event holds after it. */
export interface EventMerge {
  /** Some of `type`, `date`, `place`, `roles`, `description` and `notes`, in that order. */
  readonly conflicts: string[];
  readonly kept: EventFacts;
}

// ---------------------------------------------------------------- Roles

/** The Roles that say whose Event it is: child, father, mother, deceased and partner. */
export function isPrincipalRole(role: string): boolean {
  //@ verify
  return role === 'child' || role === 'father' || role === 'mother' || role === 'deceased' || role === 'partner';
}

/** Whether a Person has a Role in an Event. */
export function hasRole(roles: readonly EventRole[], personId: string, role: string): boolean {
  //@ verify
  return roles.some((r) => r.personId === personId && r.role === role);
}

/** Whether every Person one Event has in a Role, the other has in that Role too. */
export function coveredBy(from: readonly EventRole[], to: readonly EventRole[], role: string): boolean {
  //@ verify
  return from.every((r) => r.role !== role || hasRole(to, r.personId, role));
}

/**
 * Whether two Events agree on who plays a Role: the Persons one has in it are all among those of
 * the other. Partners A and B agree with A alone, but not with A and C.
 */
export function agreeOn(keep: readonly EventRole[], merge: readonly EventRole[], role: string): boolean {
  //@ verify
  // Every Role of the merged Event the kept Event has already: they agree.
  //@ ensures forall(j: nat, j < merge.length ==> hasRole(keep, merge[j].personId, merge[j].role)) ==> \result
  return coveredBy(keep, merge, role) || coveredBy(merge, keep, role);
}

/** Whether a Person has one principal Role in one Event and another principal Role in the other. */
export function playsTwoParts(keep: readonly EventRole[], merge: readonly EventRole[]): boolean {
  //@ verify
  return merge.some((m) => isPrincipalRole(m.role) && keep.some((k) => isPrincipalRole(k.role) && k.personId === m.personId && k.role !== m.role));
}

/** Whether two Events agree on their principal Roles: on each of them, and no Person in two of them. */
export function rolesAgree(keep: readonly EventRole[], merge: readonly EventRole[]): boolean {
  //@ verify
  return (
    agreeOn(keep, merge, 'child') &&
    agreeOn(keep, merge, 'father') &&
    agreeOn(keep, merge, 'mother') &&
    agreeOn(keep, merge, 'deceased') &&
    agreeOn(keep, merge, 'partner') &&
    !playsTwoParts(keep, merge)
  );
}

// ---------------------------------------------------------------- facts

/** Whether two values agree: the same, or one of them unknown. */
export function agree(a: string, b: string): boolean {
  //@ verify
  return a === '' || b === '' || a === b;
}

/** The kept Event's value, or the merged Event's where the kept one has none. */
export function known(keep: string, merge: string): string {
  //@ verify
  //@ ensures keep !== '' ==> \result === keep
  //@ ensures keep === '' ==> \result === merge
  if (keep !== '') return keep;
  return merge;
}

/** The kept Event's text, then a blank line and the merged Event's; one of them alone when the other is empty or the same. */
export function joined(keep: string, merge: string): string {
  //@ verify
  //@ ensures merge === '' ==> \result === keep
  //@ ensures keep === '' ==> \result === merge
  //@ ensures keep === merge ==> \result === keep
  //@ ensures keep !== '' && merge !== '' && keep !== merge ==> \result === keep + '\n\n' + merge
  if (merge === '' || merge === keep) return keep;
  if (keep === '') return merge;
  return keep + '\n\n' + merge;
}

/** Whether an Event has a Place or a House. */
export function whereKnown(e: EventFacts): boolean {
  //@ verify
  return e.placeId !== '' || e.houseId !== '';
}

/** Whether two Events agree on where they happened: the same Place or House, or one of them has neither. */
export function whereAgrees(keep: EventFacts, merge: EventFacts): boolean {
  //@ verify
  return !whereKnown(keep) || !whereKnown(merge) || (keep.placeId === merge.placeId && keep.houseId === merge.houseId);
}

/**
 * The merge of one Event into another: the facts they disagree on, and what the kept Event holds.
 *
 * - The type must be the same; type detail, date and Place or House the same or unknown on one side.
 *   The kept Event keeps its own, and takes the merged Event's where it has none.
 * - Description and research notes are joined, the kept Event's first; too long for the Tree, they
 *   are a conflict.
 * - The principal Roles must agree (`rolesAgree`). The other Roles add up and are no conflict.
 *
 * A merge with a conflict is refused and changes nothing; without one, nothing the merged Event
 * says is lost. The longest description and notes are parameters, as constants are not emitted.
 */
export function mergeEventFacts(
  keep: EventFacts,
  merge: EventFacts,
  keepRoles: readonly EventRole[],
  mergeRoles: readonly EventRole[],
  maxDescription: number,
  maxNotes: number,
): EventMerge {
  //@ verify
  //@ contract review: Merging duplicate Events
  //@ contract review: A merged Event fills the gaps of the kept one
  //@ contract review: Merging Events refuses disagreeing facts
  // Each fact is a conflict exactly when the two Events disagree on it ...
  //@ ensures \result.conflicts.includes('type') === (keep.type !== merge.type || !agree(keep.typeDetail, merge.typeDetail))
  //@ ensures \result.conflicts.includes('date') === !agree(keep.date, merge.date)
  //@ ensures \result.conflicts.includes('place') === !whereAgrees(keep, merge)
  //@ ensures \result.conflicts.includes('roles') === !rolesAgree(keepRoles, mergeRoles)
  //@ ensures \result.conflicts.includes('description') === (joined(keep.description, merge.description).length > maxDescription)
  //@ ensures \result.conflicts.includes('notes') === (joined(keep.notes, merge.notes).length > maxNotes)
  // ... and nothing else is one: the merge is refused exactly when the Events disagree on a fact.
  //@ ensures forall(i: nat, i < \result.conflicts.length ==> \result.conflicts[i] === 'type' || \result.conflicts[i] === 'date' || \result.conflicts[i] === 'place' || \result.conflicts[i] === 'roles' || \result.conflicts[i] === 'description' || \result.conflicts[i] === 'notes')
  //@ ensures (\result.conflicts.length === 0) === (keep.type === merge.type && agree(keep.typeDetail, merge.typeDetail) && agree(keep.date, merge.date) && whereAgrees(keep, merge) && rolesAgree(keepRoles, mergeRoles) && joined(keep.description, merge.description).length <= maxDescription && joined(keep.notes, merge.notes).length <= maxNotes)
  // Scenario "Different dates": two dates that differ are refused, naming the date.
  //@ ensures keep.date !== '' && merge.date !== '' && keep.date !== merge.date ==> \result.conflicts.includes('date')
  // Scenario "Two different children": a child of each Event the other lacks is refused, naming the Roles ...
  //@ ensures exists(i: nat, i < keepRoles.length && keepRoles[i].role === 'child' && !hasRole(mergeRoles, keepRoles[i].personId, 'child')) && exists(j: nat, j < mergeRoles.length && mergeRoles[j].role === 'child' && !hasRole(keepRoles, mergeRoles[j].personId, 'child')) ==> \result.conflicts.includes('roles')
  // ... and so is scenario "Another partner": a partner of each Event the other lacks.
  //@ ensures exists(i: nat, i < keepRoles.length && keepRoles[i].role === 'partner' && !hasRole(mergeRoles, keepRoles[i].personId, 'partner')) && exists(j: nat, j < mergeRoles.length && mergeRoles[j].role === 'partner' && !hasRole(keepRoles, mergeRoles[j].personId, 'partner')) ==> \result.conflicts.includes('roles')
  // Scenario "Marriage recorded twice": the same facts, and Roles of the merged Event the kept one has already, merge into the kept Event as it was.
  //@ ensures keep === merge && keep.description.length <= maxDescription && keep.notes.length <= maxNotes && forall(j: nat, j < mergeRoles.length ==> hasRole(keepRoles, mergeRoles[j].personId, mergeRoles[j].role)) && !playsTwoParts(keepRoles, mergeRoles) ==> \result.conflicts.length === 0 && \result.kept === keep
  // Scenario "Gaps are filled": the kept Event keeps what it knows, and takes the merged Event's where it knows nothing ...
  //@ ensures \result.kept.type === keep.type
  //@ ensures \result.kept.typeDetail === known(keep.typeDetail, merge.typeDetail)
  //@ ensures \result.kept.date === known(keep.date, merge.date)
  //@ ensures whereKnown(keep) ==> \result.kept.placeId === keep.placeId && \result.kept.houseId === keep.houseId
  //@ ensures !whereKnown(keep) ==> \result.kept.placeId === merge.placeId && \result.kept.houseId === merge.houseId
  // ... and scenario "Notes of both": its description and notes come first, the merged Event's follow.
  //@ ensures \result.kept.description === joined(keep.description, merge.description)
  //@ ensures \result.kept.notes === joined(keep.notes, merge.notes)
  // Without a conflict, nothing the merged Event knows is lost.
  //@ ensures \result.conflicts.length === 0 ==> \result.kept.type === merge.type
  //@ ensures \result.conflicts.length === 0 && merge.typeDetail !== '' ==> \result.kept.typeDetail === merge.typeDetail
  //@ ensures \result.conflicts.length === 0 && merge.date !== '' ==> \result.kept.date === merge.date
  //@ ensures \result.conflicts.length === 0 && whereKnown(merge) ==> \result.kept.placeId === merge.placeId && \result.kept.houseId === merge.houseId
  const conflicts: string[] = [];
  if (keep.type !== merge.type || !agree(keep.typeDetail, merge.typeDetail)) conflicts.push('type');
  if (!agree(keep.date, merge.date)) conflicts.push('date');
  if (!whereAgrees(keep, merge)) conflicts.push('place');
  if (!rolesAgree(keepRoles, mergeRoles)) conflicts.push('roles');
  const description = joined(keep.description, merge.description);
  if (description.length > maxDescription) conflicts.push('description');
  const notes = joined(keep.notes, merge.notes);
  if (notes.length > maxNotes) conflicts.push('notes');
  const keptWhere = whereKnown(keep);
  let placeId = merge.placeId;
  let houseId = merge.houseId;
  if (keptWhere) {
    placeId = keep.placeId;
    houseId = keep.houseId;
  }
  return {
    conflicts,
    kept: {
      type: keep.type,
      typeDetail: known(keep.typeDetail, merge.typeDetail),
      date: known(keep.date, merge.date),
      placeId,
      houseId,
      description,
      notes,
    },
  };
}

// ---------------------------------------------------------------- the offer on the person page

/** One of a Person's Events, as the person page's offer reads it. */
export interface OfferedEvent {
  readonly facts: EventFacts;
  readonly roles: readonly EventRole[];
  /** The Role of the Person whose page it is. */
  readonly role: string;
  /** How many Citations the Event has. */
  readonly citations: number;
  /** When it was created, as milliseconds since the epoch. */
  readonly createdAt: number;
}

/** Whether the person page offers the pair, and whether it suggests keeping the first. */
export interface MergeOffer {
  readonly offered: boolean;
  readonly keepFirst: boolean;
}

/** Which of two Events to suggest keeping: the one with more Citations, else the older, else the first. */
export function keepsFirst(a: OfferedEvent, b: OfferedEvent): boolean {
  //@ verify
  return a.citations > b.citations || (a.citations === b.citations && a.createdAt <= b.createdAt);
}

/**
 * Whether two of a Person's Events look like one (family-view spec, "Merge duplicate Events from
 * the person page"): of one type, with the Person in the same Role, and merging the suggested one
 * away finds no conflict. The suggested Event to keep has more Citations, else is the older.
 */
export function mergeOffer(a: OfferedEvent, b: OfferedEvent, maxDescription: number, maxNotes: number): MergeOffer {
  //@ verify
  //@ contract family-view: Merge duplicate Events from the person page
  // Only Events of one type, with the Person in the same Role in both, are offered.
  //@ ensures \result.offered ==> a.facts.type === b.facts.type && a.role === b.role
  // Scenario "Two residences in different years": Events dated otherwise are never offered.
  //@ ensures a.facts.date !== '' && b.facts.date !== '' && a.facts.date !== b.facts.date ==> !\result.offered
  // Nor are Events at another Place or House, or with another child or partner.
  //@ ensures !whereAgrees(a.facts, b.facts) ==> !\result.offered
  //@ ensures !rolesAgree(a.roles, b.roles) && !rolesAgree(b.roles, a.roles) ==> !\result.offered
  // Scenario "Marriage recorded twice": the same facts and the same Roles, with the Person in the same Role, are offered ...
  //@ ensures a.facts === b.facts && a.role === b.role && a.facts.description.length <= maxDescription && a.facts.notes.length <= maxNotes && rolesAgree(a.roles, b.roles) && rolesAgree(b.roles, a.roles) ==> \result.offered
  // ... with the Event that has more Citations to keep, else the older.
  //@ ensures a.citations > b.citations ==> \result.keepFirst
  //@ ensures b.citations > a.citations ==> !\result.keepFirst
  //@ ensures a.citations === b.citations ==> \result.keepFirst === (a.createdAt <= b.createdAt)
  const keepFirst = keepsFirst(a, b);
  let keep = a;
  let merge = b;
  if (!keepFirst) {
    keep = b;
    merge = a;
  }
  const found = mergeEventFacts(keep.facts, merge.facts, keep.roles, merge.roles, maxDescription, maxNotes);
  return { offered: a.facts.type === b.facts.type && a.role === b.role && found.conflicts.length === 0, keepFirst };
}
