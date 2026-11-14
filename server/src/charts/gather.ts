import type { ChartRows, HouseChartRows, RowEvent, RowName } from '@rodokmen/shared';
import { sql } from 'kysely';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import { familyLinks, isWeak } from '../tree/relation.js';
import { houseNumbers, numberAt, personSummaries } from '../tree/summaries.js';

/**
 * What a Chart is made from, gathered from the Tree (tree-charts spec; design.md, "Select on the
 * server, lay out and draw in the app"): a fixed number of queries per Chart, whatever its size,
 * and no order taken from the database, since the pure rules sort what they are given. This is
 * the unverified shell around shared/src/charts-model.ts and house-chart-model.ts; the tests in
 * server/test/charts.test.ts cover it, and count its queries.
 */

export interface ChartDeps {
  db: Db;
  clock: Clock;
}

const VITAL = sql<boolean>`(e.type in ('birth', 'baptism') and r.role = 'child') or (e.type in ('death', 'burial') and r.role = 'deceased') or (e.type = 'marriage' and r.role = 'partner')`;

/** The newest accepted change: the state of the Tree a Chart shows. */
async function asOf(db: Db): Promise<ChartRows['asOf']> {
  const row = await db.selectFrom('log_entry').select(['id', 'accepted_at']).orderBy('accepted_at', 'desc').orderBy('id', 'desc').limit(1).executeTakeFirst();
  return { logEntryId: row?.id ?? null, acceptedAt: row ? row.accepted_at.toISOString() : null };
}

/** The ISO day of the clock, in UTC, as the Living rule takes it. */
function today(clock: Clock): string {
  return clock.now().toISOString().slice(0, 10);
}

/**
 * The cards' facts of these Persons and Families: Names, birth or baptism, death or burial and
 * marriage Events with every Role, their Places and house numbers, the Sources cited for them,
 * who is Living, and which links are weak.
 */
async function cardRows(
  { db, clock }: ChartDeps,
  personIds: readonly string[],
  familyIds: readonly string[],
  childLinkIds: readonly string[],
  extraEvents: readonly string[] = [],
) {
  const ids = [...new Set(personIds)];
  const eventIds =
    ids.length === 0
      ? []
      : (
          await db
            .selectFrom('event_role as r')
            .innerJoin('event as e', 'e.id', 'r.event_id')
            .select('e.id')
            .distinct()
            .where('r.person_id', 'in', ids)
            .where(VITAL)
            .execute()
        ).map((r) => r.id);
  const allEvents = [...new Set([...eventIds, ...extraEvents])];
  const events = allEvents.length
    ? await db
        .selectFrom('event as e')
        .leftJoin('house as h', 'h.id', 'e.house_id')
        .select(['e.id', 'e.type', 'e.date', 'e.date_earliest', 'e.date_latest', 'e.place_id', 'e.house_id', 'h.place_id as house_place_id'])
        .where('e.id', 'in', allEvents)
        .execute()
    : [];
  const roles = allEvents.length
    ? await db.selectFrom('event_role').select(['event_id', 'person_id', 'role']).where('event_id', 'in', allEvents).execute()
    : [];
  const cited = allEvents.length
    ? await db
        .selectFrom('event_citation as ec')
        .innerJoin('citation as c', 'c.id', 'ec.citation_id')
        .select(['ec.event_id', 'c.source_id'])
        .where('ec.event_id', 'in', allEvents)
        .execute()
    : [];
  const sourceIds = [...new Set(cited.map((c) => c.source_id))];
  const sources = sourceIds.length ? await db.selectFrom('source').select(['id', 'title']).where('id', 'in', sourceIds).execute() : [];
  const placeIds = [...new Set(events.map((e) => e.place_id ?? e.house_place_id).filter((p): p is string => p !== null))];
  const places = placeIds.length
    ? await db.selectFrom('place_name').select(['place_id', 'name']).where('place_id', 'in', placeIds).where('is_primary', '=', true).execute()
    : [];
  const numbers = await houseNumbers(
    db,
    events.map((e) => e.house_id).filter((h): h is string => h !== null),
  );
  const everyone = [...new Set([...ids, ...roles.map((r) => r.person_id)])];
  const summaries = await personSummaries(db, everyone, clock);
  const names = ids.length
    ? await db.selectFrom('name').select(['id', 'person_id', 'given', 'surname', 'type', 'is_primary', 'sort_order']).where('person_id', 'in', ids).execute()
    : [];
  const weak = new Set((await familyLinks(db, { familyIds, childLinkIds })).filter(isWeak).map((l) => `${l.kind}:${l.recordId}`));
  const placeName = new Map(places.map((p) => [p.place_id, p.name]));
  const rowEvents: RowEvent[] = events.map((e) => {
    const placeId = e.place_id ?? e.house_place_id;
    return {
      id: e.id,
      type: e.type,
      date: e.date,
      placeId,
      place: placeId === null ? null : (placeName.get(placeId) ?? null),
      houseId: e.house_id,
      houseNumber: e.house_id === null ? null : numberAt(numbers.get(e.house_id) ?? [], e.date_earliest, e.date_latest),
      roles: roles.filter((r) => r.event_id === e.id).map((r) => ({ personId: r.person_id, role: r.role })),
      sourceIds: [...new Set(cited.filter((c) => c.event_id === e.id).map((c) => c.source_id))],
    };
  });
  const namesOf = new Map<string, RowName[]>();
  for (const n of names) {
    namesOf.set(n.person_id, [
      ...(namesOf.get(n.person_id) ?? []),
      { id: n.id, given: n.given, surname: n.surname, type: n.type, primary: n.is_primary, order: n.sort_order },
    ]);
  }
  const persons = everyone.flatMap((id) => {
    const s = summaries.get(id);
    return s ? [{ id, sex: s.sex, relation: s.relation, familyRoot: s.familyRoot, living: s.living, names: namesOf.get(id) ?? [] }] : [];
  });
  return { persons, events: rowEvents, sources, weak };
}

