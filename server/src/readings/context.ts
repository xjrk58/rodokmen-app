import type { ReadingContext } from '@rodokmen/shared';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import { personSummaries } from '../tree/summaries.js';

/**
 * What the reader is told besides the images (ADR 0011): the Member's context, and the names the
 * Tree knows for that Place and its Parishes, to help it recognise spellings. Only names of
 * Persons who are not Living go out, and nothing else about anyone: no dates, Houses or
 * relations from the Tree.
 */

/** Most Persons whose names go with one reading. */
export const KNOWN_NAME_PERSONS = 300;

/** The Place's primary name and the names of the Parishes it belonged to. */
export interface ParishPeriod {
  id: string;
  name: string;
  /** The period the Place belonged to it, as days ('-infinity' and 'infinity' when open). */
  from: string;
  to: string;
}

export async function placeAndParishes(db: Db, placeId: string): Promise<{ place: string | null; parishes: ParishPeriod[] }> {
  const place = await db
    .selectFrom('place_name')
    .select('name')
    .where('place_id', '=', placeId)
    .orderBy('is_primary', 'desc')
    .orderBy('name')
    .executeTakeFirst();
  const parishes = await db
    .selectFrom('place_parish as pp')
    .innerJoin('parish as p', 'p.id', 'pp.parish_id')
    .select(['p.id', 'p.name', 'pp.valid_from as from', 'pp.valid_to as to'])
    .where('pp.place_id', '=', placeId)
    .orderBy('pp.valid_from')
    .execute();
  return { place: place?.name ?? null, parishes };
}

/** Given names and surnames of Persons who are not Living and have Events in the Places of these Parishes (or this Place). */
async function knownNames(db: Db, clock: Clock, placeId: string, parishIds: readonly string[]): Promise<{ given: string[]; surnames: string[] }> {
  const places = parishIds.length
    ? (
        await db
          .selectFrom('place_parish')
          .select('place_id')
          .where('parish_id', 'in', [...parishIds])
          .execute()
      ).map((r) => r.place_id)
    : [];
  const placeIds = [...new Set([placeId, ...places])];
  const persons = await db
    .selectFrom('event_role as r')
    .innerJoin('event as e', 'e.id', 'r.event_id')
    .leftJoin('house as h', 'h.id', 'e.house_id')
    .innerJoin('person as p', 'p.id', 'r.person_id')
    .select('r.person_id')
    .distinct()
    .where('p.merged_into_id', 'is', null)
    .where((eb) => eb.or([eb('e.place_id', 'in', placeIds), eb('h.place_id', 'in', placeIds)]))
    .orderBy('r.person_id')
    .limit(KNOWN_NAME_PERSONS)
    .execute();
  const summaries = await personSummaries(
    db,
    persons.map((p) => p.person_id),
    clock,
  );
  const ids = [...summaries.values()].filter((s) => !s.living).map((s) => s.id);
  if (ids.length === 0) return { given: [], surnames: [] };
  const names = await db.selectFrom('name').select(['given', 'surname']).where('person_id', 'in', ids).execute();
  const sorted = (values: string[]) => [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs'));
  return { given: sorted(names.flatMap((n) => n.given.split(/\s+/))), surnames: sorted(names.map((n) => n.surname)) };
}

/** The text that goes with the images. */
export async function readingContextText(db: Db, clock: Clock, context: ReadingContext): Promise<string> {
  const lines = ['What the Member knows about these scans (it may be incomplete, and it is not on the page):'];
  let source = context.sourceTitle;
  if (context.sourceId) {
    const s = await db.selectFrom('source').select(['title', 'repository', 'reference']).where('id', '=', context.sourceId).executeTakeFirst();
    if (s) source = [s.title, s.repository, s.reference].filter(Boolean).join(', ');
  }
  if (source) lines.push(`- Register: ${source}`);
  if (context.page) lines.push(`- Page or frame: ${context.page}`);
  let names: { given: string[]; surnames: string[] } = { given: [], surnames: [] };
  if (context.placeId) {
    const { place, parishes } = await placeAndParishes(db, context.placeId);
    const parishNames = [...new Set(parishes.map((p) => p.name))];
    if (place) lines.push(`- Place: ${place}${parishNames.length ? ` (Parish: ${parishNames.join(', later ')})` : ''}`);
    names = await knownNames(db, clock, context.placeId, [...new Set(parishes.map((p) => p.id))]);
  }
  if (context.years) lines.push(`- Years: ${context.years.from}–${context.years.to}`);
  if (context.note) lines.push(`- Note: ${context.note}`);
  if (lines.length === 1) lines.push('- Nothing.');
  if (names.surnames.length || names.given.length) {
    lines.push(
      '',
      'Names the family tree already has from this Place and Parish, to help you recognise spellings. Never write one that is not on the page:',
      `- Surnames: ${names.surnames.join(', ')}`,
      `- Given names: ${names.given.join(', ')}`,
    );
  }
  return lines.join('\n');
}
