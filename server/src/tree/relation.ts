import { isStrongLink, relationsOf, RELATIONS, type FamilyLinkById, type Relation } from '@rodokmen/shared';
import { sql } from 'kysely';
import type { Db } from '../db/db.js';

/**
 * The relation to the family on the server (tree-model spec, "Relation to the family is
 * computed", "Relation follows the evidence"): gathers the Family links and their Citations from
 * the Tree, runs the proved rule (relationsOf in shared/src/relation.ts) and stores the result in
 * person.relation.
 *
 * Family links are a Family's two partners (a partner link), and each partner with each child of
 * the Family (a parent link, whatever the link type). A link's Citations are those of the Events
 * that record it: for a partner link, Events in which both have the Role partner (the marriage);
 * for a parent link, Events in which the child has the Role child and the parent the Role father
 * or mother (the baptism or birth). Other Roles, such as godparents and witnesses, link nobody.
 */

/** A Family link with its Citations' confidences, and the record it comes from. */
export interface FamilyLinkRow extends FamilyLinkById {
  kind: 'partner' | 'parent';
  /** The Family of a partner link, the child link (family_child) of a parent link. */
  recordId: string;
}

/**
 * The Family links of the Tree with the confidences of their Citations; with `only`, just the
 * links of these Families and child links (for the tree around one Person).
 */
export async function familyLinks(db: Db, only?: { familyIds: readonly string[]; childLinkIds: readonly string[] }): Promise<FamilyLinkRow[]> {
  const families = only ? sql`and f.id = any(${[...only.familyIds]}::uuid[])` : sql``;
  const childLinks = only ? sql`and fc.id = any(${[...only.childLinkIds]}::uuid[])` : sql``;
  const partners = await sql<{ record_id: string; a: string; b: string; confidences: string[] }>`
    select f.id as record_id, f.partner1_id as a, f.partner2_id as b,
      coalesce(array_agg(distinct c.confidence) filter (where c.confidence is not null), '{}') as confidences
    from family f
    left join event_role r1 on r1.person_id = f.partner1_id and r1.role = 'partner'
    left join event_role r2 on r2.event_id = r1.event_id and r2.person_id = f.partner2_id and r2.role = 'partner'
    left join event_citation ec on ec.event_id = r2.event_id
    left join citation c on c.id = ec.citation_id
    where f.partner1_id is not null and f.partner2_id is not null ${families}
    group by f.id`.execute(db);
  const parents = await sql<{ record_id: string; a: string; b: string; confidences: string[] }>`
    select fc.id as record_id, p.parent as a, fc.child_id as b,
      coalesce(array_agg(distinct c.confidence) filter (where c.confidence is not null), '{}') as confidences
    from family_child fc
    join family f on f.id = fc.family_id
    cross join lateral (values (f.partner1_id), (f.partner2_id)) as p (parent)
    left join event_role rc on rc.person_id = fc.child_id and rc.role = 'child'
    left join event_role rp on rp.event_id = rc.event_id and rp.person_id = p.parent and rp.role in ('father', 'mother')
    left join event_citation ec on ec.event_id = rp.event_id
    left join citation c on c.id = ec.citation_id
    where p.parent is not null ${childLinks}
    group by fc.id, p.parent, fc.child_id`.execute(db);
  return [
    ...partners.rows.map((r) => ({ kind: 'partner' as const, recordId: r.record_id, a: r.a, b: r.b, confidences: r.confidences })),
    ...parents.rows.map((r) => ({ kind: 'parent' as const, recordId: r.record_id, a: r.a, b: r.b, confidences: r.confidences })),
  ];
}

/** Whether a Family link is weak: no Citation of normal or higher confidence supports it (the proved isStrongLink). */
export const isWeak = (link: FamilyLinkById): boolean => !isStrongLink({ a: 0, b: 1, confidences: link.confidences });

/** The Family roots, the first marked first. */
export async function familyRootIds(db: Db): Promise<string[]> {
  const rows = await db
    .selectFrom('family_root as r')
    .innerJoin('person as p', 'p.id', 'r.person_id')
    .select('r.person_id')
    .where('p.merged_into_id', 'is', null)
    .orderBy('r.created_at')
    .orderBy('r.id')
    .execute();
  return rows.map((r) => r.person_id);
}

/**
 * Recomputes every Person's relation from the Tree as it is in this transaction, and stores the
 * ones that changed. Called at the end of every accepted change (a Proposal, a direct change, a
 * merge, an undo, a Family root); a batch of them calls it once at the end. Concurrent changes
 * take turns, so the last to commit computes from everything committed before it.
 */
export async function recomputeRelations(db: Db): Promise<{ changed: number }> {
  await sql`select pg_advisory_xact_lock(hashtext('rodokmen:family-relation'))`.execute(db);
  const persons = await db.selectFrom('person').select(['id', 'relation', 'merged_into_id']).execute();
  const current = persons.filter((p) => p.merged_into_id === null);
  const relations = relationsOf(
    current.map((p) => p.id),
    await familyRootIds(db),
    await familyLinks(db),
  );
  const changes = new Map<Relation, string[]>(RELATIONS.map((r) => [r, []]));
  for (const p of persons) {
    // A merged Person redirects to the kept one and has no relation of its own.
    const next = relations.get(p.id) ?? 'unrelated';
    if (next !== p.relation) changes.get(next)!.push(p.id);
  }
  let changed = 0;
  for (const [relation, ids] of changes) {
    if (ids.length === 0) continue;
    const r = await db
      .updateTable('person')
      .set({ relation })
      .where('id', '=', sql<string>`any(${ids}::uuid[])`)
      .executeTakeFirst();
    changed += Number(r.numUpdatedRows);
  }
  return { changed };
}
