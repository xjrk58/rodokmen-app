import type { Hourglass, Pedigree } from '@rodokmen/shared';
import { sql } from 'kysely';
import type { TreeDeps } from './persons.js';
import { personSummaries } from './summaries.js';

/**
 * Ancestors of a Person in one request: a recursive CTE walks child links up to the partners
 * of each Family, for `generations` generations counting the root as the first. Every kind of
 * child link is followed (birth, adoptive, foster, step) and returned with its type. The path
 * array stops cycles; a Person reached twice (pedigree collapse) keeps the nearest generation.
 */
export async function ancestors({ db, clock }: TreeDeps, rootId: string, generations: number): Promise<Pedigree | null> {
  const root = await db.selectFrom('person').select('id').where('id', '=', rootId).executeTakeFirst();
  if (!root) return null;
  const { rows } = await sql<{ person_id: string; generation: number }>`
    with recursive anc (person_id, generation, path) as (
      select ${rootId}::uuid, 1, array[${rootId}::uuid]
      union all
      select p.partner_id, a.generation + 1, a.path || p.partner_id
      from anc a
      join family_child fc on fc.child_id = a.person_id
      join family f on f.id = fc.family_id
      cross join lateral (values (f.partner1_id), (f.partner2_id)) as p (partner_id)
      where p.partner_id is not null
        and a.generation < ${generations}
        and not (p.partner_id = any (a.path))
    )
    select person_id, min(generation)::int as generation from anc group by person_id
  `.execute(db);

  const inner = rows.filter((r) => r.generation < generations).map((r) => r.person_id);
  const links = inner.length
    ? await db
        .selectFrom('family_child as fc')
        .innerJoin('family as f', 'f.id', 'fc.family_id')
        .select(['fc.id', 'fc.family_id', 'fc.child_id', 'fc.link_type', 'f.version', 'f.partner1_id', 'f.partner2_id'])
        .where('fc.child_id', 'in', inner)
        .orderBy('fc.family_id')
        .orderBy('fc.id')
        .execute()
    : [];
  const summaries = await personSummaries(
    db,
    rows.map((r) => r.person_id),
    clock,
  );
  const families = new Map(links.map((l) => [l.family_id, { id: l.family_id, version: l.version, partner1Id: l.partner1_id, partner2Id: l.partner2_id }]));
  return {
    rootId,
    direction: 'ancestors',
    generations,
    persons: rows
      .sort((a, b) => a.generation - b.generation || a.person_id.localeCompare(b.person_id))
      .map((r) => ({
        generation: r.generation,
        relation: r.generation === 1 ? ('root' as const) : ('ancestor' as const),
        person: summaries.get(r.person_id)!,
      })),
    families: [...families.values()],
    childLinks: links.map((l) => ({ id: l.id, familyId: l.family_id, childId: l.child_id, linkType: l.link_type })),
  };
}

/**
 * Descendants of a Person in one request, the mirror of {@link ancestors}: from each Person to
 * the children of every Family they are a partner in. The other partner of each such Family
 * is included with relation "partner", so that the chart can show both parents. With
 * `partnersAtEdge`, the descendants of the last generation get their partners too (but not
 * their children), as the hourglass shows partners beside every Person.
 */
