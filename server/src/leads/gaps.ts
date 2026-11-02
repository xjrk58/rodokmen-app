import { GapKind, suggestGaps, type GapMarriage, type GapPerson, type Register } from '@rodokmen/shared';
import { sql } from 'kysely';
import type { Db } from '../db/db.js';
import { serverArchiveLookup, type ArchiveLookup } from './archives.js';

/**
 * The gap finder on the server (research-leads spec, "Gap finder suggests leads"): gathers, for
 * some Persons or for everyone, what the proved rule needs (suggestGaps in shared/src/gaps.ts),
 * and stores its answer as suggested leads, apart from the leads. It runs nightly over everyone
 * and, in the transaction of every accepted change, for the Persons that change touched or whose
 * relation to the family it changed.
 *
 * What the rule gets, and what it does not decide:
 * - Relatives: person.relation, as the relation rule computed it.
 * - A birth or baptism: an Event of type birth or baptism in which the Person has the Role child.
 *   Its years are those of its earliest and latest day; open ends make them unknown. Its Place is
 *   the Event's, or its House's.
 * - Parents known: the Person is a child of a Family with at least one partner.
 * - A marriage: a Family's two partners and the Events in which both have the Role partner, as
 *   the relation rule reads a partner link (server/src/tree/relation.ts); cited when one of them
 *   has a Citation.
 * - The Parishes: those its Place belonged to (place_parish) during the Event's dates.
 * - The registers: Sources with a register Parish, one per kind; open years cover everything.
 * - Decided keys: suggestions a Member dismissed or accepted, which never come back.
 */

/** Years a gap's years are widened by on each side: a baptism may be entered the next year, and an estimate may be off. */
export const SEARCH_MARGIN_YEARS = 1;

const yearOf = (day: string | null): number | null => (day === null || !/^\d{4}-/.test(day) ? null : Number(day.slice(0, 4)));

interface Dated {
  earliest: string | null;
  latest: string | null;
  placeId: string | null;
}

/** The years of some Events (unknown when one has an open end, or none is dated), and the Parishes of their Places then. */
function locate(events: readonly Dated[], parishes: ReadonlyArray<{ place_id: string; parish_id: string; valid_from: string; valid_to: string }>) {
  const dated = events.filter((e) => yearOf(e.earliest) !== null && yearOf(e.latest) !== null);
  const parishIds = new Set<string>();
  for (const e of dated) {
    for (const p of parishes) if (p.place_id === e.placeId && p.valid_from <= e.latest! && e.earliest! <= p.valid_to) parishIds.add(p.parish_id);
  }
  if (dated.length === 0) return { datesKnown: false, from: 0, to: 0, parishIds: [...parishIds], placeId: events.find((e) => e.placeId)?.placeId ?? null };
  return {
    datesKnown: true,
    from: Math.min(...dated.map((e) => yearOf(e.earliest)!)),
    to: Math.max(...dated.map((e) => yearOf(e.latest)!)),
    parishIds: [...parishIds],
    placeId: dated.find((e) => e.placeId)?.placeId ?? events.find((e) => e.placeId)?.placeId ?? null,
  };
}

export const ANY = (ids: readonly string[]) => sql<string>`any(${[...ids]}::uuid[])`;

