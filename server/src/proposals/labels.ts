import {
  EVENT_TYPE_LABELS,
  IMAGE_KIND_LABELS,
  RESTORABLE_TABLES,
  ROLE_LABELS,
  type RestorableTable,
  type SummaryContext,
  type SummaryLanguage,
} from '@rodokmen/shared';
import { sql } from 'kysely';
import type { Db } from '../db/db.js';
import { displayName } from '../tree/summaries.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Every record id mentioned anywhere in some JSON values. */
export function idsIn(...values: unknown[]): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string' && UUID.test(v)) out.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  values.forEach(walk);
  return [...out];
}

type Label = Record<SummaryLanguage, string>;
type Labels = Map<string, Label>;
const both = (cs: string, en = cs): Label => ({ cs, en });
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const idOf = (value: unknown): string | null => (typeof value === 'string' && UUID.test(value) ? value : null);
const quoted = (s: string): Label => ({ cs: `„${s}“`, en: `“${s}”` });

/** A Tree record as it is now, or, once it is gone, as the log last saw it (ADR 0006). */
interface Row {
  table: RestorableTable;
  values: Record<string, unknown>;
}

/** The columns of each table whose records its label is made of: a Role is labelled by its Person, a Citation by its Source … */
const PARTS: Partial<Record<RestorableTable, readonly string[]>> = {
  family: ['partner1_id', 'partner2_id'],
  family_child: ['child_id'],
  event_role: ['person_id'],
  citation: ['source_id'],
  event_citation: ['citation_id', 'event_id'],
  name_citation: ['citation_id', 'name_id'],
  image: ['citation_id'],
  image_person: ['image_id', 'person_id'],
  family_root: ['person_id'],
};
/** The longest chain of parts: a Person in an image, its image, the image's Citation, its Source. */
const DEPTH = 4;

/** Records of any Tree table by id, as they are now, in one query. */
async function treeRows(db: Db, ids: readonly string[]): Promise<Map<string, Row>> {
  const parts = RESTORABLE_TABLES.map(
    (t) => sql`select ${sql.lit(t)} as record_table, to_jsonb(r.*) as row from ${sql.table(t)} r where r.id = any(${ids}::uuid[])`,
  );
  const { rows } = await sql<{ record_table: RestorableTable; row: Record<string, unknown> }>`${sql.join(parts, sql` union all `)}`.execute(db);
  return new Map(rows.map((r) => [text(r.row.id), { table: r.record_table, values: r.row }]));
}

/** Records no longer in the Tree, as the log last saw them: after their last change, or before it when that removed them. */
async function loggedRows(db: Db, ids: readonly string[]): Promise<Map<string, Row>> {
  const rows = await db
    .selectFrom('log_change')
    .distinctOn('record_id')
    .select(['record_id', 'record_table', sql<Record<string, unknown> | null>`coalesce(after, before)`.as('row')])
    .where('record_id', 'in', ids)
    .orderBy('record_id')
    .orderBy('id', 'desc')
    .execute();
  return new Map(rows.flatMap((r) => (r.row ? [[r.record_id, { table: r.record_table, values: r.row }] as const] : [])));
}

/**
 * The records the ids name, and the records their labels are made of, now or as last logged.
 * Places and Houses, which are not changed through Proposals, are labelled on the way.
 */
async function rowsFor(db: Db, ids: readonly string[], out: Labels): Promise<Map<string, Row>> {
  const rows = new Map<string, Row>();
  let wanted = [...ids];
  for (let depth = 0; wanted.length > 0 && depth < DEPTH; depth++) {
    for (const [id, row] of await treeRows(db, wanted)) rows.set(id, row);
    let gone = wanted.filter((id) => !rows.has(id));
    if (depth === 0 && gone.length > 0) {
      await placeLabels(db, gone, out);
      await houseLabels(db, gone, out);
      gone = gone.filter((id) => !out.has(id));
    }
    if (gone.length > 0) for (const [id, row] of await loggedRows(db, gone)) rows.set(id, row);
    const parts = wanted.flatMap((id) => {
      const row = rows.get(id);
      return row ? (PARTS[row.table] ?? []).map((column) => idOf(row.values[column])) : [];
    });
    wanted = [...new Set(parts)].filter((id): id is string => id !== null && !rows.has(id));
  }
  return rows;
}

