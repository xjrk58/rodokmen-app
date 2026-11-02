import type { GapKind, LeadDetail, LeadSuggestion, PersonSummary, SuggestionListQuery } from '@rodokmen/shared';
import { sql } from 'kysely';
import { ApiProblem } from '../auth/problem.js';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import type { Account } from '../db/types.js';
import { personSummaries, placeRefs } from '../tree/summaries.js';
import { ANY } from './gaps.js';
import { createLead, type LeadDeps } from './service.js';

/**
 * Suggested leads as Members see them (research-leads spec, "Gap finder suggests leads"): apart
 * from the leads, each with the lead it proposes in Czech and English, until a Member accepts it
 * (it becomes a lead) or dismisses it (its key is kept, so it is never suggested again). The
 * gap finder that stores them is gaps.ts.
 */

const quoted = (s: string) => `„${s}“`;

/** The lead a suggestion proposes, in Czech and English. */
function sentences(
  kind: GapKind,
  who: string,
  source: string | null,
  archive: string | null,
  years: { from: number; to: number } | null,
): Pick<LeadSuggestion, 'question' | 'reason'> {
  const span = years ? (years.from === years.to ? `${years.from}` : `${years.from}–${years.to}`) : null;
  const where = {
    cs: [source ? `zkontrolovat ${quoted(source)}` : archive ? `hledat v archivu ${archive}` : null, span ? `roky ${span}` : null].filter(Boolean).join(', '),
    en: [source ? `check "${source}"` : archive ? `look in ${archive}` : null, span ? `years ${span}` : null].filter(Boolean).join(', '),
  };
  const tail = (lang: 'cs' | 'en') => (where[lang] ? `: ${where[lang]}` : '');
  switch (kind) {
    case 'birth':
      return {
        question: { cs: `Najít křest nebo narození: ${who}${tail('cs')}`, en: `Find the baptism or birth of ${who}${tail('en')}` },
        reason: { cs: `${who} je příbuzný(á), ale křest ani narození nemá citaci.`, en: `${who} is a Relative, but no baptism or birth has a Citation.` },
      };
    case 'parents':
      return {
        question: { cs: `Najít rodiče: ${who}${tail('cs')}`, en: `Find the parents of ${who}${tail('en')}` },
        reason: {
          cs: `Rodiče nejsou známí, ale farnost a roky narození ano; zápis o křtu je jmenuje.`,
          en: `The parents are unknown, while the Parish and years of the birth are known; the baptism entry names them.`,
        },
      };
    case 'marriage':
      return {
        question: { cs: `Najít sňatek: ${who}${tail('cs')}`, en: `Find the marriage of ${who}${tail('en')}` },
        reason: { cs: `Sňatek nemá citaci.`, en: `The marriage has no Citation.` },
      };
  }
}

type SuggestionRow = {
  id: string;
  key: string;
  kind: GapKind;
  status: 'open' | 'accepted' | 'dismissed';
  person_id: string | null;
  family_id: string | null;
  source_id: string | null;
  place_id: string | null;
  archive: string | null;
  years_from: number | null;
  years_to: number | null;
  lead_id: string | null;
};

async function suggestionViews(db: Db, clock: Clock, rows: readonly SuggestionRow[]): Promise<LeadSuggestion[]> {
  if (rows.length === 0) return [];
  const families = await db
    .selectFrom('family')
    .select(['id', 'partner1_id', 'partner2_id'])
    .where('id', '=', ANY(rows.flatMap((r) => (r.family_id ? [r.family_id] : []))))
    .execute();
  const partners = new Map(families.map((f) => [f.id, [f.partner1_id, f.partner2_id].filter((x): x is string => x !== null)]));
  const persons = await personSummaries(db, [...rows.flatMap((r) => (r.person_id ? [r.person_id] : [])), ...[...partners.values()].flat()], clock);
  const places = await placeRefs(
    db,
    rows.flatMap((r) => (r.place_id ? [r.place_id] : [])),
  );
  const sourceIds = rows.flatMap((r) => (r.source_id ? [r.source_id] : []));
  const sources = new Map(
    sourceIds.length
      ? (await db.selectFrom('source').select(['id', 'title', 'repository', 'reference']).where('id', 'in', sourceIds).execute()).map((s) => [s.id, s])
      : [],
  );
  return rows.map((r) => {
    const person: PersonSummary | null = r.person_id ? (persons.get(r.person_id) ?? null) : null;
    const pair = r.family_id ? (partners.get(r.family_id) ?? []).flatMap((id) => persons.get(id) ?? []) : [];
    const source = r.source_id ? (sources.get(r.source_id) ?? null) : null;
    const years = r.years_from !== null && r.years_to !== null ? { from: r.years_from, to: r.years_to } : null;
    const who = pair.length === 2 ? `${pair[0]!.displayName} & ${pair[1]!.displayName}` : (person?.displayName ?? '?');
    return {
      id: r.id,
      key: r.key,
      kind: r.kind,
      status: r.status,
      person,
      familyId: r.family_id,
      partners: pair,
      place: r.place_id ? (places.get(r.place_id) ?? null) : null,
      source,
      archive: r.archive,
      years,
      ...sentences(r.kind, who, source?.title ?? null, r.archive, years),
      leadId: r.lead_id,
    };
  });
}