/** What the rule needs about these Persons (current ones only) and their marriages. */
async function gather(db: Db, personIds: readonly string[]) {
  const persons = await db
    .selectFrom('person')
    .select(['id', 'relation'])
    .where('id', '=', ANY(personIds))
    .where('merged_into_id', 'is', null)
    .orderBy('id')
    .execute();
  const ids = persons.map((p) => p.id);
  if (ids.length === 0)
    return { persons: [] as GapPerson[], marriages: [] as GapMarriage[], places: new Map<string, string | null>(), partnerOf: new Map<string, string>() };
  const births = await db
    .selectFrom('event_role as r')
    .innerJoin('event as e', 'e.id', 'r.event_id')
    .leftJoin('house as h', 'h.id', 'e.house_id')
    .select([
      'r.person_id',
      'e.date_earliest as earliest',
      'e.date_latest as latest',
      sql<string | null>`coalesce(e.place_id, h.place_id)`.as('place_id'),
      sql<boolean>`exists (select 1 from event_citation ec where ec.event_id = e.id)`.as('cited'),
    ])
    .where('r.role', '=', 'child')
    .where('e.type', 'in', ['birth', 'baptism'])
    .where('r.person_id', '=', ANY(ids))
    .execute();
  const withParents = new Set(
    (
      await db
        .selectFrom('family_child as fc')
        .innerJoin('family as f', 'f.id', 'fc.family_id')
        .select('fc.child_id')
        .where('fc.child_id', '=', ANY(ids))
        .where((eb) => eb.or([eb('f.partner1_id', 'is not', null), eb('f.partner2_id', 'is not', null)]))
        .execute()
    ).map((r) => r.child_id),
  );
  const families = await db
    .selectFrom('family as f')
    .innerJoin('person as a', 'a.id', 'f.partner1_id')
    .innerJoin('person as b', 'b.id', 'f.partner2_id')
    .select(['f.id', 'f.partner1_id', 'f.partner2_id', 'a.relation as r1', 'b.relation as r2'])
    .where((eb) => eb.or([eb('f.partner1_id', '=', ANY(ids)), eb('f.partner2_id', '=', ANY(ids))]))
    .where('a.merged_into_id', 'is', null)
    .where('b.merged_into_id', 'is', null)
    .orderBy('f.id')
    .execute();
  const weddings = families.length
    ? await sql<{ family_id: string; earliest: string | null; latest: string | null; place_id: string | null; cited: boolean }>`
        select f.id as family_id, e.date_earliest as earliest, e.date_latest as latest, coalesce(e.place_id, h.place_id) as place_id,
          exists (select 1 from event_citation ec where ec.event_id = e.id) as cited
        from family f
        join event_role r1 on r1.person_id = f.partner1_id and r1.role = 'partner'
        join event_role r2 on r2.event_id = r1.event_id and r2.person_id = f.partner2_id and r2.role = 'partner'
        join event e on e.id = r1.event_id
        left join house h on h.id = e.house_id
        where f.id = ${ANY(families.map((f) => f.id))}`.execute(db)
    : { rows: [] };
  const placeIds = [...new Set([...births, ...weddings.rows].flatMap((e) => (e.place_id ? [e.place_id] : [])))];
  const parishes = placeIds.length
    ? await db.selectFrom('place_parish').select(['place_id', 'parish_id', 'valid_from', 'valid_to']).where('place_id', '=', ANY(placeIds)).execute()
    : [];
  const places = new Map<string, string | null>();
  const gapPersons: GapPerson[] = persons.map((p) => {
    const own = births.filter((b) => b.person_id === p.id);
    const where = locate(
      own.map((b) => ({ earliest: b.earliest, latest: b.latest, placeId: b.place_id })),
      parishes,
    );
    places.set(p.id, where.placeId);
    return {
      personId: p.id,
      relative: p.relation === 'relative',
      birthCited: own.some((b) => b.cited),
      parentsKnown: withParents.has(p.id),
      datesKnown: where.datesKnown,
      from: where.from,
      to: where.to,
      parishIds: where.parishIds,
    };
  });
  const partnerOf = new Map<string, string>();
  const marriages: GapMarriage[] = families.map((f) => {
    const own = weddings.rows.filter((w) => w.family_id === f.id);
    // The years and Place of an uncited marriage Event, the one a search would look for.
    const uncited = own.filter((w) => !w.cited);
    const where = locate(
      (uncited.length ? uncited : own).map((w) => ({ earliest: w.earliest, latest: w.latest, placeId: w.place_id })),
      parishes,
    );
    places.set(f.id, where.placeId);
    partnerOf.set(f.id, f.r1 === 'relative' || f.r2 !== 'relative' ? f.partner1_id! : f.partner2_id!);
    return {
      familyId: f.id,
      relative: f.r1 === 'relative' || f.r2 === 'relative',
      cited: own.some((w) => w.cited),
      datesKnown: where.datesKnown,
      from: where.from,
      to: where.to,
      parishIds: where.parishIds,
    };
  });
  return { persons: gapPersons, marriages, places, partnerOf };
}

