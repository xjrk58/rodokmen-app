import {
  birthWindow,
  isSuggested,
  nameMatches,
  nameVariants,
  scoreCandidate,
  tryParseEdtf,
  type CandidateFacts,
  type MatchCandidate,
  type PersonMatches,
  type ReadEntry,
  type ReadFacts,
  type ReadingResult,
  type ReadPerson,
} from '@rodokmen/shared';
import { sql } from 'kysely';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import { personSummaries } from '../tree/summaries.js';

/**
 * The candidate query of name matching (scan-reading spec, "Names are matched, not duplicated";
 * add-scan-reading task 2.2): Persons of the Tree a read name may refer to, from the Tree and
 * never from the model. It finds Persons by their folded names, gathers what the rule needs (all
 * their Names, birth years, Houses with the numbers they carried then, Places and partners), and
 * scores each with scoreCandidate (shared/src/matching.ts, proved). Best first, at most
 * MAX_CANDIDATES per read person.
 */
export const MAX_CANDIDATES = 5;
/** Persons a reading looks at, at most. */
const MAX_PERSONS = 400;

const yearOfDay = (day: string | null): number | null => (day && /^\d{4}-/.test(day) ? Number(day.slice(0, 4)) : null);

/** The year of an entry, from its date. */
function entryYear(e: ReadEntry): number | null {
  if (e.date === null) return null;
  const parsed = tryParseEdtf(e.date);
  return parsed.ok ? yearOfDay(parsed.value.earliest) : null;
}

const variantsOf = (p: ReadPerson, part: 'given' | 'surname') => [
  ...new Set(p.names.flatMap((n) => nameVariants(n[part], part === 'given' ? 'given' : 'surname'))),
];

/** The facts of one read person: their name variants, house, Place and the birth years their role allows. */
export function readFacts(e: ReadEntry, p: ReadPerson, placeId: string | null): ReadFacts {
  const year = entryYear(e);
  const window = year === null ? null : birthWindow(p.role, year);
  // The entry's house is the household's: the child's and the parents'.
  const house = p.house ?? (['child', 'father', 'mother'].includes(p.role) ? e.house : null);
  return {
    givens: variantsOf(p, 'given'),
    surnames: variantsOf(p, 'surname'),
    house: house ?? '',
    placeId: placeId ?? '',
    hasWindow: window !== null,
    windowFrom: window?.from ?? 0,
    windowTo: window?.to ?? 0,
  };
}

/** Who a read person's partner in the entry is: the mother for a father, the other partner of a marriage. */
function partnerIn(e: ReadEntry, p: ReadPerson): ReadPerson | undefined {
  if (p.role === 'father') return e.persons.find((x) => x.role === 'mother');
  if (p.role === 'mother') return e.persons.find((x) => x.role === 'father');
  if (p.role === 'partner') return e.persons.find((x) => x.role === 'partner' && x.key !== p.key);
  return undefined;
}

interface Gathered {
  ids: string[];
  facts: Map<string, Omit<CandidateFacts, 'family'> & { partners: string[] }>;
  names: Map<string, Array<{ given: string; surname: string }>>;
}

/** Everything the rule needs about these Persons, in a few queries. */
async function gather(db: Db, ids: readonly string[]): Promise<Gathered> {
  const unique = [...new Set(ids)];
  const out: Gathered = { ids: unique, facts: new Map(), names: new Map() };
  if (unique.length === 0) return out;
  const names = await db.selectFrom('name').select(['person_id', 'given', 'surname']).where('person_id', 'in', unique).execute();
  const events = await db
    .selectFrom('event_role as r')
    .innerJoin('event as e', 'e.id', 'r.event_id')
    .leftJoin('house as h', 'h.id', 'e.house_id')
    .select(['r.person_id', 'r.role', 'e.type', 'e.date_earliest', 'e.date_latest', 'e.place_id', 'h.place_id as house_place_id', 'e.house_id'])
    .where('r.person_id', 'in', unique)
    .execute();
  // House numbers as each House carried them at the time of the Event.
  const numbers = await db
    .selectFrom('event_role as r')
    .innerJoin('event as e', 'e.id', 'r.event_id')
    .innerJoin('house_number as hn', 'hn.house_id', 'e.house_id')
    .select(['r.person_id', 'hn.number'])
    .where('r.person_id', 'in', unique)
    .where((eb) => eb.or([eb('e.date_latest', 'is', null), eb('hn.valid_from', '<=', eb.ref('e.date_latest'))]))
    .where((eb) => eb.or([eb('e.date_earliest', 'is', null), eb('hn.valid_to', '>=', eb.ref('e.date_earliest'))]))
    .execute();
  const partners = await db
    .selectFrom('family as f')
    .select(['f.partner1_id', 'f.partner2_id'])
    .where((eb) => eb.or([eb('f.partner1_id', 'in', unique), eb('f.partner2_id', 'in', unique)]))
    .execute();
  const partnerIds = [...new Set(partners.flatMap((f) => [f.partner1_id, f.partner2_id]).filter((x): x is string => x !== null))];
  const partnerNames = partnerIds.length
    ? await db.selectFrom('name').select(['person_id', 'given', 'surname']).where('person_id', 'in', partnerIds).execute()
    : [];
  for (const n of [...names, ...partnerNames]) out.names.set(n.person_id, [...(out.names.get(n.person_id) ?? []), { given: n.given, surname: n.surname }]);
  for (const id of unique) {
    const own = out.names.get(id) ?? [];
    const mine = events.filter((e) => e.person_id === id);
    const births = mine.filter((e) => e.role === 'child' && (e.type === 'birth' || e.type === 'baptism'));
    const from = births.map((b) => yearOfDay(b.date_earliest)).filter((y): y is number => y !== null);
    const to = births.map((b) => yearOfDay(b.date_latest)).filter((y): y is number => y !== null);
    out.facts.set(id, {
      givens: [...new Set(own.flatMap((n) => nameVariants(n.given, 'given')))],
      surnames: [...new Set(own.flatMap((n) => nameVariants(n.surname, 'surname')))],
      houses: [...new Set(numbers.filter((n) => n.person_id === id).map((n) => n.number))],
      placeIds: [...new Set(mine.flatMap((e) => [e.place_id, e.house_place_id]).filter((x): x is string => x !== null))],
      hasBirth: from.length > 0 && to.length > 0,
      birthFrom: from.length ? Math.min(...from) : 0,
      birthTo: to.length ? Math.max(...to) : 0,
      partners: partners
        .flatMap((f) => (f.partner1_id === id ? [f.partner2_id] : f.partner2_id === id ? [f.partner1_id] : []))
        .filter((x): x is string => x !== null),
    });
  }
  return out;
}

