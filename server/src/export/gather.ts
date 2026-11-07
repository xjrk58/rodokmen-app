import {
  exportRecord,
  isLiving,
  livingFactsFromEvents,
  type ExportCitation,
  type ExportEvent,
  type ExportFact,
  type ExportLink,
  type ExportName,
  type ExportRecord,
  type ExportRelation,
  type LeadView,
} from '@rodokmen/shared';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import { leadsForExport } from '../leads/export.js';
import { lat, lon } from '../tree/summaries.js';

/**
 * The records of the Tree as they may leave the server (exports spec): every Person, Family,
 * Place, House, Parish, Estate and Source as an ExportRecord, through exportRecord
 * (shared/src/export.ts, proved), which reduces Living people, leaves out the Events they took
 * part in, and every image and document. The Research leads, through leadsForExport, without
 * their links to Living people. Who is Living is the Living rule as of the clock.
 *
 * Gathering is the trust boundary: which rows are read, which links point at images, and the
 * image embeds taken out of notes. server/test/exports.test.ts covers it.
 */

export interface ExportTree {
  /** Every record, through exportRecord, in a stable order (kind, then id). */
  records: ExportRecord[];
  /** Display names of records, for link texts: a Person's reduced name, a Place's primary name … */
  titles: Map<string, string>;
  leads: LeadView[];
}

/** Record kinds in the order of the Export's folders. */
export const KINDS = ['person', 'family', 'place', 'house', 'parish', 'estate', 'source'] as const;
export type RecordKind = (typeof KINDS)[number];

/** Links to the server's own images and documents, and to files that are images or documents by their name. */
const MEDIA_URL = /(\/api\/(images|documents|uploads)\/)|(\.(jpe?g|png|webp|heic|heif|gif|tiff?|pdf|docx?)(\?[^)\s]*)?$)/i;
/** An image or a link written into Markdown notes: ![alt](target) and [text](target). */
const MD_IMAGE = /!\[([^\]]*)\]\(([^)]*)\)/g;
const MD_LINK = /\[([^\]]*)\]\(([^)]*)\)/g;
const BARE_URL = /\bhttps?:\/\/[^\s)>\]]+/g;

/** Whether a link points at an image or a document (the proved rule then leaves it out). */
export function linkKind(url: string): 'image' | 'web' {
  return MEDIA_URL.test(url.trim()) ? 'image' : 'web';
}

/**
 * Notes without images and documents: an image embed leaves its alt text, a link to an image or a
 * document leaves its text, and a bare address of one goes. Other links stay.
 */
export function withoutMediaInText(text: string): string {
  return text
    .replace(MD_IMAGE, (_m, alt: string) => alt)
    .replace(MD_LINK, (m, label: string, target: string) => (linkKind(target) === 'image' ? label : m))
    .replace(BARE_URL, (url) => (linkKind(url) === 'image' ? '' : url));
}

/** The year of a date written as a single day, month or year (also about or uncertain); none for ranges. */
export function yearOf(date: string | null): number | null {
  const m = date === null ? null : /^(\d{4})(-\d{2}(-\d{2})?)?[~?]?$/.exec(date);
  return m ? Number(m[1]) : null;
}

const periodText = (from: string | null, to: string | null) => (from === null && to === null ? '' : `${from ?? '..'}/${to ?? '..'}`);