/** The registers the Tree holds, one per kind, with their archive. */
async function registers(db: Db): Promise<{ list: Register[]; archives: Map<string, string | null> }> {
  const rows = await db
    .selectFrom('source')
    .select(['id', 'register_parish_id', 'register_kinds', 'register_from', 'register_to', 'repository'])
    .where('register_parish_id', 'is not', null)
    .orderBy('id')
    .execute();
  return {
    list: rows.flatMap((s) =>
      s.register_kinds.map((kind) => ({ sourceId: s.id, parishId: s.register_parish_id!, kind, from: s.register_from ?? 1, to: s.register_to ?? 9999 })),
    ),
    archives: new Map(rows.map((s) => [s.id, s.repository])),
  };
}

/** The subject of a key: kind:subject:source. */
const subjectSql = sql<string>`split_part(key, ':', 2)`;

/**
 * Recomputes the suggested leads of these Persons (and of the marriages they are partners in),
 * or of everyone. New gaps are stored as open suggestions, open ones whose gap is gone are
 * removed, and decided ones are kept, so their keys never come back. Concurrent runs take turns.
 */
export async function refreshSuggestions(
  db: Db,
  now: Date,
  scope: { personIds: readonly string[] } | 'everyone',
  archives: ArchiveLookup = serverArchiveLookup(),
): Promise<{ open: number }> {
  await sql`select pg_advisory_xact_lock(hashtext('rodokmen:lead-suggestions'))`.execute(db);
  const personIds =
    scope === 'everyone'
      ? (await db.selectFrom('person').select('id').where('merged_into_id', 'is', null).execute()).map((p) => p.id)
      : [...new Set(scope.personIds)];
  const { persons, marriages, places, partnerOf } = await gather(db, personIds);
  const subjects = [...persons.map((p) => p.personId), ...marriages.map((m) => m.familyId)];
  const decided =
    subjects.length === 0
      ? []
      : (
          await db
            .selectFrom('lead_suggestion')
            .select('key')
            .where('status', '!=', 'open')
            .where(sql<boolean>`${subjectSql} = any(${subjects}::text[])`)
            .execute()
        ).map((r) => r.key);
  const regs = await registers(db);
  const found = suggestGaps(persons, marriages, regs.list, decided, SEARCH_MARGIN_YEARS);

  const municipalities = new Map(
    (
      await db
        .selectFrom('place')
        .select(['id', 'municipality_code'])
        .where('id', '=', ANY([...new Set([...places.values()].filter((x): x is string => x !== null))]))
        .execute()
    ).map((p) => [p.id, p.municipality_code]),
  );
  const rows = found.map((s) => {
    const marriage = s.kind === 'marriage';
    const placeId = places.get(s.subjectId) ?? null;
    const archive = s.sourceId ? (regs.archives.get(s.sourceId) ?? null) : archives.archiveOf(placeId ? (municipalities.get(placeId) ?? null) : null);
    return {
      key: s.key,
      kind: GapKind.parse(s.kind),
      person_id: marriage ? (partnerOf.get(s.subjectId) ?? null) : s.subjectId,
      family_id: marriage ? s.subjectId : null,
      source_id: s.sourceId || null,
      place_id: placeId,
      archive,
      years_from: s.from === 0 && s.to === 0 ? null : s.from,
      years_to: s.from === 0 && s.to === 0 ? null : s.to,
      computed_at: now,
    };
  });
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insertInto('lead_suggestion')
      .values(rows.slice(i, i + 500))
      .onConflict((oc) =>
        oc
          .column('key')
          .doUpdateSet((eb) => ({
            person_id: eb.ref('excluded.person_id'),
            family_id: eb.ref('excluded.family_id'),
            place_id: eb.ref('excluded.place_id'),
            archive: eb.ref('excluded.archive'),
            years_from: eb.ref('excluded.years_from'),
            years_to: eb.ref('excluded.years_to'),
            computed_at: eb.ref('excluded.computed_at'),
          }))
          .where('lead_suggestion.status', '=', 'open'),
      )
      .execute();
  }
  // Open suggestions of these subjects whose gap is gone. Everyone: also those of Persons and Families no longer there.
  const keys = rows.map((r) => r.key);
  let stale = db.deleteFrom('lead_suggestion').where('status', '=', 'open');
  if (scope !== 'everyone') {
    const scopeSubjects = [...new Set([...personIds, ...marriages.map((m) => m.familyId)])];
    stale = stale.where(sql<boolean>`${subjectSql} = any(${scopeSubjects}::text[])`);
  }
  if (keys.length) stale = stale.where('key', '!=', sql<string>`all(${keys}::text[])`);
  await stale.execute();
  return { open: rows.length };
}