/** LIKE patterns for the start of each surname variant, so other spellings are found and the rule then decides. */
function surnamePatterns(result: ReadingResult): string[] {
  const stems = result.entries.flatMap((e) => e.persons.flatMap((p) => variantsOf(p, 'surname'))).map((v) => v.slice(0, Math.max(3, v.length - 2)));
  return [...new Set(stems.filter((s) => s.length >= 3))].map((s) => `%${s.replace(/[\\%_]/g, '\\$&')}%`);
}

/** For each read person, the existing Persons it may be, best first, with the reasons. */
export async function matchesFor(db: Db, clock: Clock, result: ReadingResult, placeId: string | null): Promise<PersonMatches[]> {
  const patterns = surnamePatterns(result);
  const found = patterns.length
    ? await db
        .selectFrom('name as n')
        .innerJoin('person as p', 'p.id', 'n.person_id')
        .select('n.person_id')
        .distinct()
        .where('p.merged_into_id', 'is', null)
        .where(sql<boolean>`rdk_fold(n.surname) like any(${sql.val(patterns)}::text[])`)
        .orderBy('n.person_id')
        .limit(MAX_PERSONS)
        .execute()
    : [];
  const gathered = await gather(
    db,
    found.map((f) => f.person_id),
  );
  const scored: Array<{ key: string; id: string; score: ReturnType<typeof scoreCandidate> }> = [];
  for (const e of result.entries) {
    for (const p of e.persons) {
      const read = readFacts(e, p, placeId);
      const partner = partnerIn(e, p);
      const partnerFacts = partner ? readFacts(e, partner, placeId) : null;
      for (const id of gathered.ids) {
        const f = gathered.facts.get(id)!;
        const family =
          partnerFacts !== null &&
          f.partners.some((pid) => {
            const names = gathered.names.get(pid) ?? [];
            const facts: CandidateFacts = {
              givens: names.flatMap((n) => nameVariants(n.given, 'given')),
              surnames: names.flatMap((n) => nameVariants(n.surname, 'surname')),
              houses: [],
              placeIds: [],
              hasBirth: false,
              birthFrom: 0,
              birthTo: 0,
              family: false,
            };
            return nameMatches(partnerFacts, facts);
          });
        const facts: CandidateFacts = { ...f, family };
        if (isSuggested(read, facts)) scored.push({ key: p.key, id, score: scoreCandidate(read, facts) });
      }
    }
  }
  const summaries = await personSummaries(
    db,
    scored.map((s) => s.id),
    clock,
  );
  return result.entries.flatMap((e) =>
    e.persons.map((p) => {
      const candidates: MatchCandidate[] = scored
        .filter((s) => s.key === p.key && summaries.has(s.id))
        .map((s) => ({ person: summaries.get(s.id)!, score: s.score.score, reasons: s.score.reasons }))
        .sort((a, b) => b.score - a.score || a.person.displayName.localeCompare(b.person.displayName, 'cs') || a.person.id.localeCompare(b.person.id))
        .slice(0, MAX_CANDIDATES);
      return { key: p.key, candidates };
    }),
  );
}

/** For each entry, the House of the reading's Place that carried its house number at the entry's date, when exactly one did. */
export async function housesFor(db: Db, result: ReadingResult, placeId: string | null): Promise<Array<string | null>> {
  return Promise.all(
    result.entries.map(async (e) => {
      if (!placeId || !e.house) return null;
      const range = e.date ? tryParseEdtf(e.date) : null;
      let q = db
        .selectFrom('house_number as hn')
        .innerJoin('house as h', 'h.id', 'hn.house_id')
        .select('h.id')
        .distinct()
        .where('h.place_id', '=', placeId)
        .where('hn.number', '=', e.house);
      if (range?.ok && range.value.earliest && range.value.latest) {
        q = q.where('hn.valid_from', '<=', range.value.latest).where('hn.valid_to', '>=', range.value.earliest);
      }
      const rows = await q.execute();
      return rows.length === 1 ? rows[0]!.id : null;
    }),
  );
}