/** Open suggestions, apart from the leads, for a Person or a Place or all of them: Relatives' births first. */
export async function listSuggestions(db: Db, clock: Clock, q: SuggestionListQuery): Promise<{ items: LeadSuggestion[]; total: number }> {
  let query = db.selectFrom('lead_suggestion as s').where('s.status', '=', 'open');
  if (q.personId) {
    const personId = q.personId;
    query = query.where((eb) =>
      eb.or([
        eb('s.person_id', '=', personId),
        eb.exists(
          eb
            .selectFrom('family as f')
            .select(sql`1`.as('x'))
            .whereRef('f.id', '=', 's.family_id')
            .where((w) => w.or([w('f.partner1_id', '=', personId), w('f.partner2_id', '=', personId)])),
        ),
      ]),
    );
  }
  if (q.placeId) query = query.where('s.place_id', '=', q.placeId);
  const { total } = await query.select((eb) => eb.fn.countAll<number>().as('total')).executeTakeFirstOrThrow();
  const rows = await query
    .selectAll('s')
    .orderBy(sql`case s.kind when 'birth' then 0 when 'parents' then 1 else 2 end`)
    .orderBy('s.years_from')
    .orderBy('s.key')
    .limit(q.limit)
    .offset(q.offset)
    .execute();
  return { items: await suggestionViews(db, clock, rows), total };
}

async function openSuggestion(db: Db, clock: Clock, id: string): Promise<LeadSuggestion> {
  const row = await db.selectFrom('lead_suggestion').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw new ApiProblem(404, 'not_found', 'No suggested lead with this id.');
  if (row.status !== 'open') throw new ApiProblem(409, 'already_decided', `This suggested lead was already ${row.status}.`);
  return (await suggestionViews(db, clock, [row]))[0]!;
}

/** Marks a suggestion decided, unless someone decided it meanwhile. */
async function decide(db: Db, id: string, status: 'accepted' | 'dismissed', by: Account, at: Date, leadId: string | null): Promise<void> {
  const r = await db
    .updateTable('lead_suggestion')
    .set({ status, decided_by: by.id, decided_at: at, lead_id: leadId })
    .where('id', '=', id)
    .where('status', '=', 'open')
    .executeTakeFirst();
  if (Number(r.numUpdatedRows) === 0) throw new ApiProblem(409, 'already_decided', 'This suggested lead was already decided.');
}

/**
 * A Member accepts a suggestion: it becomes a lead with its Person (or both partners), Place,
 * register, archive and years, written in the Member's language, and its key is never suggested again.
 */
export async function acceptSuggestion(deps: LeadDeps, member: Account, id: string): Promise<LeadDetail> {
  const s = await openSuggestion(deps.db, deps.clock, id);
  const lang = member.language;
  const lead = await createLead(
    deps,
    member,
    {
      question: s.question[lang],
      reason: s.reason[lang],
      archive: s.archive,
      sourceId: s.source?.id ?? null,
      years: s.years,
      pages: null,
      personIds: s.partners.length ? s.partners.map((p) => p.id) : s.person ? [s.person.id] : [],
      placeIds: s.place ? [s.place.id] : [],
      assigneeId: null,
      outcome: null,
      status: 'open',
      searches: [],
    },
    { suggestionKey: s.key },
  );
  try {
    await decide(deps.db, id, 'accepted', member, deps.clock.now(), lead.id);
  } catch (error) {
    // Someone decided it meanwhile: the lead just written is not needed.
    await deps.db.deleteFrom('lead').where('id', '=', lead.id).execute();
    throw error;
  }
  return lead;
}

/** A Member dismisses a suggestion: kept as dismissed by its key, so the same lead is never suggested again. */
export async function dismissSuggestion(deps: LeadDeps, member: Account, id: string): Promise<LeadSuggestion> {
  await openSuggestion(deps.db, deps.clock, id);
  await decide(deps.db, id, 'dismissed', member, deps.clock.now(), null);
  const row = await deps.db.selectFrom('lead_suggestion').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  return (await suggestionViews(deps.db, deps.clock, [row]))[0]!;
}
