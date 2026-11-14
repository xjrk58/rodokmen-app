import {
  exportRecord,
  isLiving,
  livingFactsFromEvents,
  type ExportCitation,
  type ExportEvent,
  type ExportFact,
  type ExportName,
  type ExportRecord,
  type ExportRelation,
  type LeadView,
} from '@rodokmen/shared';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import { leadsForExport } from '../leads/export.js';
import { addPlaces, addSources } from './gather-places.js';
import { blank, group, KIND_ORDER, withoutMediaInText, yearOf, type Gathered } from './records.js';

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

const imageLink = (id: string, label: string) => ({ kind: 'image', target: `/api/images/${id}`, label });

/** Every Citation with its page images as image links, and a lookup of those of some ids. */
async function loadCitations(db: Db): Promise<(ids: readonly string[]) => ExportCitation[]> {
  const rows = await db.selectFrom('citation').select(['id', 'source_id', 'page', 'transcription', 'confidence', 'note']).execute();
  const pages = group(
    await db.selectFrom('image').select(['id', 'citation_id']).where('citation_id', 'is not', null).orderBy('id').execute(),
    (i) => i.citation_id,
  );
  const citations = new Map(
    rows.map((c): [string, ExportCitation] => [
      c.id,
      {
        id: c.id,
        sourceId: c.source_id,
        page: c.page ?? '',
        transcription: c.transcription,
        confidence: c.confidence,
        note: c.note ?? '',
        links: (pages.get(c.id) ?? []).map((i) => imageLink(i.id, 'page image')),
      },
    ]),
  );
  return (ids) =>
    [...ids]
      .sort()
      .map((id) => citations.get(id))
      .filter((c): c is ExportCitation => c !== undefined);
}

type Role = { event_id: string; person_id: string; role: string; type: string; date: string | null };

/** Every Event with its Roles (each saying whether its Person is Living) and Citations, in date order. */
async function loadEvents(db: Db, rolesOfEvent: Map<string, Role[]>, living: Map<string, boolean>, citationsOf: (ids: readonly string[]) => ExportCitation[]) {
  const rows = await db
    .selectFrom('event')
    .select(['id', 'type', 'type_detail', 'date', 'place_id', 'house_id', 'description', 'notes'])
    .orderBy('date_earliest')
    .orderBy('id')
    .execute();
  const cited = group(await db.selectFrom('event_citation').select(['event_id', 'citation_id']).execute(), (e) => e.event_id);
  const order = new Map(rows.map((e, i) => [e.id, i]));
  const events = new Map(
    rows.map((e): [string, ExportEvent] => [
      e.id,
      {
        id: e.id,
        type: e.type,
        typeDetail: e.type_detail ?? '',
        date: e.date ?? '',
        placeId: e.place_id ?? '',
        houseId: e.house_id ?? '',
        description: withoutMediaInText(e.description),
        notes: withoutMediaInText(e.notes),
        roles: (rolesOfEvent.get(e.id) ?? []).map((r) => ({ personId: r.person_id, role: r.role, living: living.get(r.person_id) ?? true })),
        citations: citationsOf((cited.get(e.id) ?? []).map((c) => c.citation_id)),
      },
    ]),
  );
  return (ids: Iterable<string>) =>
    [...new Set(ids)]
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
      .map((id) => events.get(id))
      .filter((e): e is ExportEvent => e !== undefined);
}

/** The birth year: of a birth Event with a single date, else of a baptism, where the Person is the child. */
function birthYearOf(roles: readonly Role[]): number | null {
  const birth =
    roles.find((r) => r.type === 'birth' && r.role === 'child' && yearOf(r.date) !== null) ??
    roles.find((r) => r.type === 'baptism' && r.role === 'child' && yearOf(r.date) !== null);
  return birth ? yearOf(birth.date) : null;
}

