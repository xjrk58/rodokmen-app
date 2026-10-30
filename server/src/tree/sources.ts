import { foldForSearch, type CitationDetail, type CitationSummary, type SourceDetail, type SourceSummary } from '@rodokmen/shared';
import { sql } from 'kysely';
import type { Db } from '../db/db.js';
import type { SourceTable } from '../db/types.js';
import { IMAGE_COLUMNS, imageViews, type TreeDeps } from './persons.js';
import { containsPattern, eventSummaries } from './summaries.js';

/** Citation summaries attached to Events or Names, keyed by the Event or Name id. */
export async function citationSummariesFor(db: Db, of: 'event' | 'name', ids: readonly string[]): Promise<Map<string, CitationSummary[]>> {
  const out = new Map<string, CitationSummary[]>();
  if (ids.length === 0) return out;
  const columns = ['c.id', 'c.version', 'c.source_id', 's.title', 'c.page', 'c.confidence'] as const;
  const rows =
    of === 'event'
      ? await db
          .selectFrom('event_citation as l')
          .innerJoin('citation as c', 'c.id', 'l.citation_id')
          .innerJoin('source as s', 's.id', 'c.source_id')
          .select(['l.event_id as owner', ...columns])
          .where('l.event_id', 'in', [...ids])
          .orderBy('c.id')
          .execute()
      : await db
          .selectFrom('name_citation as l')
          .innerJoin('citation as c', 'c.id', 'l.citation_id')
          .innerJoin('source as s', 's.id', 'c.source_id')
          .select(['l.name_id as owner', ...columns])
          .where('l.name_id', 'in', [...ids])
          .orderBy('c.id')
          .execute();
  for (const r of rows) {
    const list = out.get(r.owner) ?? [];
    list.push({ id: r.id, version: r.version, sourceId: r.source_id, sourceTitle: r.title, page: r.page, confidence: r.confidence });
    out.set(r.owner, list);
  }
  return out;
}

function sourceSummary(
  s: Pick<SourceTable, 'type' | 'title' | 'repository' | 'reference' | 'url' | 'account_given_by' | 'account_given_by_person_id' | 'account_given_on'> & {
    id: string;
    version: number;
  },
): SourceSummary {
  return {
    id: s.id,
    version: s.version,
    type: s.type,
    title: s.title,
    repository: s.repository,
    reference: s.reference,
    url: s.url,
    familyAccount:
      s.type === 'family_account' && s.account_given_by && s.account_given_on
        ? { givenBy: s.account_given_by, givenByPersonId: s.account_given_by_person_id, givenOn: s.account_given_on }
        : null,
  };
}

export async function searchSources(
  db: Db,
  q: { q?: string | undefined; type?: SourceSummary['type'] | undefined; limit: number; offset: number },
): Promise<SourceSummary[]> {
  let query = db.selectFrom('source').selectAll();
  if (q.q) query = query.where(sql<boolean>`rdk_fold(title) like rdk_fold(${containsPattern(foldForSearch(q.q))})`);
  if (q.type) query = query.where('type', '=', q.type);
  const rows = await query.orderBy('title').orderBy('id').limit(q.limit).offset(q.offset).execute();
  return rows.map(sourceSummary);
}

export async function getSource(db: Db, id: string): Promise<SourceDetail | null> {
  const s = await db.selectFrom('source').selectAll().where('id', '=', id).executeTakeFirst();
  if (!s) return null;
  const citations = await db
    .selectFrom('citation')
    .select(['id', 'version', 'source_id', 'page', 'confidence'])
    .where('source_id', '=', id)
    .orderBy('page')
    .orderBy('id')
    .execute();
  return {
    ...sourceSummary(s),
    citations: citations.map((c) => ({ id: c.id, version: c.version, sourceId: c.source_id, sourceTitle: s.title, page: c.page, confidence: c.confidence })),
  };
}

export async function getCitation(deps: TreeDeps, id: string): Promise<CitationDetail | null> {
  const { db } = deps;
  const c = await db.selectFrom('citation').selectAll().where('id', '=', id).executeTakeFirst();
  if (!c) return null;
  const source = await db.selectFrom('source').selectAll().where('id', '=', c.source_id).executeTakeFirstOrThrow();
  const eventIds = (await db.selectFrom('event_citation').select('event_id').where('citation_id', '=', id).orderBy('event_id').execute()).map(
    (r) => r.event_id,
  );
  const names = await db
    .selectFrom('name_citation as l')
    .innerJoin('name as n', 'n.id', 'l.name_id')
    .select(['n.id', 'n.person_id', 'n.as_found'])
    .where('l.citation_id', '=', id)
    .orderBy('n.id')
    .execute();
  const images = await db
    .selectFrom('image as i')
    .select([...IMAGE_COLUMNS])
    .where('i.citation_id', '=', id)
    .orderBy('i.id')
    .execute();
  return {
    id: c.id,
    version: c.version,
    sourceId: c.source_id,
    page: c.page,
    transcription: c.transcription,
    readOn: c.read_on,
    confidence: c.confidence,
    note: c.note,
    source: sourceSummary(source),
    events: await eventSummaries(db, eventIds),
    names: names.map((n) => ({ id: n.id, personId: n.person_id, asFound: n.as_found })),
    images: await imageViews(deps, images),
  };
}
