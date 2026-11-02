import { leadSuggestions, type ReadingLeadSuggestion, type ReadingResult, type RegisterOption } from '@rodokmen/shared';
import type { Db } from '../db/db.js';
import { serverArchiveLookup } from '../leads/archives.js';
import { placeAndParishes, type ParishPeriod } from './context.js';

/**
 * Suggested leads of a reading (scan-reading spec, "Reading suggests next steps"): the templates in
 * shared/src/reading-leads.ts, with the Parish of the reading's Place, the archive that holds its
 * registers (the archive lookup, server/src/leads/archives.ts) and the registers the Tree holds
 * for that Parish (Sources with a register Parish, kinds and years, research-leads spec), so a
 * suggestion names a real Source. The Member keeps one as a Research lead through the leads API
 * (POST /api/leads), or dismisses it.
 */
export async function registersOf(db: Db, parishIds: readonly string[]): Promise<RegisterOption[]> {
  if (parishIds.length === 0) return [];
  const rows = await db
    .selectFrom('source')
    .select(['id', 'title', 'register_kinds', 'register_from', 'register_to'])
    .where('register_parish_id', 'in', [...parishIds])
    .orderBy('title')
    .execute();
  return rows.map((r) => ({ sourceId: r.id, title: r.title, kinds: r.register_kinds, from: r.register_from ?? 1, to: r.register_to ?? 9999 }));
}

/** The Parish a Place belonged to in a year: the period that contains it, else the first one. */
export function parishIn(parishes: readonly ParishPeriod[], year: number | null): ParishPeriod | null {
  if (year === null) return parishes[0] ?? null;
  const day = `${String(year).padStart(4, '0')}-07-01`;
  const inPeriod = (p: ParishPeriod) => (p.from === '-infinity' || p.from <= day) && (p.to === 'infinity' || p.to >= day);
  return parishes.find(inPeriod) ?? parishes[0] ?? null;
}

export async function leadsFor(db: Db, result: ReadingResult, placeId: string | null): Promise<ReadingLeadSuggestion[]> {
  const where = placeId ? await placeAndParishes(db, placeId) : { place: null, parishes: [] };
  const firstYear = result.entries.map((e) => (e.date ? Number.parseInt(e.date.replace(/^\.\.\//, ''), 10) : NaN)).find((y) => Number.isFinite(y)) ?? null;
  const parish = parishIn(where.parishes, firstYear);
  const municipality = placeId ? await db.selectFrom('place').select('municipality_code').where('id', '=', placeId).executeTakeFirst() : undefined;
  return leadSuggestions(result, {
    parish: parish?.name ?? null,
    archive: serverArchiveLookup().archiveOf(municipality?.municipality_code ?? null),
    place: where.place,
    registers: parish ? await registersOf(db, [parish.id]) : [],
  });
}
