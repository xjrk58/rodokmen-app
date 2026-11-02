import { leadSuggestions, type LeadSuggestion, type ReadingResult, type RegisterOption } from '@rodokmen/shared';
import { sql } from 'kysely';
import type { Db } from '../db/db.js';
import { placeAndParishes, type ParishPeriod } from './context.js';

/**
 * Suggested leads of a reading (scan-reading spec, "Reading suggests next steps"): the templates in
 * shared/src/reading-leads.ts, with the Parish of the reading's Place and the registers the Tree
 * holds for it, so a suggestion names a real Source. The Tree's registers of a Parish are the
 * parish register Sources cited for Events in its Places, with the kinds of Event and the years
 * they were cited for.
 *
 * Accepting a suggestion as a Research lead needs add-research-leads (#16), which is not built
 * yet: until then the app shows the suggestions and lets the Member dismiss them.
 */
export async function registersOf(db: Db, parishIds: readonly string[]): Promise<RegisterOption[]> {
  if (parishIds.length === 0) return [];
  const rows = await db
    .selectFrom('source as s')
    .innerJoin('citation as c', 'c.source_id', 's.id')
    .innerJoin('event_citation as ec', 'ec.citation_id', 'c.id')
    .innerJoin('event as e', 'e.id', 'ec.event_id')
    .leftJoin('house as h', 'h.id', 'e.house_id')
    .innerJoin('place_parish as pp', (j) => j.on(sql<boolean>`pp.place_id = coalesce(e.place_id, h.place_id)`))
    .select([
      's.id',
      's.title',
      'e.type',
      sql<number | null>`min(extract(year from e.date_earliest))::int`.as('from'),
      sql<number | null>`max(extract(year from e.date_latest))::int`.as('to'),
    ])
    .where('s.type', '=', 'parish_register')
    .where('pp.parish_id', 'in', [...parishIds])
    .groupBy(['s.id', 's.title', 'e.type'])
    .execute();
  const bySource = new Map<string, RegisterOption>();
  for (const r of rows) {
    if (r.from === null || r.to === null) continue;
    const known = bySource.get(r.id);
    if (known) bySource.set(r.id, { ...known, kinds: [...known.kinds, r.type], from: Math.min(known.from, r.from), to: Math.max(known.to, r.to) });
    else bySource.set(r.id, { sourceId: r.id, title: r.title, kinds: [r.type], from: r.from, to: r.to });
  }
  return [...bySource.values()];
}

/** The Parish a Place belonged to in a year: the period that contains it, else the first one. */
export function parishIn(parishes: readonly ParishPeriod[], year: number | null): ParishPeriod | null {
  if (year === null) return parishes[0] ?? null;
  const day = `${String(year).padStart(4, '0')}-07-01`;
  const inPeriod = (p: ParishPeriod) => (p.from === '-infinity' || p.from <= day) && (p.to === 'infinity' || p.to >= day);
  return parishes.find(inPeriod) ?? parishes[0] ?? null;
}

export async function leadsFor(db: Db, result: ReadingResult, placeId: string | null): Promise<LeadSuggestion[]> {
  const where = placeId ? await placeAndParishes(db, placeId) : { place: null, parishes: [] };
  const firstYear = result.entries.map((e) => (e.date ? Number.parseInt(e.date.replace(/^\.\.\//, ''), 10) : NaN)).find((y) => Number.isFinite(y)) ?? null;
  const parish = parishIn(where.parishes, firstYear);
  return leadSuggestions(result, {
    parish: parish?.name ?? null,
    // The archive lookup is the app's (app/src/archive-lookup.js); the app adds it where it shows the suggestion.
    archive: null,
    place: where.place,
    registers: parish ? await registersOf(db, [parish.id]) : [],
  });
}