/**
 * The primary Name of each Person, as it is now or, for Persons without Names of their own
 * (merged into another, or removed by an undo), as the log last saw it.
 */
async function primaryNames(db: Db, persons: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (persons.length === 0) return out;
  for (const n of await db
    .selectFrom('name')
    .select(['person_id', 'given', 'surname'])
    .where('person_id', 'in', persons)
    .where('is_primary', '=', true)
    .execute())
    out.set(n.person_id, displayName(n.given, n.surname));
  const missing = new Set(persons.filter((p) => !out.has(p)));
  if (missing.size === 0) return out;
  // A Name that was primary for the Person: before a change that moved or removed it, or after any other.
  const conditions = [...missing].flatMap((p) => {
    const doc = JSON.stringify({ person_id: p, is_primary: true });
    return [sql<boolean>`before @> ${doc}::jsonb`, sql<boolean>`(coalesce(before, '{}'::jsonb) || coalesce(after, '{}'::jsonb)) @> ${doc}::jsonb`];
  });
  const logged = await db
    .selectFrom('log_change')
    .select(['before', 'after'])
    .where('record_table', '=', 'name')
    .where((eb) => eb.or(conditions))
    .orderBy('id', 'desc')
    .execute();
  for (const c of logged) {
    // The Name as it was for the Person: after the change while it stayed theirs, else before it.
    const states = c.after ? [c.after, ...(c.before && c.before.person_id !== c.after.person_id ? [c.before] : [])] : [c.before];
    for (const s of states) {
      const p = text(s?.person_id);
      if (s && s.is_primary === true && missing.has(p) && !out.has(p)) out.set(p, displayName(text(s.given), text(s.surname)));
    }
  }
  return out;
}

async function placeLabels(db: Db, ids: readonly string[], out: Labels): Promise<void> {
  for (const p of await db.selectFrom('place_name').select(['place_id', 'name']).where('place_id', 'in', ids).where('is_primary', '=', true).execute())
    out.set(p.place_id, both(p.name));
}

async function houseLabels(db: Db, ids: readonly string[], out: Labels): Promise<void> {
  const houses = await db
    .selectFrom('house as h')
    .innerJoin('place_name as pn', (j) => j.onRef('pn.place_id', '=', 'h.place_id').on('pn.is_primary', '=', true))
    .select(['h.id', 'pn.name'])
    .where('h.id', 'in', ids)
    .execute();
  if (houses.length === 0) return;
  const numbers = await db
    .selectFrom('house_number')
    .select(['house_id', 'number'])
    .where(
      'house_id',
      'in',
      houses.map((h) => h.id),
    )
    .orderBy('valid_from')
    .execute();
  for (const h of houses) {
    const list = numbers
      .filter((n) => n.house_id === h.id)
      .map((n) => n.number)
      .join('/');
    out.set(h.id, { cs: `${h.name} čp. ${list}`, en: `${h.name} No. ${list}` });
  }
}

/** The word for a stored value (an Event type, a Role …) in one language, or the value itself. */
function word(words: Readonly<Record<string, string>>, value: unknown, detail: unknown): string {
  const key = text(value);
  if (key === 'other' && text(detail)) return text(detail);
  return (Object.hasOwn(words, key) && words[key]) || key;
}

/** What one record's label is made of: its row, the labels of the records its columns point at, and Persons' primary Names. */
interface Parts {
  v: Record<string, unknown>;
  part: (column: string) => Label;
  names: ReadonlyMap<string, string>;
}

const linked = (a: Label, b: Label): Label => ({ cs: `${a.cs} – ${b.cs}`, en: `${a.en} for ${b.en}` });

/**
 * The label of a record from its row, by table: Persons by primary Name, Names by their spelling
 * as found, Events by type and date, Sources by title, and links by what they link.
 */
