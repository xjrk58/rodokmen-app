import { EVENT_TYPE_LABELS, ROLE_LABELS, type SummaryContext, type SummaryLanguage } from '@rodokmen/shared';
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

async function personLabels(db: Db, ids: string[], out: Labels): Promise<void> {
  const persons = await db
    .selectFrom('person as p')
    .leftJoin('name as n', (j) => j.onRef('n.person_id', '=', 'p.id').on('n.is_primary', '=', true))
    .select(['p.id', 'n.given', 'n.surname'])
    .where('p.id', 'in', ids)
    .execute();
  for (const p of persons) {
    if (p.given !== null) {
      out.set(p.id, both(displayName(p.given, p.surname ?? '')));
      continue;
    }
    // Merged Persons have no Names of their own; their old name is in the log.
    const old = await db
      .selectFrom('log_change')
      .select('before')
      .where('record_table', '=', 'name')
      .where(sql<boolean>`before @> ${JSON.stringify({ person_id: p.id, is_primary: true })}::jsonb`)
      .orderBy('id', 'desc')
      .executeTakeFirst();
    const name = old?.before ? displayName(text(old.before.given), text(old.before.surname)) : '?';
    out.set(p.id, { cs: `${name} (sloučená osoba)`, en: `${name} (merged Person)` });
  }
}

async function eventLabels(db: Db, ids: string[], out: Labels): Promise<void> {
  for (const e of await db.selectFrom('event').select(['id', 'type', 'type_detail', 'date']).where('id', 'in', ids).execute()) {
    const detail = e.type === 'other' && e.type_detail ? e.type_detail : null;
    const cs = detail ?? EVENT_TYPE_LABELS.cs[e.type];
    const en = detail ?? EVENT_TYPE_LABELS.en[e.type];
    out.set(e.id, { cs: e.date ? `${cs} ${e.date}` : cs, en: e.date ? `the ${en} of ${e.date}` : `the ${en}` });
  }
}

async function houseLabels(db: Db, ids: string[], out: Labels): Promise<void> {
  const houses = await db
    .selectFrom('house as h')
    .innerJoin('place_name as pn', (j) => j.onRef('pn.place_id', '=', 'h.place_id').on('pn.is_primary', '=', true))
    .select(['h.id', 'pn.name'])
    .where('h.id', 'in', ids)
    .execute();
  if (houses.length === 0) return;
  const numbers = await db.selectFrom('house_number').select(['house_id', 'number']).where('house_id', 'in', houses.map((h) => h.id)).orderBy('valid_from').execute();
  for (const h of houses) {
    const list = numbers.filter((n) => n.house_id === h.id).map((n) => n.number).join('/');
    out.set(h.id, { cs: `${h.name} čp. ${list}`, en: `${h.name} No. ${list}` });
  }
}

async function evidenceLabels(db: Db, ids: string[], out: Labels): Promise<void> {
  for (const s of await db.selectFrom('source').select(['id', 'title']).where('id', 'in', ids).execute()) out.set(s.id, { cs: `„${s.title}“`, en: `“${s.title}”` });
  for (const c of await db.selectFrom('citation as c').innerJoin('source as s', 's.id', 'c.source_id').select(['c.id', 'c.page', 's.title']).where('c.id', 'in', ids).execute()) {
    out.set(c.id, c.page ? { cs: `„${c.title}“, s. ${c.page}`, en: `“${c.title}”, p. ${c.page}` } : { cs: `„${c.title}“`, en: `“${c.title}”` });
  }
}

async function familyLabels(db: Db, ids: string[], out: Labels): Promise<void> {
  const families = await db.selectFrom('family').select(['id', 'partner1_id', 'partner2_id']).where('id', 'in', ids).execute();
  if (families.length === 0) return;
  const partnerIds = families.flatMap((f) => [f.partner1_id, f.partner2_id]).filter((x): x is string => x !== null);
  const names = partnerIds.length ? await db.selectFrom('name').select(['person_id', 'given', 'surname']).where('person_id', 'in', partnerIds).where('is_primary', '=', true).execute() : [];
  const byId = new Map(names.map((n) => [n.person_id, displayName(n.given, n.surname)]));
  for (const f of families) {
    const ps = [f.partner1_id, f.partner2_id].filter((x): x is string => x !== null).map((p) => byId.get(p) ?? '?');
    out.set(f.id, { cs: `rodina ${ps.join(' a ')}`, en: `the Family of ${ps.join(' and ')}` });
  }
}

async function linkLabels(db: Db, ids: string[], out: Labels): Promise<void> {
  const roles = await db
    .selectFrom('event_role as r')
    .innerJoin('name as n', (j) => j.onRef('n.person_id', '=', 'r.person_id').on('n.is_primary', '=', true))
    .select(['r.id', 'r.role', 'n.given', 'n.surname'])
    .where('r.id', 'in', ids)
    .execute();
  for (const r of roles) {
    const who = displayName(r.given, r.surname);
    out.set(r.id, { cs: `${who} (${ROLE_LABELS.cs[r.role]})`, en: `${who} (${ROLE_LABELS.en[r.role]})` });
  }
  const children = await db
    .selectFrom('family_child as l')
    .innerJoin('name as n', (j) => j.onRef('n.person_id', '=', 'l.child_id').on('n.is_primary', '=', true))
    .select(['l.id', 'n.given', 'n.surname'])
    .where('l.id', 'in', ids)
    .execute();
  for (const l of children) out.set(l.id, both(displayName(l.given, l.surname)));
}

/**
 * Readable labels of existing records (Persons by primary Name, Events by type and date,
 * Places by name, Sources by title …) for the sentences shown in review and history.
 */
export async function labelsFor(db: Db, ids: readonly string[]): Promise<SummaryContext & { labels: Labels }> {
  const labels: Labels = new Map();
  const list = [...new Set(ids)];
  if (list.length > 0) {
    await personLabels(db, list, labels);
    for (const n of await db.selectFrom('name').select(['id', 'as_found']).where('id', 'in', list).execute()) labels.set(n.id, { cs: `„${n.as_found}“`, en: `“${n.as_found}”` });
    await eventLabels(db, list, labels);
    for (const p of await db.selectFrom('place_name').select(['place_id', 'name']).where('place_id', 'in', list).where('is_primary', '=', true).execute()) labels.set(p.place_id, both(p.name));
    await houseLabels(db, list, labels);
    await evidenceLabels(db, list, labels);
    await familyLabels(db, list, labels);
    await linkLabels(db, list, labels);
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
