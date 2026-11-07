import { exportRecord, type ExportFact, type ExportLink } from '@rodokmen/shared';
import type { Db } from '../db/db.js';
import { lat, lon } from '../tree/summaries.js';
import { blank, group, linkKind, withoutMediaInText, type Gathered } from './records.js';

/**
 * The Places, Houses, Parishes, Estates and Sources of the Export (exports spec), each through
 * exportRecord like every record (shared/src/export.ts). Their periods are written as EDTF
 * intervals (`1850/..`). A Family account given by a Living person does not say who gave it.
 */

const periodText = (from: string | null, to: string | null) => (from === null && to === null ? '' : `${from ?? '..'}/${to ?? '..'}`);

const location = (r: { lat: number | null; lon: number | null }): ExportFact[] =>
  r.lat === null || r.lon === null ? [] : [{ key: 'location', value: `${r.lat}, ${r.lon}`, detail: '' }];

/** Places with their names and Parishes and Estates over time, Houses with their numbers, Parishes and Estates. */
export async function addPlaces(db: Db, out: Gathered): Promise<void> {
  const places = await db
    .selectFrom('place')
    .select(['id', 'type', 'municipality_code', 'municipality_name', 'notes', lat('location').as('lat'), lon('location').as('lon')])
    .orderBy('id')
    .execute();
  const placeNames = group(
    await db
      .selectFrom('place_name')
      .select(['place_id', 'name', 'language', 'period_from', 'period_to'])
      .orderBy('place_id')
      .orderBy('is_primary', 'desc')
      .orderBy('valid_from')
      .orderBy('id')
      .execute(),
    (n) => n.place_id,
  );
  const parishes = await db
    .selectFrom('place_parish')
    .select(['place_id', 'parish_id', 'period_from', 'period_to'])
    .orderBy('valid_from')
    .orderBy('id')
    .execute();
  const estates = await db
    .selectFrom('place_estate')
    .select(['place_id', 'estate_id', 'period_from', 'period_to'])
    .orderBy('valid_from')
    .orderBy('id')
    .execute();
  const houses = await db
    .selectFrom('house')
    .select(['id', 'place_id', 'note', 'notes', lat('location').as('lat'), lon('location').as('lon')])
    .orderBy('id')
    .execute();
  const numbers = group(
    await db.selectFrom('house_number').select(['house_id', 'number', 'period_from', 'period_to']).orderBy('valid_from').orderBy('id').execute(),
    (n) => n.house_id,
  );

  for (const p of places) {
    const names = placeNames.get(p.id) ?? [];
    out.titles.set(p.id, names[0]?.name ?? 'Place');
    out.records.push(
      exportRecord({
        ...blank('place', p.id),
        relations: [
          ...parishes.filter((x) => x.place_id === p.id).map((x) => ({ rel: 'parish', target: x.parish_id, detail: periodText(x.period_from, x.period_to) })),
          ...estates.filter((x) => x.place_id === p.id).map((x) => ({ rel: 'estate', target: x.estate_id, detail: periodText(x.period_from, x.period_to) })),
          ...houses.filter((h) => h.place_id === p.id).map((h) => ({ rel: 'house', target: h.id, detail: '' })),
        ],
        facts: [
          { key: 'placeType', value: p.type, detail: '' },
          ...names.map((n) => ({ key: 'name', value: n.name, detail: [n.language, periodText(n.period_from, n.period_to)].filter(Boolean).join(', ') })),
          ...location(p),
          ...(p.municipality_code ? [{ key: 'municipality', value: p.municipality_name ?? '', detail: p.municipality_code }] : []),
        ],
        notes: withoutMediaInText(p.notes),
      }),
    );
  }
  for (const h of houses) {
    const own = numbers.get(h.id) ?? [];
    out.titles.set(h.id, `${out.titles.get(h.place_id) ?? '?'} ${own[own.length - 1]?.number ?? ''}`.trim());
    out.records.push(
      exportRecord({
        ...blank('house', h.id),
        relations: [{ rel: 'place', target: h.place_id, detail: '' }],
        facts: [
          ...own.map((n) => ({ key: 'number', value: n.number, detail: periodText(n.period_from, n.period_to) })),
          ...location(h),
          ...(h.note ? [{ key: 'note', value: withoutMediaInText(h.note), detail: '' }] : []),
        ],
        notes: withoutMediaInText(h.notes),
      }),
    );
  }
  for (const p of await db.selectFrom('parish').select(['id', 'name', 'seat_place_id', 'notes']).orderBy('id').execute()) {
    out.titles.set(p.id, p.name);
    out.records.push(
      exportRecord({
        ...blank('parish', p.id),
        relations: [
          ...(p.seat_place_id ? [{ rel: 'seat', target: p.seat_place_id, detail: '' }] : []),
          ...parishes.filter((x) => x.parish_id === p.id).map((x) => ({ rel: 'place', target: x.place_id, detail: periodText(x.period_from, x.period_to) })),
        ],
        facts: [{ key: 'name', value: p.name, detail: '' }],
        notes: withoutMediaInText(p.notes),
      }),
    );
  }
  for (const e of await db.selectFrom('estate').select(['id', 'name', 'notes']).orderBy('id').execute()) {
    out.titles.set(e.id, e.name);
    out.records.push(
      exportRecord({
        ...blank('estate', e.id),
        relations: estates
          .filter((x) => x.estate_id === e.id)
          .map((x) => ({ rel: 'place', target: x.place_id, detail: periodText(x.period_from, x.period_to) })),
        facts: [{ key: 'name', value: e.name, detail: '' }],
        notes: withoutMediaInText(e.notes),
      }),
    );
  }
}