/** Persons and Families, with who is Living (also for the Sources a Living person gave). */
async function addPeople(db: Db, today: Date, citationsOf: (ids: readonly string[]) => ExportCitation[], out: Gathered): Promise<Map<string, boolean>> {
  const persons = await db.selectFrom('person').select(['id', 'sex', 'notes', 'relation']).where('merged_into_id', 'is', null).orderBy('id').execute();
  const roles: Role[] = await db
    .selectFrom('event_role as r')
    .innerJoin('event as e', 'e.id', 'r.event_id')
    .select(['r.event_id', 'r.person_id', 'r.role', 'e.type', 'e.date'])
    .orderBy('r.event_id')
    .orderBy('r.sort_order')
    .orderBy('r.id')
    .execute();
  const rolesOfPerson = group(roles, (r) => r.person_id);
  const rolesOfEvent = group(roles, (r) => r.event_id);
  const living = new Map(persons.map((p) => [p.id, isLiving(livingFactsFromEvents(rolesOfPerson.get(p.id) ?? []), today)]));
  const eventsOf = await loadEvents(db, rolesOfEvent, living, citationsOf);
  const families = await db.selectFrom('family').select(['id', 'partner1_id', 'partner2_id', 'notes']).orderBy('id').execute();
  const children = await db
    .selectFrom('family_child')
    .select(['family_id', 'child_id', 'link_type'])
    .orderBy('family_id')
    .orderBy('sort_order')
    .orderBy('id')
    .execute();

  const names = group(
    await db
      .selectFrom('name')
      .select(['id', 'person_id', 'given', 'surname', 'type', 'language', 'as_found'])
      .orderBy('person_id')
      .orderBy('is_primary', 'desc')
      .orderBy('sort_order')
      .orderBy('id')
      .execute(),
    (n) => n.person_id,
  );
  const nameCitations = group(await db.selectFrom('name_citation').select(['name_id', 'citation_id']).execute(), (n) => n.name_id);
  const labels = group(await db.selectFrom('person_label').select(['person_id', 'label']).orderBy('label').execute(), (l) => l.person_id);
  const roots = new Set((await db.selectFrom('family_root').select('person_id').execute()).map((r) => r.person_id));
  const portraits = group(
    await db.selectFrom('image_person as ip').innerJoin('image as i', 'i.id', 'ip.image_id').select(['ip.person_id', 'i.id']).orderBy('i.id').execute(),
    (r) => r.person_id,
  );
  const childOf = group(children, (c) => c.child_id);
  const partnerIn = group(
    families.flatMap((f) => [f.partner1_id, f.partner2_id].flatMap((p) => (p === null ? [] : [{ person: p, family: f.id }]))),
    (x) => x.person,
  );

  for (const p of persons) {
    const personNames: ExportName[] = (names.get(p.id) ?? []).map((n) => ({
      given: n.given,
      surname: n.surname,
      type: n.type,
      language: n.language ?? '',
      asFound: n.as_found,
      citations: citationsOf((nameCitations.get(n.id) ?? []).map((c) => c.citation_id)),
    }));
    const relations: ExportRelation[] = [
      ...(childOf.get(p.id) ?? []).map((c) => ({ rel: 'childOf', target: c.family_id, detail: c.link_type })),
      ...(partnerIn.get(p.id) ?? []).map((x) => ({ rel: 'partnerIn', target: x.family, detail: '' })),
    ];
    const facts: ExportFact[] = [
      { key: 'relation', value: p.relation, detail: '' },
      ...(roots.has(p.id) ? [{ key: 'familyRoot', value: 'true', detail: '' }] : []),
      ...(labels.get(p.id) ?? []).map((l) => ({ key: 'label', value: l.label, detail: '' })),
    ];
    const birthYear = birthYearOf(rolesOfPerson.get(p.id) ?? []);
    const view = exportRecord({
      ...blank('person', p.id),
      living: living.get(p.id) ?? true,
      sex: p.sex,
      names: personNames,
      relations,
      birthYear: birthYear ?? 0,
      hasBirthYear: birthYear !== null,
      events: eventsOf((rolesOfPerson.get(p.id) ?? []).map((r) => r.event_id)),
      facts,
      notes: withoutMediaInText(p.notes),
      links: (portraits.get(p.id) ?? []).map((i) => imageLink(i.id, 'image')),
    });
    out.records.push(view);
    const first = view.names[0];
    out.titles.set(p.id, first ? `${first.given} ${first.surname}`.trim() : '?');
  }

  const kidsOf = group(children, (c) => c.family_id);
  for (const f of families) {
    const kids = kidsOf.get(f.id) ?? [];
    const partners = [f.partner1_id, f.partner2_id].filter((x): x is string => x !== null);
    // The Family's own Events: marriages in which every partner of it took part.
    const marriages = partners
      .flatMap((p) => rolesOfPerson.get(p) ?? [])
      .filter((r) => r.type === 'marriage' && r.role === 'partner')
      .map((r) => r.event_id)
      .filter((id) => partners.every((p) => (rolesOfEvent.get(id) ?? []).some((r) => r.person_id === p)));
    out.records.push(
      exportRecord({
        ...blank('family', f.id),
        concernsLiving: [...partners, ...kids.map((k) => k.child_id)].some((m) => living.get(m) ?? false),
        relations: [
          ...partners.map((p) => ({ rel: 'partner', target: p, detail: '' })),
          ...kids.map((k) => ({ rel: 'child', target: k.child_id, detail: k.link_type })),
        ],
        events: eventsOf(marriages),
        notes: withoutMediaInText(f.notes),
      }),
    );
    out.titles.set(f.id, partners.map((p) => out.titles.get(p) ?? '?').join(' & ') || 'Family');
  }
  return living;
}

export async function gatherExport(db: Db, clock: Clock): Promise<ExportTree> {
  const out: Gathered = { records: [], titles: new Map() };
  const citationsOf = await loadCitations(db);
  const living = await addPeople(db, clock.now(), citationsOf, out);
  await addPlaces(db, out);
  await addSources(db, living, out);
  out.records.sort((a, b) => (KIND_ORDER.get(a.kind) ?? 99) - (KIND_ORDER.get(b.kind) ?? 99) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { ...out, leads: await leadsForExport(db, clock) };
}