const LABELLERS: Record<RestorableTable, (p: Parts) => Label | undefined> = {
  person: ({ v, names }) => {
    const name = names.get(text(v.id));
    if (name === undefined) return undefined;
    return v.merged_into_id ? { cs: `${name} (sloučená osoba)`, en: `${name} (merged Person)` } : both(name);
  },
  name: ({ v }) => quoted(text(v.as_found)),
  event: ({ v }) => {
    const [cs, en, date] = [word(EVENT_TYPE_LABELS.cs, v.type, v.type_detail), word(EVENT_TYPE_LABELS.en, v.type, v.type_detail), text(v.date)];
    return { cs: date ? `${cs} ${date}` : cs, en: date ? `the ${en} of ${date}` : `the ${en}` };
  },
  source: ({ v }) => quoted(text(v.title)),
  citation: ({ v, part }) => {
    const [source, page] = [part('source_id'), text(v.page)];
    return page ? { cs: `${source.cs}, s. ${page}`, en: `${source.en}, p. ${page}` } : source;
  },
  family: ({ v, part }) => {
    const partners = ['partner1_id', 'partner2_id'].filter((c) => v[c]).map(part);
    return { cs: `rodina ${partners.map((p) => p.cs).join(' a ')}`, en: `the Family of ${partners.map((p) => p.en).join(' and ')}` };
  },
  family_child: ({ part }) => part('child_id'),
  event_role: ({ v, part }) => {
    const who = part('person_id');
    return { cs: `${who.cs} (${word(ROLE_LABELS.cs, v.role, v.role_detail)})`, en: `${who.en} (${word(ROLE_LABELS.en, v.role, v.role_detail)})` };
  },
  family_root: ({ part }) => {
    const who = part('person_id');
    return { cs: `${who.cs} (kořen rodu)`, en: `${who.en} (Family root)` };
  },
  event_citation: ({ part }) => linked(part('citation_id'), part('event_id')),
  name_citation: ({ part }) => linked(part('citation_id'), part('name_id')),
  image: ({ v, part }) => {
    const [cs, en] = [word(IMAGE_KIND_LABELS.cs, v.kind, null), word(IMAGE_KIND_LABELS.en, v.kind, null)];
    if (!v.citation_id) return { cs, en: `the ${en}` };
    const citation = part('citation_id');
    return { cs: `${cs} (${citation.cs})`, en: `the ${en} of ${citation.en}` };
  },
  image_person: ({ part }) => {
    const [who, image] = [part('person_id'), part('image_id')];
    return { cs: `${who.cs} – ${image.cs}`, en: `${who.en} in ${image.en}` };
  },
};

/**
 * Readable labels of records (Persons by primary Name, Events by type and date, Places by
 * name, Sources by title …) for the sentences shown in review and history. A record no longer
 * in the Tree, such as one an undo removed, is labelled from the log's snapshot of it, so the
 * history still says what was changed (tree-history spec, "History of a record").
 */
export async function labelsFor(db: Db, ids: readonly string[]): Promise<SummaryContext & { labels: Labels }> {
  const labels: Labels = new Map();
  const list = [...new Set(ids)].filter((id) => UUID.test(id));
  if (list.length > 0) {
    const rows = await rowsFor(db, list, labels);
    const persons = [...rows].filter(([, r]) => r.table === 'person').map(([id]) => id);
    const names = await primaryNames(db, persons);
    const make = (id: string, depth: number): Label | undefined => {
      const row = rows.get(id);
      if (labels.has(id) || !row || depth > DEPTH) return labels.get(id);
      const part = (column: string) => {
        const ref = idOf(row.values[column]);
        return (ref && make(ref, depth + 1)) || both('?');
      };
      const label = LABELLERS[row.table]({ v: row.values, part, names });
      if (label) labels.set(id, label);
      return label;
    };
    for (const id of rows.keys()) make(id, 0);
  }
  return {
    labels,
    label(ref, language) {
      const found = labels.get(ref);
      if (found) return found[language];
      return language === 'cs' ? `záznam ${ref.slice(-6)}` : `record ${ref.slice(-6)}`;
    },
  };
}
