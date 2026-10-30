import { foldForSearch, isoDay, type ImageView, type PersonDetail, type PersonSearchQuery, type PersonSearchResult } from '@rodokmen/shared';
import { sql } from 'kysely';
import type { Selectable } from 'kysely';
import type { Db } from '../db/db.js';
import type { ImageTable } from '../db/types.js';
import type { ImageStorage } from '../storage/images.js';
import type { Clock } from '../clock.js';
import { containsPattern, compareEarliestDays, eventSummaries, personSummaries } from './summaries.js';
import { citationSummariesFor } from './sources.js';

export interface TreeDeps {
  db: Db;
  clock: Clock;
  images: ImageStorage;
}

/**
 * Persons by any of their Names, ignoring case and diacritics: every word of the query must
 * occur in one Name (given names, surname or the spelling as found). Backed by the trigram
 * index on name.search_text. Optionally narrowed by Place and by year range.
 */
export async function searchPersons({ db, clock }: TreeDeps, q: PersonSearchQuery): Promise<PersonSearchResult> {
  const tokens = q.q ? foldForSearch(q.q).split(' ').filter(Boolean) : [];
  // Merged Persons have moved all their Names to the kept Person and never show in search.
  let query = db
    .selectFrom('person as p')
    .innerJoin('name as pn', (j) => j.onRef('pn.person_id', '=', 'p.id').on('pn.is_primary', '=', true))
    .where('p.merged_into_id', 'is', null);

  if (q.placeId) {
    const placeId = q.placeId;
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('event_role as r')
          .innerJoin('event as e', 'e.id', 'r.event_id')
          .leftJoin('house as h', 'h.id', 'e.house_id')
          .select(sql`1`.as('x'))
          .whereRef('r.person_id', '=', 'p.id')
          .where((w) => w.or([w('e.place_id', '=', placeId), w('h.place_id', '=', placeId)])),
      ),
    );
  }
  if (q.from !== undefined || q.to !== undefined) {
    const from = q.from === undefined ? '-infinity' : isoDay(q.from, 1, 1);
    const to = q.to === undefined ? 'infinity' : isoDay(q.to, 12, 31);
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('event_role as r')
          .innerJoin('event as e', 'e.id', 'r.event_id')
          .select(sql`1`.as('x'))
          .whereRef('r.person_id', '=', 'p.id')
          .where('e.date_earliest', '<=', to)
          .where('e.date_latest', '>=', from),
      ),
    );
  }

  let rows: Array<{ id: string; matched: string | null }>;
  if (tokens.length > 0) {
    const patterns = tokens.map(containsPattern);
    const folded = tokens.join(' ');
    const matches = db
      .selectFrom('name as n')
      .select([
        'n.person_id',
        'n.as_found',
        'n.is_primary',
        sql<number>`similarity(n.search_text, rdk_fold(${folded}))`.as('score'),
      ])
      // rdk_fold, the fold behind search_text, also folds the query: both sides match by definition.
      // One LIKE per word, which the trigram index serves (it cannot serve LIKE ALL over an array).
      .where((eb) => eb.and(patterns.map((p) => sql<boolean>`n.search_text like rdk_fold(${p})`)));
    const best = db
      .selectFrom(matches.as('m'))
      .distinctOn('m.person_id')
      .select(['m.person_id', 'm.as_found', 'm.score'])
      .orderBy('m.person_id')
      .orderBy('m.score', 'desc')
      .orderBy('m.is_primary', 'desc');
    rows = (
      await query
        .innerJoin(best.as('b'), 'b.person_id', 'p.id')
        .select(['p.id', 'b.as_found as matched', 'b.score'])
        .orderBy('b.score', 'desc')
        .orderBy('pn.surname')
        .orderBy('pn.given')
        .orderBy('p.id')
        .limit(q.limit)
        .offset(q.offset)
        .execute()
    ).map((r) => ({ id: r.id, matched: r.matched }));
  } else {
    rows = (
      await query
        .select(['p.id'])
        .orderBy('pn.surname')
        .orderBy('pn.given')
        .orderBy('p.id')
        .limit(q.limit)
        .offset(q.offset)
        .execute()
    ).map((r) => ({ id: r.id, matched: null }));
  }
  const summaries = await personSummaries(db, rows.map((r) => r.id), clock);
  return { items: rows.map((r) => ({ person: summaries.get(r.id)!, matchedName: r.matched })), limit: q.limit, offset: q.offset };
}

/** An image row as IMAGE_COLUMNS selects it. */
type ImageRow = Pick<Selectable<ImageTable>, 'id' | 'version' | 'kind' | 'citation_id' | 'storage_key' | 'content_type' | 'byte_size' | 'width' | 'height' | 'sha256' | 'caption'>;

