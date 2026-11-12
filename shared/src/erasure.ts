/**
 * The rules of erasure (erasure spec; ADR 0006, the one exception to the append-only log): who
 * may be erased, what goes with them, what becomes of the log, and what a restore reapplies.
 * Pure functions: no I/O, plain arrays and records, no optionals.
 *
 * Erasure removes a Living person completely when they ask: the Person, their Names, Roles,
 * Family links and Labels, the Events only they took part in, the Citations left attached to
 * nothing but what goes, and the images that show only them. Every log entry about them becomes
 * a marker that says a record was erased and when. Their id is kept in a list without any other
 * data, so that a restore of an older Backup erases them again.
 *
 * The functions marked `//@ verify` are proved with LemmaScript (ADR 0009, docs/verification.md).
 * Who is Living (the proved Living rule), which rows, Events, Citations, images and log entries
 * the server gathers, and the deletes and updates it runs in one transaction, are not proved;
 * server/test/erasure.test.ts covers them.
 */

/** A record shared by several Persons: an Event and the Persons who have a Role in it, or an image and the Persons it shows. */
export interface SharedRecord {
  readonly id: string;
  readonly persons: readonly string[];
}

/** A row that belongs to one Person: a Name, a Role, a Family link, a Label, an image subject … */
export interface OwnedRow {
  readonly table: string;
  readonly id: string;
  readonly personId: string;
}

/** A Citation and the ids of the Events and Names it is attached to. */
export interface AttachedCitation {
  readonly id: string;
  readonly attachedTo: readonly string[];
}

/** A log entry (a change, or a Proposal) as erasure sees it: the record ids it mentions, and its data. */
export interface LogItem {
  readonly id: string;
  readonly mentions: readonly string[];
  /** Its data (snapshots, operations, notes), as text; '' in a marker. */
  readonly data: string;
  readonly erased: boolean;
  /** When it was erased; '' when it was not. */
  readonly at: string;
}

// ---------------------------------------------------------------- who may be erased, and what goes

/**
 * Whether the Owner may erase this Person (erasure spec, "Owner erases a Living person"): only a
 * Living person, and only after a confirmation that names them. The server normalises both names
 * the same way (spaces and case) before it asks; only the Owner reaches this (mayDo `erase`).
 */
export function mayErase(living: boolean, confirmation: string, name: string): boolean {
  //@ verify
  //@ contract erasure: Owner erases a Living person
  // Scenario "Not Living": a Person who is not Living is never erased.
  //@ ensures !living ==> !\result
  // Scenario "A cousin asks to be removed": a Living person, once the confirmation names them.
  //@ ensures \result === (living && name !== '' && confirmation === name)
  return living && name !== '' && confirmation === name;
}

/** Whether a shared record is the Person's alone: they are its only Person. */
export function onlyTheirs(r: SharedRecord, personId: string): boolean {
  //@ verify
  return r.persons.length > 0 && r.persons.every((p) => p === personId);
}

/**
 * The records that go with the Person: the Events only they took part in, or the images that show
 * only them. A record another Person is part of stays.
 */
export function theirsAlone(records: readonly SharedRecord[], personId: string): SharedRecord[] {
  //@ verify
  //@ contract erasure: Owner erases a Living person
  // Every record that is theirs alone goes ...
  //@ ensures forall(j: nat, j < records.length && onlyTheirs(records[j], personId) ==> \result.includes(records[j]))
  // ... and none another Person took part in.
  //@ ensures forall(i: nat, i < \result.length ==> onlyTheirs(\result[i], personId) && records.includes(\result[i]))
  //@ ensures forall(i: nat, i < \result.length ==> forall(k: nat, k < \result[i].persons.length ==> \result[i].persons[k] === personId))
  const out: SharedRecord[] = [];
  for (const r of records) {
    //@ invariant forall(j: nat, j < _r_idx && onlyTheirs(records[j], personId) ==> out.includes(records[j]))
    //@ invariant forall(i: nat, i < out.length ==> onlyTheirs(out[i], personId) && records.includes(out[i]))
    //@ invariant forall(i: nat, i < out.length ==> forall(k: nat, k < out[i].persons.length ==> out[i].persons[k] === personId))
    if (onlyTheirs(r, personId)) out.push(r);
  }
  return out;
}

/** The rows of the Person: exactly those that belong to them, and no row of another Person. */
export function theirRows(rows: readonly OwnedRow[], personId: string): OwnedRow[] {
  //@ verify
  //@ contract erasure: Owner erases a Living person
  //@ ensures forall(i: nat, i < \result.length ==> \result[i].personId === personId && rows.includes(\result[i]))
  //@ ensures forall(j: nat, j < rows.length && rows[j].personId === personId ==> \result.includes(rows[j]))
  const out: OwnedRow[] = [];
  for (const row of rows) {
    //@ invariant forall(i: nat, i < out.length ==> out[i].personId === personId && rows.includes(out[i]))
    //@ invariant forall(j: nat, j < _row_idx && rows[j].personId === personId ==> out.includes(rows[j]))
    if (row.personId === personId) out.push(row);
  }
  return out;
}