/** Families with these partners, and every child link of them. */
async function familiesOf(db: Db, partnerIds: readonly string[]) {
  const families = partnerIds.length
    ? await db
        .selectFrom('family')
        .select(['id', 'partner1_id', 'partner2_id'])
        .where((eb) => eb.or([eb('partner1_id', 'in', [...partnerIds]), eb('partner2_id', 'in', [...partnerIds])]))
        .execute()
    : [];
  const links = families.length
    ? await db
        .selectFrom('family_child')
        .select(['id', 'family_id', 'child_id', 'link_type', 'sort_order'])
        .where(
          'family_id',
          'in',
          families.map((f) => f.id),
        )
        .execute()
    : [];
  return { families, links };
}

/** The Person a merged Person was merged into, or the Person; null when there is none. */
export async function keptPerson(db: Db, id: string): Promise<string | null> {
  const row = await db.selectFrom('person').select(['id', 'merged_into_id']).where('id', '=', id).executeTakeFirst();
  return row ? (row.merged_into_id ?? row.id) : null;
}

export type ChartStart = { personId: string } | { familyId: string };

/**
 * The rows of a Descendant chart: everyone reached from the start through birth and adoptive
 * links within `depth` generations (one recursive query), their Families as partners with every
 * child link, and the cards' facts. The rules then decide who is in the Chart.
 */
export async function gatherDescendants(deps: ChartDeps, start: ChartStart, depth: number): Promise<ChartRows> {
  const { db } = deps;
  const family =
    'familyId' in start ? await db.selectFrom('family').select(['id', 'partner1_id', 'partner2_id']).where('id', '=', start.familyId).executeTakeFirst() : null;
  const starts = 'personId' in start ? [start.personId] : [family?.partner1_id, family?.partner2_id].filter((p): p is string => typeof p === 'string');
  const startFamily = 'familyId' in start ? start.familyId : null;
  const { rows } = await sql<{ person_id: string; generation: number }>`
    with recursive des (person_id, generation, path) as (
      select s, 1, array[s] from unnest(${starts}::uuid[]) as s
      union all
      select fc.child_id, d.generation + 1, d.path || fc.child_id
      from des d
      join family f on f.partner1_id = d.person_id or f.partner2_id = d.person_id
      join family_child fc on fc.family_id = f.id
      where d.generation < ${depth}
        and fc.link_type in ('birth', 'adoptive')
        and not (fc.child_id = any (d.path))
        and (${startFamily}::uuid is null or d.generation > 1 or f.id = ${startFamily}::uuid)
    )
    select person_id, min(generation)::int as generation from des group by person_id
  `.execute(db);
  const inner = rows.filter((r) => r.generation < depth).map((r) => r.person_id);
  const { families, links } = await familiesOf(db, inner);
  const partnerIds = families.flatMap((f) => [f.partner1_id, f.partner2_id]).filter((p): p is string => p !== null);
  const personIds = [...rows.map((r) => r.person_id), ...partnerIds, ...links.map((l) => l.child_id)];
  const cards = await cardRows(
    deps,
    personIds,
    families.map((f) => f.id),
    links.map((l) => l.id),
  );
  return {
    livingOn: today(deps.clock),
    asOf: await asOf(db),
    persons: cards.persons,
    families: families.map((f) => ({ id: f.id, partner1Id: f.partner1_id, partner2Id: f.partner2_id, weakLink: cards.weak.has(`partner:${f.id}`) })),
    childLinks: links.map((l) => ({
      id: l.id,
      familyId: l.family_id,
      childId: l.child_id,
      linkType: l.link_type,
      order: l.sort_order,
      weakLink: cards.weak.has(`parent:${l.id}`),
    })),
    events: cards.events,
    sources: cards.sources,
  };
}