export async function imageViews(deps: TreeDeps, rows: ImageRow[]): Promise<ImageView[]> {
  if (rows.length === 0) return [];
  const subjects = await deps.db.selectFrom('image_person').select(['image_id', 'person_id']).where('image_id', 'in', rows.map((r) => r.id)).execute();
  return Promise.all(
    rows.map(async (r) => {
      const link = await deps.images.link(r.storage_key, r.content_type);
      return {
        id: r.id,
        version: r.version,
        kind: r.kind,
        citationId: r.citation_id,
        personIds: subjects.filter((s) => s.image_id === r.id).map((s) => s.person_id),
        contentType: r.content_type,
        byteSize: r.byte_size,
        width: r.width,
        height: r.height,
        sha256: r.sha256,
        caption: r.caption,
        url: link.url,
        urlExpiresAt: link.expiresAt.toISOString(),
      };
    }),
  );
}

export const IMAGE_COLUMNS = ['i.id', 'i.version', 'i.kind', 'i.citation_id', 'i.storage_key', 'i.content_type', 'i.byte_size', 'i.width', 'i.height', 'i.sha256', 'i.caption'] as const;

export async function getPerson(deps: TreeDeps, id: string): Promise<PersonDetail | null> {
  const { db, clock } = deps;
  const person = await db.selectFrom('person').select(['id', 'version', 'sex']).where('id', '=', id).executeTakeFirst();
  if (!person) return null;

  const names = await db.selectFrom('name').selectAll().where('person_id', '=', id).orderBy('is_primary', 'desc').orderBy('sort_order').orderBy('id').execute();
  const nameCitations = await citationSummariesFor(db, 'name', names.map((n) => n.id));

  const roles = await db
    .selectFrom('event_role as r')
    .innerJoin('event as e', 'e.id', 'r.event_id')
    .select(['r.id', 'r.role', 'r.role_detail', 'r.event_id', 'e.date_earliest'])
    .where('r.person_id', '=', id)
    .execute();
  roles.sort((a, b) => compareEarliestDays(a.date_earliest, b.date_earliest) || a.event_id.localeCompare(b.event_id));
  const events = new Map((await eventSummaries(db, roles.map((r) => r.event_id))).map((e) => [e.id, e]));

  const asPartner = await db
    .selectFrom('family')
    .select(['id', 'version', 'partner1_id', 'partner2_id'])
    .where((eb) => eb.or([eb('partner1_id', '=', id), eb('partner2_id', '=', id)]))
    .orderBy('id')
    .execute();
  const asChild = await db
    .selectFrom('family_child as fc')
    .innerJoin('family as f', 'f.id', 'fc.family_id')
    .select(['f.id', 'f.version', 'f.partner1_id', 'f.partner2_id', 'fc.id as link_id', 'fc.link_type'])
    .where('fc.child_id', '=', id)
    .orderBy('fc.link_type')
    .execute();
  const children = asPartner.length
    ? await db.selectFrom('family_child').select(['id', 'family_id', 'child_id', 'link_type', 'sort_order']).where('family_id', 'in', asPartner.map((f) => f.id)).orderBy('sort_order').execute()
    : [];

  const relatedIds = [
    ...asPartner.flatMap((f) => [f.partner1_id, f.partner2_id]),
    ...asChild.flatMap((f) => [f.partner1_id, f.partner2_id]),
    ...children.map((c) => c.child_id),
  ].filter((x): x is string => x !== null && x !== id);
  const summaries = await personSummaries(db, [id, ...relatedIds], clock);

  const portraits = await db
    .selectFrom('image as i')
    .innerJoin('image_person as ip', 'ip.image_id', 'i.id')
    .select([...IMAGE_COLUMNS])
    .where('ip.person_id', '=', id)
    .where('i.kind', '=', 'portrait')
    .orderBy('i.id')
    .execute();

  return {
    id: person.id,
    version: person.version,
    sex: person.sex,
    living: summaries.get(id)!.living,
    names: names.map((n) => ({
      id: n.id,
      version: n.version,
      personId: n.person_id,
      given: n.given,
      surname: n.surname,
      type: n.type,
      asFound: n.as_found,
      primary: n.is_primary,
      citations: nameCitations.get(n.id) ?? [],
    })),
    events: roles.map((r) => ({ roleId: r.id, role: r.role, roleDetail: r.role_detail, event: events.get(r.event_id)! })),
    familiesAsPartner: asPartner.map((f) => {
      const other = f.partner1_id === id ? f.partner2_id : f.partner1_id;
      return {
        id: f.id,
        version: f.version,
        partner: other ? (summaries.get(other) ?? null) : null,
        children: children.filter((c) => c.family_id === f.id).map((c) => ({ linkId: c.id, linkType: c.link_type, person: summaries.get(c.child_id)! })),
      };
    }),
    familiesAsChild: asChild.map((f) => ({
      id: f.id,
      version: f.version,
      linkId: f.link_id,
      linkType: f.link_type,
      partners: [f.partner1_id, f.partner2_id].filter((x): x is string => x !== null).map((p) => summaries.get(p)!),
    })),
    portraits: await imageViews(deps, portraits),
  };
}
