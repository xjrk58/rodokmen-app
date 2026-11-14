/**
 * Living people on a Sheet (tree-charts spec, "Living people on a Sheet"): a card of a Sheet is
 * the Export view of its Person, so that a Sheet reduces exactly whom an Export reduces, the same
 * way (design.md, "Decisions taken at implementation"). This file maps a card's rows to an Export
 * record and back; the reduction itself is {@link sheetPerson} in shared/src/export.ts, proved
 * with LemmaScript beside the Export view it calls.
 *
 * Not proved: that the mapping carries every fact a card shows into the record (each of its
 * Events, with every Role and Source), and reads back only what the view keeps; the tests in
 * shared/test/charts-model.test.ts check that no other field survives.
 */
import type { RowEvent, RowName, RowPerson } from './chart-row-types.js';
import { hasLivingRole, sheetPerson, type ExportEvent, type ExportRecord } from './export.js';

function exportEvent(e: RowEvent, living: (id: string) => boolean): ExportEvent {
  return {
    id: e.id,
    type: e.type,
    typeDetail: '',
    date: e.date ?? '',
    placeId: e.placeId ?? '',
    houseId: e.houseId ?? '',
    description: '',
    notes: '',
    roles: e.roles.map((r) => ({ personId: r.personId, role: r.role, living: living(r.personId) })),
    citations: e.sourceIds.map((sourceId) => ({ id: '', sourceId, page: '', transcription: '', confidence: '', note: '', links: [] })),
  };
}

/** Whether a Sheet may show an Event: nobody Living took part in it, as in an Export. */
export function mayShowOnSheet(e: RowEvent, living: (id: string) => boolean): boolean {
  return !hasLivingRole(exportEvent(e, living));
}

/** What a Sheet's card of a Person shows: the Name, the birth surname, the birth year and the Events left. */
export interface SheetCard {
  readonly name: { readonly given: string; readonly surname: string } | null;
  readonly birthSurname: string | null;
  readonly birthYear: number | null;
  readonly events: RowEvent[];
}

/**
 * The card of a Person on a Sheet: their record (Names, the Events of the card with all their
 * Roles and Sources, the birth year: the year of the earliest day the birth could be) through
 * {@link sheetPerson}, read back.
 */
export function sheetCard(
  person: RowPerson | null,
  id: string,
  names: readonly RowName[],
  events: readonly RowEvent[],
  birthYear: number | null,
  nameless: boolean,
  living: (id: string) => boolean,
): SheetCard {
  const ordered = [...names].sort((a, b) => Number(b.primary) - Number(a.primary) || a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const record: ExportRecord = {
    kind: 'person',
    id,
    living: person?.living ?? true,
    concernsLiving: false,
    sex: person?.sex ?? 'unknown',
    names: ordered.map((n) => ({ given: n.given, surname: n.surname, type: n.type, language: '', asFound: '', citations: [] })),
    relations: [],
    birthYear: birthYear ?? 0,
    hasBirthYear: birthYear !== null,
    events: events.map((e) => exportEvent(e, living)),
    facts: [],
    notes: '',
    links: [],
  };
  const view = sheetPerson(record, nameless);
  const kept = new Set(view.events.map((e) => e.id));
  const primary = view.names[0];
  const birth = view.names.find((n, i) => i > 0 && n.type === 'birth' && n.surname !== '' && n.surname !== primary?.surname);
  return {
    name: primary ? { given: primary.given, surname: primary.surname } : null,
    birthSurname: primary?.type === 'married' ? (birth?.surname ?? null) : null,
    birthYear: view.hasBirthYear ? view.birthYear : null,
    events: events.filter((e) => kept.has(e.id)),
  };
}
