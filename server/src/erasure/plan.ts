import {
  citationsLeft,
  isLiving,
  livingFactsFromEvents,
  theirRows,
  theirsAlone,
  type AttachedCitation,
  type OwnedRow,
  type SharedRecord,
} from '@rodokmen/shared';
import { sql } from 'kysely';
import { ApiProblem } from '../auth/problem.js';
import type { Db } from '../db/db.js';
import { displayName } from '../tree/summaries.js';

/**
 * What erasing a Person removes (erasure spec, "Owner erases a Living person"), gathered from the
 * database for the proved rules of shared/src/erasure.ts to choose: the rows of the Person, the
 * Events and images that are theirs alone, the Citations left attached to nothing, and the log
 * changes and Proposals that mention any of it. Used by the erasure (service.ts) and the preview
 * the Owner reads first (preview.ts).
 */

/** What erasing one Person removes. */
export interface Plan {
  personId: string;
  /** The Person and any Persons merged into them (redirects, without data of their own). */
  personIds: string[];
  name: string;
  living: boolean;
  rows: OwnedRow[];
  events: string[];
  citations: string[];
  images: Array<{ id: string; storage_key: string; display_key: string | null }>;
  families: string[];
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function personName(db: Db, personId: string): Promise<string> {
  const n = await db.selectFrom('name').select(['given', 'surname']).where('person_id', '=', personId).where('is_primary', '=', true).executeTakeFirst();
  return n ? displayName(n.given, n.surname) : '';
}

async function livingNow(db: Db, personId: string, today: Date): Promise<boolean> {
  const events = await db
    .selectFrom('event_role as r')
    .innerJoin('event as e', 'e.id', 'r.event_id')
    .select(['e.type', 'r.role', 'e.date'])
    .where('r.person_id', '=', personId)
    .execute();
  return isLiving(livingFactsFromEvents(events), today);
}

/** Gathers what erasing the Person removes; the rules that choose are the proved ones. */
export async function planErasure(db: Db, personId: string, today: Date): Promise<Plan> {
  const merged = await db.selectFrom('person').select('id').where('merged_into_id', '=', personId).execute();
  const personIds = [personId, ...merged.map((m) => m.id)];

  const owned: OwnedRow[] = [];
  const own = async (table: 'name' | 'event_role' | 'image_person' | 'person_label' | 'family_root') => {
    for (const r of await db.selectFrom(table).select(['id', 'person_id']).where('person_id', 'in', personIds).execute())
      owned.push({ table, id: r.id, personId: r.person_id });
  };
  await own('name');
  await own('event_role');
  await own('image_person');
  await own('person_label');
  await own('family_root');
  for (const r of await db.selectFrom('family_child').select(['id', 'child_id']).where('child_id', 'in', personIds).execute())
    owned.push({ table: 'family_child', id: r.id, personId: r.child_id });
  const rows = personIds.flatMap((id) => theirRows(owned, id));

  // Events: the Persons who have a Role in each Event the Person took part in.
  const roleEvents = [...new Set(rows.filter((r) => r.table === 'event_role').map((r) => r.id))];
  const eventIds = roleEvents.length
    ? [...new Set((await db.selectFrom('event_role').select('event_id').where('id', 'in', roleEvents).execute()).map((r) => r.event_id))]
    : [];
  const events = await shared(db, 'event_role', eventIds);
  const goneEvents = theirsAlone(events, personId).map((e) => e.id);

  // Families left with nobody: no partner and no child but the Person.
  const familyIds = [
    ...new Set([
      ...(
        await db
          .selectFrom('family')
          .select('id')
          .where((eb) => eb.or([eb('partner1_id', 'in', personIds), eb('partner2_id', 'in', personIds)]))
          .execute()
      ).map((f) => f.id),
      ...(await db.selectFrom('family_child').select('family_id').where('child_id', 'in', personIds).execute()).map((f) => f.family_id),
    ]),
  ];
  const families: SharedRecord[] = [];
  if (familyIds.length) {
    const fams = await db.selectFrom('family').select(['id', 'partner1_id', 'partner2_id']).where('id', 'in', familyIds).execute();
    const children = await db.selectFrom('family_child').select(['family_id', 'child_id']).where('family_id', 'in', familyIds).execute();
    for (const f of fams) {
      const persons = [f.partner1_id, f.partner2_id, ...children.filter((c) => c.family_id === f.id).map((c) => c.child_id)].filter(
        (p): p is string => p !== null,
      );
      families.push({ id: f.id, persons: persons.map((p) => (personIds.includes(p) ? personId : p)) });
    }
  }
  const goneFamilies = theirsAlone(families, personId).map((f) => f.id);

  // Citations attached only to Events and Names that go.
  const nameIds = rows.filter((r) => r.table === 'name').map((r) => r.id);
  const removed = [...goneEvents, ...nameIds];
  const candidateIds = removed.length
    ? [
        ...new Set([
          ...(goneEvents.length ? await db.selectFrom('event_citation').select('citation_id').where('event_id', 'in', goneEvents).execute() : []),
          ...(nameIds.length ? await db.selectFrom('name_citation').select('citation_id').where('name_id', 'in', nameIds).execute() : []),
        ]),
      ].map((c) => c.citation_id)
    : [];
  const candidates: AttachedCitation[] = [];
  if (candidateIds.length) {
    const onEvents = await db.selectFrom('event_citation').select(['citation_id', 'event_id']).where('citation_id', 'in', candidateIds).execute();
    const onNames = await db.selectFrom('name_citation').select(['citation_id', 'name_id']).where('citation_id', 'in', candidateIds).execute();
    for (const id of [...new Set(candidateIds)]) {
      candidates.push({
        id,
        attachedTo: [
          ...onEvents.filter((a) => a.citation_id === id).map((a) => a.event_id),
          ...onNames.filter((a) => a.citation_id === id).map((a) => a.name_id),
        ],
      });
    }
  }
  const goneCitations = citationsLeft(candidates, removed).map((c) => c.id);

  // Images that show only them, and the page images of the Citations that go.
  const shown = [...new Set(rows.filter((r) => r.table === 'image_person').map((r) => r.id))];
  const shownImageIds = shown.length
    ? [...new Set((await db.selectFrom('image_person').select('image_id').where('id', 'in', shown).execute()).map((r) => r.image_id))]
    : [];
  const subjects = await shared(db, 'image_person', shownImageIds);
  const imageIds = new Set(theirsAlone(subjects, personId).map((i) => i.id));
  if (goneCitations.length) for (const i of await db.selectFrom('image').select('id').where('citation_id', 'in', goneCitations).execute()) imageIds.add(i.id);
  const images = imageIds.size
    ? await db
        .selectFrom('image')
        .select(['id', 'storage_key', 'display_key'])
        .where('id', 'in', [...imageIds])
        .execute()
    : [];

  return {
    personId,
    personIds,
    name: await personName(db, personId),
    living: await livingNow(db, personId, today),
    rows,
    events: goneEvents,
    citations: goneCitations,
    images,
    families: goneFamilies,
  };
}

/** Records shared by Persons (Events through their Roles, images through their subjects), with those Persons. */
async function shared(db: Db, table: 'event_role' | 'image_person', ids: string[]): Promise<SharedRecord[]> {
  if (ids.length === 0) return [];
  const links =
    table === 'event_role'
      ? await db.selectFrom('event_role').select(['event_id as record', 'person_id']).where('event_id', 'in', ids).execute()
      : await db.selectFrom('image_person').select(['image_id as record', 'person_id']).where('image_id', 'in', ids).execute();
  return ids.map((id) => ({ id, persons: links.filter((l) => l.record === id).map((l) => l.person_id) }));
}

/** Every record id the erasure removes, for the log and the id maps. */
export function erasedIds(plan: Plan): string[] {
  return [...new Set([...plan.personIds, ...plan.rows.map((r) => r.id), ...plan.events, ...plan.citations, ...plan.images.map((i) => i.id), ...plan.families])];
}

/** Log changes that mention any of the ids, before or after, or are changes of one of them. */
export async function mentioningChanges(db: Db, ids: string[]) {
  return db
    .selectFrom('log_change as c')
    .select(['c.id', 'c.log_entry_id', 'c.record_id', 'c.before', 'c.after'])
    .where((eb) =>
      eb.or([
        eb('c.record_id', 'in', ids),
        sql<boolean>`exists (select 1 from jsonb_each_text(coalesce(c.before, '{}'::jsonb)) kv where kv.value = any(${ids}::text[]))`,
        sql<boolean>`exists (select 1 from jsonb_each_text(coalesce(c.after, '{}'::jsonb)) kv where kv.value = any(${ids}::text[]))`,
      ]),
    )
    .orderBy('c.id')
    .execute();
}

/** Proposals whose operations, as written or as corrected, mention any of the ids anywhere. */
export async function mentioningProposals(db: Db, ids: string[]): Promise<string[]> {
  const mentions = (column: 'operation' | 'corrected') =>
    sql<boolean>`exists (select 1 from jsonb_path_query(coalesce(o.${sql.ref(column)}, '{}'::jsonb), 'strict $.**') v where jsonb_typeof(v) = 'string' and v #>> '{}' = any(${ids}::text[]))`;
  const rows = await db
    .selectFrom('proposal_operation as o')
    .select('o.proposal_id')
    .distinct()
    .where((eb) => eb.or([eb('o.target_id', 'in', ids), mentions('operation'), mentions('corrected')]))
    .execute();
  return rows.map((r) => r.proposal_id);
}

export async function findPerson(db: Db, personId: string, lock = false) {
  let q = db.selectFrom('person').select(['id', 'merged_into_id']).where('id', '=', personId);
  if (lock) q = q.forUpdate();
  const person = await q.executeTakeFirst();
  if (!person) throw new ApiProblem(404, 'not_found', 'No Person with this id.');
  if (person.merged_into_id)
    throw new ApiProblem(409, 'merged', 'This Person was merged into another; erase the Person it was merged into, and this one goes with them.');
  return person;
}
