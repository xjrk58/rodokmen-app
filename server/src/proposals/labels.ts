import { EVENT_TYPE_LABELS, type SummaryContext, type SummaryLanguage } from '@rodokmen/shared';
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

/**
 * Readable labels of existing records (Persons by primary Name, Events by type and date,
 * Places by name, Sources by title …) for the sentences shown in review and history.
 */
export async function labelsFor(db: Db, ids: readonly string[]): Promise<SummaryContext & { labels: Map<string, Label> }> {
  const labels = new Map<string, Label>();
  const set = (id: string, cs: string, en = cs) => labels.set(id, { cs, en });
  const list = [...new Set(ids)];
  if (list.length > 0) {
    const persons = await db
      .selectFrom('person as p')
      .leftJoin('name as n', (j) => j.onRef('n.person_id', '=', 'p.id').on('n.is_primary', '=', true))
      .select(['p.id', 'p.merged_into_id', 'n.given', 'n.surname'])
      .where('p.id', 'in', list)
      .execute();
    for (const p of persons) {
      if (p.given !== null) set(p.id, displayName(p.given, p.surname ?? ''));
    }
    // Merged Persons have no Names of their own; their old name is in the log.
    for (const p of persons.filter((x) => x.given === null)) {
      const old = await db
        .selectFrom('log_change')
        .select('before')
        .where('record_table', '=', 'name')
        .where(({ eb, ref }) => eb(ref('before'), '@>', JSON.stringify({ person_id: p.id, is_primary: true }) as never))
        .orderBy('id', 'desc')
        .executeTakeFirst();
      const b = old?.before as { given?: string; surname?: string } | undefined;
      const name = b ? displayName(b.given ?? '', b.surname ?? '') : '?';
      set(p.id, `${name} (sloučená osoba)`, `${name} (merged Person)`);
    }
    for (const n of await db.selectFrom('name').select(['id', 'as_found']).where('id', 'in', list).execute()) set(n.id, `„${n.as_found}“`, `“${n.as_found}”`);
    for (const e of await db.selectFrom('event').select(['id', 'type', 'type_detail', 'date']).where('id', 'in', list).execute()) {
      const cs = e.type === 'other' && e.type_detail ? e.type_detail : EVENT_TYPE_LABELS.cs[e.type];
      const en = e.type === 'other' && e.type_detail ? e.type_detail : EVENT_TYPE_LABELS.en[e.type];
      set(e.id, e.date ? `${cs} ${e.date}` : cs, e.date ? `the ${en} of ${e.date}` : `the ${en}`);
    }
    for (const p of await db.selectFrom('place_name').select(['place_id', 'name']).where('place_id', 'in', list).where('is_primary', '=', true).execute()) set(p.place_id, p.name);
    for (const h of await db
      .selectFrom('house as h')
      .innerJoin('place_name as pn', (j) => j.onRef('pn.place_id', '=', 'h.place_id').on('pn.is_primary', '=', true))
      .select(['h.id', 'pn.name'])
      .where('h.id', 'in', list)
      .execute()) {
      const numbers = await db.selectFrom('house_number').select('number').where('house_id', '=', h.id).orderBy('valid_from').execute();
      set(h.id, `${h.name} čp. ${numbers.map((n) => n.number).join('/')}`, `${h.name} No. ${numbers.map((n) => n.number).join('/')}`);
    }
    for (const s of await db.selectFrom('source').select(['id', 'title']).where('id', 'in', list).execute()) set(s.id, `„${s.title}“`, `“${s.title}”`);
    for (const c of await db.selectFrom('citation as c').innerJoin('source as s', 's.id', 'c.source_id').select(['c.id', 'c.page', 's.title']).where('c.id', 'in', list).execute()) {
      set(c.id, c.page ? `„${c.title}“, s. ${c.page}` : `„${c.title}“`, c.page ? `“${c.title}”, p. ${c.page}` : `“${c.title}”`);
    }
    const families = await db.selectFrom('family').select(['id', 'partner1_id', 'partner2_id']).where('id', 'in', list).execute();
    if (families.length) {
      const partnerIds = families.flatMap((f) => [f.partner1_id, f.partner2_id]).filter((x): x is string => x !== null);
      const names = partnerIds.length
        ? await db.selectFrom('name').select(['person_id', 'given', 'surname']).where('person_id', 'in', partnerIds).where('is_primary', '=', true).execute()
        : [];
      const byId = new Map(names.map((n) => [n.person_id, displayName(n.given, n.surname)]));
      for (const f of families) {
        const ps = [f.partner1_id, f.partner2_id].filter((x): x is string => x !== null).map((p) => byId.get(p) ?? '?');
        set(f.id, `rodina ${ps.join(' a ')}`, `the Family of ${ps.join(' and ')}`);
      }
    }
    for (const r of await db
      .selectFrom('event_role as r')
      .innerJoin('name as n', (j) => j.onRef('n.person_id', '=', 'r.person_id').on('n.is_primary', '=', true))
      .select(['r.id', 'r.role', 'n.given', 'n.surname'])
      .where('r.id', 'in', list)
      .execute()) {
      set(r.id, `${displayName(r.given, r.surname)} (${r.role})`);
    }
    for (const l of await db
      .selectFrom('family_child as l')
      .innerJoin('name as n', (j) => j.onRef('n.person_id', '=', 'l.child_id').on('n.is_primary', '=', true))
      .select(['l.id', 'n.given', 'n.surname'])
      .where('l.id', 'in', list)
      .execute()) {
      set(l.id, displayName(l.given, l.surname));
    }
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