export async function descendants(
  { db, clock }: TreeDeps,
  rootId: string,
  generations: number,
  { partnersAtEdge = false }: { partnersAtEdge?: boolean } = {},
): Promise<Pedigree | null> {
  const root = await db.selectFrom('person').select('id').where('id', '=', rootId).executeTakeFirst();
  if (!root) return null;
  const { rows } = await sql<{ person_id: string; generation: number }>`
    with recursive des (person_id, generation, path) as (
      select ${rootId}::uuid, 1, array[${rootId}::uuid]
      union all
      select fc.child_id, d.generation + 1, d.path || fc.child_id
      from des d
      join family f on f.partner1_id = d.person_id or f.partner2_id = d.person_id
      join family_child fc on fc.family_id = f.id
      where d.generation < ${generations}
        and not (fc.child_id = any (d.path))
    )
    select person_id, min(generation)::int as generation from des group by person_id
  `.execute(db);

  const inner = partnersAtEdge ? rows : rows.filter((r) => r.generation < generations);
  const generationOf = new Map(rows.map((r) => [r.person_id, r.generation]));
  const familyRows = inner.length
    ? await db
        .selectFrom('family')
        .select(['id', 'version', 'partner1_id', 'partner2_id'])
        .where((eb) =>
          eb.or([
            eb(
              'partner1_id',
              'in',
              inner.map((r) => r.person_id),
            ),
            eb(
              'partner2_id',
              'in',
              inner.map((r) => r.person_id),
            ),
          ]),
        )
        .orderBy('id')
        .execute()
    : [];
  const links = familyRows.length
    ? await db
        .selectFrom('family_child')
        .select(['id', 'family_id', 'child_id', 'link_type'])
        .where(
          'family_id',
          'in',
          familyRows.map((f) => f.id),
        )
        .orderBy('family_id')
        .orderBy('sort_order')
        .execute()
    : [];
  const partners = new Map<string, number>();
  for (const f of familyRows) {
    const g1 = f.partner1_id ? generationOf.get(f.partner1_id) : undefined;
    const g2 = f.partner2_id ? generationOf.get(f.partner2_id) : undefined;
    if (f.partner1_id && g1 === undefined && g2 !== undefined) partners.set(f.partner1_id, g2);
    if (f.partner2_id && g2 === undefined && g1 !== undefined) partners.set(f.partner2_id, g1);
  }
  const summaries = await personSummaries(db, [...rows.map((r) => r.person_id), ...partners.keys()], clock);
  const persons = [
    ...rows.map((r) => ({
      generation: r.generation,
      relation: r.generation === 1 ? ('root' as const) : ('descendant' as const),
      person: summaries.get(r.person_id)!,
    })),
    ...[...partners].map(([id, generation]) => ({ generation, relation: 'partner' as const, person: summaries.get(id)! })),
  ].sort((a, b) => a.generation - b.generation || a.person.id.localeCompare(b.person.id));
  return {
    rootId,
    direction: 'descendants',
    generations,
    persons,
    families: familyRows.map((f) => ({ id: f.id, version: f.version, partner1Id: f.partner1_id, partner2Id: f.partner2_id })),
    childLinks: links.filter((l) => generationOf.has(l.child_id)).map((l) => ({ id: l.id, familyId: l.family_id, childId: l.child_id, linkType: l.link_type })),
  };
}

/**
 * The hourglass around a focus Person in one request (family-tree spec, "Hourglass layout"):
 * ancestors `up` generations above, descendants `down` generations below, the partners of the
 * focus Person and of every descendant, and the Families and child links between them. Persons
 * in the top and bottom rows say whether the Tree knows more beyond them.
 */
export async function hourglass(deps: TreeDeps, focusId: string, up: number, down: number): Promise<Hourglass | null> {
  const anc = await ancestors(deps, focusId, up + 1);
  const des = anc ? await descendants(deps, focusId, down + 1, { partnersAtEdge: true }) : null;
  if (!anc || !des) return null;

  const persons = new Map<string, Hourglass['persons'][number]>();
  const add = (entry: Omit<Hourglass['persons'][number], 'moreAbove' | 'moreBelow'>) => {
    if (!persons.has(entry.person.id)) persons.set(entry.person.id, { ...entry, moreAbove: false, moreBelow: false });
  };
  for (const p of anc.persons) add({ generation: p.generation - 1, relation: p.relation === 'root' ? 'focus' : 'ancestor', person: p.person });
  for (const p of des.persons) {
    if (p.relation === 'root') continue;
    add({ generation: 1 - p.generation, relation: p.relation === 'partner' ? 'partner' : 'descendant', person: p.person });
  }

  const top = [...persons.values()].filter((p) => p.relation === 'ancestor' && p.generation === up).map((p) => p.person.id);
  const bottom = [...persons.values()].filter((p) => p.relation === 'descendant' && p.generation === -down).map((p) => p.person.id);
  const withParents = top.length
    ? await deps.db
        .selectFrom('family_child as fc')
        .innerJoin('family as f', 'f.id', 'fc.family_id')
        .select('fc.child_id')
        .distinct()
        .where('fc.child_id', 'in', top)
        .where((eb) => eb.or([eb('f.partner1_id', 'is not', null), eb('f.partner2_id', 'is not', null)]))
        .execute()
    : [];
  const withChildren = bottom.length
    ? await deps.db
        .selectFrom('family as f')
        .innerJoin('family_child as fc', 'fc.family_id', 'f.id')
        .select(['f.partner1_id', 'f.partner2_id'])
        .where((eb) => eb.or([eb('f.partner1_id', 'in', bottom), eb('f.partner2_id', 'in', bottom)]))
        .execute()
    : [];
  for (const r of withParents) persons.get(r.child_id)!.moreAbove = true;
  const bottomSet = new Set(bottom);
  for (const r of withChildren) {
    for (const id of [r.partner1_id, r.partner2_id]) if (id && bottomSet.has(id)) persons.get(id)!.moreBelow = true;
  }

  const families = new Map([...anc.families, ...des.families].map((f) => [f.id, f]));
  const childLinks = new Map([...anc.childLinks, ...des.childLinks].map((l) => [l.id, l]));
  return {
    focusId,
    up,
    down,
    persons: [...persons.values()].sort((a, b) => b.generation - a.generation || a.person.id.localeCompare(b.person.id)),
    families: [...families.values()].sort((a, b) => a.id.localeCompare(b.id)),
    childLinks: [...childLinks.values()],
  };
}