/** Whether a Citation is attached to something, and only to records that go. */
export function leftWithNothing(c: AttachedCitation, removed: readonly string[]): boolean {
  //@ verify
  return c.attachedTo.length > 0 && !c.attachedTo.some((a) => !removed.includes(a));
}

/**
 * The Citations that go: those attached only to Events and Names that go (they would be attached
 * to nothing, and their transcription names the Person). A Citation also attached to a record
 * that stays, stays.
 */
export function citationsLeft(citations: readonly AttachedCitation[], removed: readonly string[]): AttachedCitation[] {
  //@ verify
  //@ contract erasure: Owner erases a Living person
  //@ ensures forall(j: nat, j < citations.length && leftWithNothing(citations[j], removed) ==> \result.includes(citations[j]))
  //@ ensures forall(i: nat, i < \result.length ==> leftWithNothing(\result[i], removed) && citations.includes(\result[i]))
  const out: AttachedCitation[] = [];
  for (const c of citations) {
    //@ invariant forall(j: nat, j < _c_idx && leftWithNothing(citations[j], removed) ==> out.includes(citations[j]))
    //@ invariant forall(i: nat, i < out.length ==> leftWithNothing(out[i], removed) && citations.includes(out[i]))
    if (leftWithNothing(c, removed)) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------- the log

/** Whether a log entry mentions any of the erased records. */
export function mentionsAny(item: LogItem, erased: readonly string[]): boolean {
  //@ verify
  return item.mentions.some((m) => erased.includes(m));
}

/**
 * The log after an erasure (erasure spec, "Erasure reaches the log"): every entry that mentions
 * an erased record becomes a marker that holds only that a record was erased and when; every
 * other entry stays exactly as it was. The only rewrite of the log the system allows.
 */
export function rewriteLog(items: readonly LogItem[], erased: readonly string[], at: string): LogItem[] {
  //@ verify
  //@ contract erasure: Erasure reaches the log
  //@ ensures \result.length === items.length
  // Scenario "History after erasure": an entry that involved the erased Person is a marker, with none of their data ...
  //@ ensures forall(i: nat, i < items.length && mentionsAny(items[i], erased) ==> \result[i].id === items[i].id && \result[i].erased && \result[i].at === at && \result[i].mentions.length === 0 && \result[i].data === '')
  // ... and no other entry changes.
  //@ ensures forall(i: nat, i < items.length && !mentionsAny(items[i], erased) ==> \result[i] === items[i])
  const out: LogItem[] = [];
  for (const item of items) {
    //@ invariant out.length === _item_idx
    //@ invariant forall(i: nat, i < out.length && mentionsAny(items[i], erased) ==> out[i].id === items[i].id && out[i].erased && out[i].at === at && out[i].mentions.length === 0 && out[i].data === '')
    //@ invariant forall(i: nat, i < out.length && !mentionsAny(items[i], erased) ==> out[i] === items[i])
    if (mentionsAny(item, erased)) out.push({ id: item.id, mentions: [], data: '', erased: true, at });
    else out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------- restores

/**
 * Whom a restore erases again (erasure spec, "Restores keep erased people erased"): every Person
 * of the restored database whose id is on the list of erasures, and nobody else.
 */
export function toEraseAgain(present: readonly string[], erasures: readonly string[]): string[] {
  //@ verify
  //@ contract erasure: Restores keep erased people erased
  // Scenario "Restore from an old Backup": every erased Person the Backup still holds is erased again ...
  //@ ensures forall(j: nat, j < present.length && erasures.includes(present[j]) ==> \result.includes(present[j]))
  // ... and nobody who is not on the list.
  //@ ensures forall(i: nat, i < \result.length ==> erasures.includes(\result[i]) && present.includes(\result[i]))
  const out: string[] = [];
  for (const id of present) {
    //@ invariant forall(j: nat, j < _id_idx && erasures.includes(present[j]) ==> out.includes(present[j]))
    //@ invariant forall(i: nat, i < out.length ==> erasures.includes(out[i]) && present.includes(out[i]))
    if (erasures.includes(id)) out.push(id);
  }
  return out;
}

/** Who remains after a restore erased again: no erased id, and every Person not on the list. */
export function afterReapplying(present: readonly string[], erasures: readonly string[]): string[] {
  //@ verify
  //@ contract erasure: Restores keep erased people erased
  // No erased id remains ...
  //@ ensures forall(i: nat, i < \result.length ==> !erasures.includes(\result[i]))
  // ... and nothing else is removed.
  //@ ensures forall(j: nat, j < present.length && !erasures.includes(present[j]) ==> \result.includes(present[j]))
  //@ ensures forall(i: nat, i < \result.length ==> present.includes(\result[i]))
  const out: string[] = [];
  for (const id of present) {
    //@ invariant forall(i: nat, i < out.length ==> !erasures.includes(out[i]))
    //@ invariant forall(j: nat, j < _id_idx && !erasures.includes(present[j]) ==> out.includes(present[j]))
    //@ invariant forall(i: nat, i < out.length ==> present.includes(out[i]))
    if (!erasures.includes(id)) out.push(id);
  }
  return out;
}