/**
 * The rows of a House chart: the House with its numbers, every Event at it with its Roles, the
 * Families of everyone those Events name (as partners, and the birth or adoptive Families they
 * are children of) with their children, and the cards' facts.
 */
export async function gatherHouse(deps: ChartDeps, houseId: string): Promise<HouseChartRows | null> {
  const { db } = deps;
  const house = await db
    .selectFrom('house as h')
    .leftJoin('place_name as n', (j) => j.onRef('n.place_id', '=', 'h.place_id').on('n.is_primary', '=', true))
    .select(['h.id', 'h.place_id', 'n.name'])
    .where('h.id', '=', houseId)
    .executeTakeFirst();
  if (!house) return null;
  const numbers = await db
    .selectFrom('house_number')
    .select(['number', 'period_from', 'period_to', sql<string>`valid_from::text`.as('valid_from'), sql<string>`valid_to::text`.as('valid_to')])
    .where('house_id', '=', houseId)
    .execute();
  const atHouse = (await db.selectFrom('event').select('id').where('house_id', '=', houseId).execute()).map((e) => e.id);
  const named = atHouse.length
    ? (await db.selectFrom('event_role').select('person_id').distinct().where('event_id', 'in', atHouse).execute()).map((r) => r.person_id)
    : [];
  const birthLinks = named.length
    ? await db.selectFrom('family_child').select('family_id').where('child_id', 'in', named).where('link_type', 'in', ['birth', 'adoptive']).execute()
    : [];
  const asPartner = await familiesOf(db, named);
  const birthFamilies = birthLinks.length
    ? await db
        .selectFrom('family')
        .select(['id', 'partner1_id', 'partner2_id'])
        .where(
          'id',
          'in',
          birthLinks.map((l) => l.family_id),
        )
        .execute()
    : [];
  const familyRows = new Map([...asPartner.families, ...birthFamilies].map((f) => [f.id, f]));
  const links = familyRows.size
    ? await db
        .selectFrom('family_child')
        .select(['id', 'family_id', 'child_id', 'link_type', 'sort_order'])
        .where('family_id', 'in', [...familyRows.keys()])
        .execute()
    : [];
  const partnerIds = [...familyRows.values()].flatMap((f) => [f.partner1_id, f.partner2_id]).filter((p): p is string => p !== null);
  const cards = await cardRows(
    deps,
    [...named, ...partnerIds, ...links.map((l) => l.child_id)],
    [...familyRows.keys()],
    links.map((l) => l.id),
    atHouse,
  );
  return {
    livingOn: today(deps.clock),
    asOf: await asOf(db),
    house: {
      id: house.id,
      placeId: house.place_id,
      place: house.name,
      numbers: numbers.map((n) => ({ number: n.number, from: n.period_from, to: n.period_to, validFrom: n.valid_from, validTo: n.valid_to })),
    },
    persons: cards.persons,
    families: [...familyRows.values()].map((f) => ({
      id: f.id,
      partner1Id: f.partner1_id,
      partner2Id: f.partner2_id,
      weakLink: cards.weak.has(`partner:${f.id}`),
    })),
    childLinks: links.map((l) => ({
      id: l.id,
      familyId: l.family_id,
      childId: l.child_id,
      linkType: l.link_type,
      order: l.sort_order,
      weakLink: cards.weak.has(`parent:${l.id}`),
    })),
    events: cards.events,
    sources: cards.sources,
  };
}
