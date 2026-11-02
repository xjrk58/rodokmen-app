import type { Db } from '../db/db.js';
import type { Change } from '../proposals/records.js';

/** Snapshot columns that name a Person, besides a Person's own id. */
const PERSON_COLUMNS = ['person_id', 'child_id', 'partner1_id', 'partner2_id'] as const;

interface Touched {
  persons: Set<string>;
  events: Set<string>;
  families: Set<string>;
  citations: Set<string>;
}

/** What one logged change names: its own record, and the Persons, Events and Families its snapshots point to. */
function collect(c: Change, into: Touched): void {
  if (c.table === 'person') into.persons.add(c.id);
  else if (c.table === 'event') into.events.add(c.id);
  else if (c.table === 'family') into.families.add(c.id);
  else if (c.table === 'citation') into.citations.add(c.id);
  for (const snap of [c.before, c.after]) {
    if (!snap) continue;
    for (const col of PERSON_COLUMNS) if (typeof snap[col] === 'string') into.persons.add(snap[col]);
    if (typeof snap.event_id === 'string') into.events.add(snap.event_id);
    if (typeof snap.family_id === 'string') into.families.add(snap.family_id);
  }
}

/**
 * The Persons an accepted change touched, for the gap finder (research-leads spec, "Gap finder
 * suggests leads"): those whose records it changed, the partners and children of Families it
 * changed, and everyone with a Role in an Event whose date, Place, Roles or Citations it changed.
 */
export async function touchedPersons(tx: Db, changes: readonly Change[]): Promise<string[]> {
  const t: Touched = { persons: new Set(), events: new Set(), families: new Set(), citations: new Set() };
  for (const c of changes) collect(c, t);
  if (t.citations.size) {
    for (const r of await tx
      .selectFrom('event_citation')
      .select('event_id')
      .where('citation_id', 'in', [...t.citations])
      .execute())
      t.events.add(r.event_id);
  }
  if (t.events.size) {
    for (const r of await tx
      .selectFrom('event_role')
      .select('person_id')
      .where('event_id', 'in', [...t.events])
      .execute())
      t.persons.add(r.person_id);
  }
  if (t.families.size) {
    for (const f of await tx
      .selectFrom('family')
      .select(['partner1_id', 'partner2_id'])
      .where('id', 'in', [...t.families])
      .execute()) {
      for (const p of [f.partner1_id, f.partner2_id]) if (p) t.persons.add(p);
    }
    for (const r of await tx
      .selectFrom('family_child')
      .select('child_id')
      .where('family_id', 'in', [...t.families])
      .execute())
      t.persons.add(r.child_id);
  }
  return [...t.persons];
}