/** Sources with their archive, register coverage and Family account; their documents and catalogue link as links. */
export async function addSources(db: Db, living: ReadonlyMap<string, boolean>, out: Gathered): Promise<void> {
  const documents = group(await db.selectFrom('source_document').select(['id', 'source_id', 'title']).orderBy('id').execute(), (d) => d.source_id);
  for (const s of await db.selectFrom('source').selectAll().orderBy('id').execute()) {
    out.titles.set(s.id, s.title);
    // A Family account given by a Living person does not say who gave it (exports spec, "Living people are reduced in every Export").
    const giver = s.account_given_by_person_id;
    const giverLiving = giver !== null && (living.get(giver) ?? true);
    const fact = (key: string, value: string | null | undefined): ExportFact[] => (value ? [{ key, value, detail: '' }] : []);
    const links: ExportLink[] = [
      ...(s.url ? [{ kind: linkKind(s.url), target: s.url, label: 'catalogue' }] : []),
      ...(documents.get(s.id) ?? []).map((d) => ({ kind: 'document', target: `/api/documents/${d.id}`, label: d.title })),
    ];
    out.records.push(
      exportRecord({
        ...blank('source', s.id),
        relations: [
          ...(s.register_parish_id ? [{ rel: 'parish', target: s.register_parish_id, detail: '' }] : []),
          ...(giver !== null && !giverLiving ? [{ rel: 'givenBy', target: giver, detail: '' }] : []),
        ],
        facts: [
          ...fact('sourceType', s.type),
          ...fact('title', s.title),
          ...fact('repository', s.repository),
          ...fact('reference', s.reference),
          ...fact('givenBy', s.account_given_by && giverLiving ? 'a Living relative' : s.account_given_by),
          ...fact('givenOn', s.account_given_on),
          ...fact('registerKinds', s.register_kinds.join(', ')),
          ...fact('registerYears', s.register_from === null ? null : `${s.register_from}–${s.register_to ?? ''}`),
        ],
        notes: withoutMediaInText(s.notes),
        links,
      }),
    );
  }
}
