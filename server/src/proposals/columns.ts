import { MunicipalityLink, RegisterCoverage, RegisterKind, type GeoPoint, type NotesRecord, type RestorableTable, type SettableRecord } from '@rodokmen/shared';
import { sql } from 'kysely';
import { dateColumns } from '../tree/dates.js';

/** Where each settable record kind lives, and how its API fields map to columns. */
export const RECORD_TABLES: Record<SettableRecord | NotesRecord, RestorableTable> = {
  person: 'person',
  name: 'name',
  event: 'event',
  role: 'event_role',
  childLink: 'family_child',
  source: 'source',
  citation: 'citation',
  family: 'family',
  place: 'place',
  house: 'house',
  parish: 'parish',
  estate: 'estate',
};

export const FIELD_COLUMNS: Record<string, string> = {
  asFound: 'as_found',
  typeDetail: 'type_detail',
  placeId: 'place_id',
  houseId: 'house_id',
  roleDetail: 'role_detail',
  linkType: 'link_type',
  readOn: 'read_on',
  seatPlaceId: 'seat_place_id',
};

/** A point as a column value. */
export const point = (p: GeoPoint | null) => (p ? sql`ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326)::geography` : null);

/** The columns of a Place's Municipality link. */
export const municipalityColumns = (m: MunicipalityLink | null) => ({ municipality_code: m?.code ?? null, municipality_name: m?.name ?? null });

export const columnOf = (field: string): string => FIELD_COLUMNS[field] ?? field;

/** The columns of a register's coverage (a Source's `register` field); all empty for none. */
export function registerColumns(register: RegisterCoverage | null) {
  return {
    register_parish_id: register?.parishId ?? null,
    register_kinds: register?.kinds ?? [],
    register_from: register?.from ?? null,
    register_to: register?.to ?? null,
  };
}

/** A Source's `register` field from its columns. */
export function registerOf(row: Record<string, unknown>): RegisterCoverage | null {
  const parishId = row.register_parish_id;
  if (typeof parishId !== 'string') return null;
  const year = (v: unknown) => (typeof v === 'number' ? v : null);
  return {
    parishId,
    kinds: Array.isArray(row.register_kinds) ? row.register_kinds.filter((k): k is RegisterKind => RegisterKind.safeParse(k).success) : [],
    from: year(row.register_from),
    to: year(row.register_to),
  };
}

/** Column values for a setField operation (an Event date also sets its earliest and latest days, a Source's register its four columns). */
export function setFieldColumns(set: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(set)) {
    if (field === 'date') Object.assign(out, dateColumns(typeof value === 'string' ? value : null));
    else if (field === 'register') Object.assign(out, registerColumns(RegisterCoverage.nullable().parse(value ?? null)));
    else if (field === 'municipality') Object.assign(out, municipalityColumns(MunicipalityLink.nullable().parse(value ?? null)));
    else out[columnOf(field)] = value;
  }
  return out;
}

/** The current value of an API field in a stored row. */
export function fieldOf(row: Record<string, unknown>, field: string): unknown {
  if (field === 'register') return registerOf(row);
  if (field === 'municipality')
    return typeof row.municipality_code === 'string' && typeof row.municipality_name === 'string'
      ? { code: row.municipality_code, name: row.municipality_name }
      : null;
  return row[columnOf(field)] ?? null;
}