function group<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export async function gatherExport(db: Db, clock: Clock): Promise<ExportTree> {
  const today = clock.now();

  // ---------------------------------------------------------------- evidence
  const citationRows = await db.selectFrom('citation').select(['id', 'source_id', 'page', 'transcription', 'confidence', 'note']).execute();
  const pageImages = group(
    await db.selectFrom('image').select(['id', 'citation_id']).where('citation_id', 'is not', null).orderBy('id').execute(),
    (i) => i.citation_id!,
  );
  const citations = new Map(
    citationRows.map((c): [string, ExportCitation] => [
      c.id,
      {
        id: c.id,
        sourceId: c.source_id,
        page: c.page ?? '',
        transcription: c.transcription,
        confidence: c.confidence,
        note: c.note ?? '',
        links: (pageImages.get(c.id) ?? []).map((i) => ({ kind: 'image', target: `/api/images/${i.id}`, label: 'page image' })),
      },
    ]),
  );
  const citationsOf = (ids: readonly string[]) =>
    [...ids]
      .sort()
      .map((id) => citations.get(id))
      .filter((c): c is ExportCitation => c !== undefined);

  // ---------------------------------------------------------------- people and Events
  const persons = await db.selectFrom('person').select(['id', 'sex', 'notes', 'relation']).where('merged_into_id', 'is', null).orderBy('id').execute();
  const roots = new Set((await db.selectFrom('family_root').select('person_id').execute()).map((r) => r.person_id));
  const names = group(
    await db
      .selectFrom('name')
      .select(['id', 'person_id', 'given', 'surname', 'type', 'language', 'as_found', 'is_primary', 'sort_order'])
      .orderBy('person_id')
      .orderBy('is_primary', 'desc')
      .orderBy('sort_order')
      .orderBy('id')
      .execute(),
    (n) => n.person_id,
  );
  const nameCitations = group(await db.selectFrom('name_citation').select(['name_id', 'citation_id']).execute(), (n) => n.name_id);
  const labels = group(await db.selectFrom('person_label').select(['person_id', 'label']).orderBy('label').execute(), (l) => l.person_id);
  const roles = await db
    .selectFrom('event_role as r')
    .innerJoin('event as e', 'e.id', 'r.event_id')
    .select(['r.event_id', 'r.person_id', 'r.role', 'r.sort_order', 'e.type', 'e.date'])
    .orderBy('r.event_id')
    .orderBy('r.sort_order')
    .orderBy('r.id')
    .execute();
  const rolesOfPerson = group(roles, (r) => r.person_id);
  const rolesOfEvent = group(roles, (r) => r.event_id);
  const living = new Map(persons.map((p) => [p.id, isLiving(livingFactsFromEvents(rolesOfPerson.get(p.id) ?? []), today)]));
  const eventRows = await db
    .selectFrom('event')
    .select(['id', 'type', 'type_detail', 'date', 'date_earliest', 'place_id', 'house_id', 'description', 'notes'])
    .orderBy('date_earliest')
    .orderBy('id')
    .execute();
  const eventCitations = group(await db.selectFrom('event_citation').select(['event_id', 'citation_id']).execute(), (e) => e.event_id);
  const events = new Map(
    eventRows.map((e): [string, ExportEvent] => [
      e.id,
      {
        id: e.id,
        type: e.type,
        typeDetail: e.type_detail ?? '',
        date: e.date ?? '',
        placeId: e.place_id ?? '',
        houseId: e.house_id ?? '',
        description: withoutMediaInText(e.description ?? ''),
        notes: withoutMediaInText(e.notes ?? ''),
        roles: (rolesOfEvent.get(e.id) ?? []).map((r) => ({ personId: r.person_id, role: r.role, living: living.get(r.person_id) ?? true })),
        citations: citationsOf((eventCitations.get(e.id) ?? []).map((c) => c.citation_id)),
      },
    ]),
  );
  const eventOrder = new Map(eventRows.map((e, i) => [e.id, i]));
  const eventsOf = (ids: Iterable<string>) =>
    [...new Set(ids)]
      .sort((a, b) => (eventOrder.get(a) ?? 0) - (eventOrder.get(b) ?? 0))
      .map((id) => events.get(id))
      .filter((e): e is ExportEvent => e !== undefined);

  const families = await db.selectFrom('family').select(['id', 'partner1_id', 'partner2_id', 'notes']).orderBy('id').execute();
  const children = group(
    await db.selectFrom('family_child').select(['family_id', 'child_id', 'link_type']).orderBy('family_id').orderBy('sort_order').orderBy('id').execute(),
    (c) => c.family_id,
  );
  const childOf = group(
    [...children.values()].flat().map((c) => c),
    (c) => c.child_id,
  );
  const partnerIn = new Map<string, string[]>();
  for (const f of families) for (const p of [f.partner1_id, f.partner2_id]) if (p !== null) partnerIn.set(p, [...(partnerIn.get(p) ?? []), f.id]);
  const portraits = group(
    await db.selectFrom('image_person as ip').innerJoin('image as i', 'i.id', 'ip.image_id').select(['ip.person_id', 'i.id']).orderBy('i.id').execute(),
    (r) => r.person_id,
  );

  const records: ExportRecord[] = [];
  const titles = new Map<string, string>();

  for (const p of persons) {
    const own = names.get(p.id) ?? [];
    const personNames: ExportName[] = own.map((n) => ({
      given: n.given,
      surname: n.surname,
      type: n.type,
      language: n.language ?? '',
      asFound: n.as_found,
      citations: citationsOf((nameCitations.get(n.id) ?? []).map((c) => c.citation_id)),
    }));
    const theirRoles = rolesOfPerson.get(p.id) ?? [];
    const birth =
      theirRoles.find((r) => r.type === 'birth' && r.role === 'child' && yearOf(r.date) !== null) ??
      theirRoles.find((r) => r.type === 'baptism' && r.role === 'child' && yearOf(r.date) !== null);
    const birthYear = birth ? yearOf(birth.date) : null;
    const relations: ExportRelation[] = [
      ...(childOf.get(p.id) ?? []).map((c) => ({ rel: 'childOf', target: c.family_id, detail: c.link_type })),
      ...(partnerIn.get(p.id) ?? []).map((f) => ({ rel: 'partnerIn', target: f, detail: '' })),
    ];
    const facts: ExportFact[] = [
      { key: 'relation', value: p.relation, detail: '' },
      ...(roots.has(p.id) ? [{ key: 'familyRoot', value: 'true', detail: '' }] : []),
      ...(labels.get(p.id) ?? []).map((l) => ({ key: 'label', value: l.label, detail: '' })),
    ];
    const links: ExportLink[] = (portraits.get(p.id) ?? []).map((i) => ({ kind: 'image', target: `/api/images/${i.id}`, label: 'image' }));
    const view = exportRecord({
      kind: 'person',
      id: p.id,
      living: living.get(p.id) ?? true,
      concernsLiving: false,
      sex: p.sex,
      names: personNames,
      relations,
      birthYear: birthYear ?? 0,
      hasBirthYear: birthYear !== null,
      events: eventsOf(theirRoles.map((r) => r.event_id)),
      facts,
      notes: withoutMediaInText(p.notes ?? ''),
      links,
    });
    records.push(view);
    const first = view.names[0];
    titles.set(p.id, first ? `${first.given} ${first.surname}`.trim() : '?');
  }

  for (const f of families) {
    const kids = children.get(f.id) ?? [];
    const partners = [f.partner1_id, f.partner2_id].filter((x): x is string => x !== null);
    const members = [...partners, ...kids.map((k) => k.child_id)];
    // The Family's own Events: marriages of its partners.
    const marriages = eventsOf(
      partners
        .flatMap((p) => rolesOfPerson.get(p) ?? [])
        .filter((r) => r.type === 'marriage' && r.role === 'partner')
        .map((r) => r.event_id)
        .filter((id) => partners.every((p) => (rolesOfEvent.get(id) ?? []).some((r) => r.person_id === p))),
    );
    records.push(
      exportRecord({
        kind: 'family',
        id: f.id,
        living: false,
        concernsLiving: members.some((m) => living.get(m) ?? false),
        sex: '',
        names: [],
        relations: [
          ...partners.map((p) => ({ rel: 'partner', target: p, detail: '' })),
          ...kids.map((k) => ({ rel: 'child', target: k.child_id, detail: k.link_type })),
        ],
        birthYear: 0,
        hasBirthYear: false,
        events: marriages,
        facts: [],
        notes: withoutMediaInText(f.notes ?? ''),
        links: [],
      }),
    );
    titles.set(f.id, partners.map((p) => titles.get(p) ?? '?').join(' & ') || 'Family');
  }

  // ---------------------------------------------------------------- places
  const places = await db
    .selectFrom('place')
    .select(['id', 'type', 'municipality_code', 'municipality_name', 'notes', lat('location').as('lat'), lon('location').as('lon')])
    .orderBy('id')
    .execute();
  const placeNames = group(
    await db
      .selectFrom('place_name')
      .select(['place_id', 'name', 'language', 'is_primary', 'period_from', 'period_to'])
      .orderBy('place_id')
      .orderBy('is_primary', 'desc')
      .orderBy('valid_from')
      .orderBy('id')
      .execute(),
    (n) => n.place_id,
  );
  const placeParishes = await db
    .selectFrom('place_parish')
    .select(['place_id', 'parish_id', 'period_from', 'period_to'])
    .orderBy('valid_from')
    .orderBy('id')
    .execute();
  const placeEstates = await db
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
  const houseNumbers = group(
    await db.selectFrom('house_number').select(['house_id', 'number', 'period_from', 'period_to']).orderBy('valid_from').orderBy('id').execute(),
    (n) => n.house_id,
  );
  const location = (r: { lat: number | null; lon: number | null }): ExportFact[] =>
    r.lat === null || r.lon === null ? [] : [{ key: 'location', value: `${r.lat}, ${r.lon}`, detail: '' }];

  for (const p of places) {
    const pn = placeNames.get(p.id) ?? [];
    titles.set(p.id, pn[0]?.name ?? 'Place');
    records.push(
      exportRecord({
        kind: 'place',
        id: p.id,
        living: false,
        concernsLiving: false,
        sex: '',
        names: [],
        relations: [
          ...placeParishes
            .filter((x) => x.place_id === p.id)
            .map((x) => ({ rel: 'parish', target: x.parish_id, detail: periodText(x.period_from, x.period_to) })),
          ...placeEstates
            .filter((x) => x.place_id === p.id)
            .map((x) => ({ rel: 'estate', target: x.estate_id, detail: periodText(x.period_from, x.period_to) })),
          ...houses.filter((h) => h.place_id === p.id).map((h) => ({ rel: 'house', target: h.id, detail: '' })),
        ],
        birthYear: 0,
        hasBirthYear: false,
        events: [],
        facts: [
          { key: 'type', value: p.type, detail: '' },
          ...pn.map((n) => ({ key: 'name', value: n.name, detail: [n.language, periodText(n.period_from, n.period_to)].filter(Boolean).join(', ') })),
          ...location(p),
          ...(p.municipality_code ? [{ key: 'municipality', value: p.municipality_name ?? '', detail: p.municipality_code }] : []),
        ],
        notes: withoutMediaInText(p.notes ?? ''),
        links: [],
      }),
    );
  }
  for (const h of houses) {
    const numbers = houseNumbers.get(h.id) ?? [];
    titles.set(h.id, `${titles.get(h.place_id) ?? '?'} ${numbers.length ? numbers[numbers.length - 1]!.number : ''}`.trim());
    records.push(
      exportRecord({
        kind: 'house',
        id: h.id,
        living: false,
        concernsLiving: false,
        sex: '',
        names: [],
        relations: [{ rel: 'place', target: h.place_id, detail: '' }],
        birthYear: 0,
        hasBirthYear: false,
        events: [],
        facts: [
          ...numbers.map((n) => ({ key: 'number', value: n.number, detail: periodText(n.period_from, n.period_to) })),
          ...location(h),
          ...(h.note ? [{ key: 'note', value: withoutMediaInText(h.note), detail: '' }] : []),
        ],
        notes: withoutMediaInText(h.notes ?? ''),
        links: [],
      }),
    );
  }
  for (const p of await db.selectFrom('parish').select(['id', 'name', 'seat_place_id', 'notes']).orderBy('id').execute()) {
    titles.set(p.id, p.name);
    records.push(
      exportRecord({
        kind: 'parish',
        id: p.id,
        living: false,
        concernsLiving: false,
        sex: '',
        names: [],
        relations: [
          ...(p.seat_place_id ? [{ rel: 'seat', target: p.seat_place_id, detail: '' }] : []),
          ...placeParishes
            .filter((x) => x.parish_id === p.id)
            .map((x) => ({ rel: 'place', target: x.place_id, detail: periodText(x.period_from, x.period_to) })),
        ],
        birthYear: 0,
        hasBirthYear: false,
        events: [],
        facts: [{ key: 'name', value: p.name, detail: '' }],
        notes: withoutMediaInText(p.notes ?? ''),
        links: [],
      }),
    );
  }
  for (const e of await db.selectFrom('estate').select(['id', 'name', 'notes']).orderBy('id').execute()) {
    titles.set(e.id, e.name);
    records.push(
      exportRecord({
        kind: 'estate',
        id: e.id,
        living: false,
        concernsLiving: false,
        sex: '',
        names: [],
        relations: placeEstates
          .filter((x) => x.estate_id === e.id)
          .map((x) => ({ rel: 'place', target: x.place_id, detail: periodText(x.period_from, x.period_to) })),
        birthYear: 0,
        hasBirthYear: false,
        events: [],
        facts: [{ key: 'name', value: e.name, detail: '' }],
        notes: withoutMediaInText(e.notes ?? ''),
        links: [],
      }),
    );
  }

  // ---------------------------------------------------------------- sources
  const documents = group(await db.selectFrom('source_document').select(['id', 'source_id', 'title']).orderBy('id').execute(), (d) => d.source_id);
  for (const s of await db.selectFrom('source').selectAll().orderBy('id').execute()) {
    titles.set(s.id, s.title);
    // A Family account given by a Living person does not say who gave it (exports spec, "Living people are reduced in every Export").
    const giverLiving = s.account_given_by_person_id !== null && (living.get(s.account_given_by_person_id) ?? true);
    const facts: ExportFact[] = [
      { key: 'type', value: s.type, detail: '' },
      { key: 'title', value: s.title, detail: '' },
      ...(s.repository ? [{ key: 'repository', value: s.repository, detail: '' }] : []),
      ...(s.reference ? [{ key: 'reference', value: s.reference, detail: '' }] : []),
      ...(s.account_given_by ? [{ key: 'givenBy', value: giverLiving ? 'a Living relative' : s.account_given_by, detail: '' }] : []),
      ...(s.account_given_on ? [{ key: 'givenOn', value: s.account_given_on, detail: '' }] : []),
      ...(s.register_kinds.length ? [{ key: 'registerKinds', value: s.register_kinds.join(', '), detail: '' }] : []),
      ...(s.register_from !== null ? [{ key: 'registerYears', value: `${s.register_from}–${s.register_to ?? ''}`, detail: '' }] : []),
    ];
    records.push(
      exportRecord({
        kind: 'source',
        id: s.id,
        living: false,
        concernsLiving: false,
        sex: '',
        names: [],
        relations: [
          ...(s.register_parish_id ? [{ rel: 'parish', target: s.register_parish_id, detail: '' }] : []),
          ...(s.account_given_by_person_id && !giverLiving ? [{ rel: 'givenBy', target: s.account_given_by_person_id, detail: '' }] : []),
        ],
        birthYear: 0,
        hasBirthYear: false,
        events: [],
        facts,
        notes: withoutMediaInText(s.notes ?? ''),
        links: [
          ...(s.url ? [{ kind: linkKind(s.url), target: s.url, label: 'catalogue' }] : []),
          ...(documents.get(s.id) ?? []).map((d) => ({ kind: 'document', target: `/api/documents/${d.id}`, label: d.title })),
        ],
      }),
    );
  }

  records.sort((a, b) => KINDS.indexOf(a.kind as RecordKind) - KINDS.indexOf(b.kind as RecordKind) || byId(a, b));
  return { records, titles, leads: await leadsForExport(db, clock) };
}
