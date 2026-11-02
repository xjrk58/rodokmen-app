/**
 * Research leads a reading suggests (scan-reading spec, "Reading suggests next steps"). The reader
 * returns hints ("parents married before 1801", "godparent from čp. 7"); these templates turn them
 * into lead suggestions in Czech and English, with the Parish, the archive and a register of the
 * Tree that covers the years, so the leads name real Sources. A suggestion states no fact about
 * the family; the Member accepts or dismisses each one.
 *
 * Some hints follow from the entry itself and are added here whatever the model said: both
 * parents of a child give the lead to find their marriage.
 */
import type { LeadHint, LeadSuggestion, ReadEntry, ReadingResult, ReadPerson } from './schemas/reading.js';

/** A register of the Tree, as the server finds it: a Source, the kinds of Events cited from it, and the years they span. */
export interface RegisterOption {
  sourceId: string;
  title: string;
  /** Event types its Citations are attached to, such as "baptism" or "marriage". */
  kinds: readonly string[];
  from: number;
  to: number;
}

/** What the templates know beyond the reading: where the entries are from, and the registers held for that Parish. */
export interface LeadContext {
  parish: string | null;
  archive: string | null;
  place: string | null;
  registers: readonly RegisterOption[];
}

/** How many years before a birth a lead looks for the parents' marriage. */
export const MARRIAGE_YEARS_BEFORE = 25;

const yearOf = (date: string | null): number | null => {
  if (date === null) return null;
  const year = Number.parseInt(date.replace(/^\.\.\//, ''), 10);
  return Number.isFinite(year) ? year : null;
};

const nameOf = (p: ReadPerson | undefined): string => p?.names[0]?.asWritten ?? '?';

/** The register of the Tree that best covers a kind of Event and a span of years: the most years in common, then the title. */
export function registerFor(registers: readonly RegisterOption[], kind: string, from: number, to: number): RegisterOption | null {
  const overlap = (r: RegisterOption) => Math.min(r.to, to) - Math.max(r.from, from) + 1;
  const fitting = registers.filter((r) => r.kinds.includes(kind) && overlap(r) > 0);
  fitting.sort((a, b) => overlap(b) - overlap(a) || a.title.localeCompare(b.title) || a.sourceId.localeCompare(b.sourceId));
  return fitting[0] ?? null;
}

/** The hints of an entry: the reader's, plus those that follow from the entry itself. */
export function hintsOf(entry: ReadEntry): LeadHint[] {
  const hints = [...entry.hints];
  const year = yearOf(entry.date);
  const father = entry.persons.find((p) => p.role === 'father');
  const mother = entry.persons.find((p) => p.role === 'mother');
  const isBirth = entry.type === 'baptism' || entry.type === 'birth';
  if (isBirth && father && mother && year !== null && !hints.some((h) => h.kind === 'parents_marriage')) {
    hints.unshift({ kind: 'parents_marriage', personKeys: [father.key, mother.key], house: null, year, note: '' });
  }
  return hints;
}

interface Texts {
  question: { cs: string; en: string };
  reason: { cs: string; en: string };
  years: { from: number; to: number } | null;
  /** The kind of Event a register to check holds, or "any". */
  kind: string;
}

/** What a template knows: the hint, the names it concerns, the year of the entry, and where. */
interface Facts {
  hint: LeadHint;
  named: string[];
  year: number | null;
  ctx: LeadContext;
}

const around = (year: number | null, before: number, after: number) => (year === null ? null : { from: year - before, to: year + after });
const suffix = (text: string | null | undefined, wrap: (t: string) => string) => (text ? wrap(text) : '');

function parentsMarriage({ named, year, ctx }: Facts): Texts {
  const before = (y: number | null, cs: boolean) => (y === null ? '' : cs ? `, před rokem ${y}` : ` before ${y}`);
  return {
    kind: 'marriage',
    years: around(year, MARRIAGE_YEARS_BEFORE, 0),
    question: {
      cs: `Najít sňatek: ${named.join(' a ')}${before(year, true)}${suffix(ctx.parish, (p) => ` (farnost: ${p})`)}`,
      en: `Find the marriage of ${named.join(' and ')}${before(year, false)}${suffix(ctx.parish, (p) => ` (Parish: ${p})`)}`,
    },
    reason: {
      cs: `Zápis${year === null ? '' : ` z roku ${year}`} uvádí oba rodiče; jejich sňatek bývá v téže farnosti před narozením dítěte.`,
      en: `The entry${year === null ? '' : ` of ${year}`} names both parents; their marriage is usually in the same Parish before the child’s birth.`,
    },
  };
}

function godparentHouse({ hint, named, year, ctx }: Facts): Texts {
  const house = hint.house ?? '?';
  const note = suffix(hint.note, (n) => ` (${n})`);
  return {
    kind: 'residence',
    years: around(year, 5, 5),
    question: {
      cs: `Zjistit, kdo žil v čp. ${house}${suffix(ctx.place, (p) => ` v obci ${p}`)}: ${named.join(', ') || 'kmotr'}`,
      en: `Find who lived at čp. ${house}${suffix(ctx.place, (p) => ` of ${p}`)}: ${named.join(', ') || 'the godparent'}`,
    },
    reason: { cs: `Kmotr je zapsán z čp. ${house}${note}.`, en: `The godparent is recorded from čp. ${house}${note}.` },
  };
}

function otherEntry({ hint, named, year }: Facts): Texts {
  const later = hint.kind === 'later_entry';
  const who = named.length ? `: ${named.join(', ')}` : '';
  return {
    kind: 'any',
    years: later ? around(year, 0, 30) : around(year, 30, 0),
    question: {
      cs: `Najít ${later ? 'pozdější' : 'dřívější'} zápis, na který stránka odkazuje${who}`,
      en: `Find the ${later ? 'later' : 'earlier'} entry the page refers to${who}`,
    },
    reason: { cs: hint.note || 'Stránka odkazuje na jiný zápis.', en: hint.note || 'The page refers to another entry.' },
  };
}

function nextStep({ hint, year }: Facts): Texts {
  return {
    kind: 'any',
    years: around(year, 10, 10),
    question: { cs: hint.note || 'Další krok podle zápisu', en: hint.note || 'A next step from the entry' },
    reason: { cs: 'Navrženo z přečteného zápisu.', en: 'Suggested from the entry as read.' },
  };
}

const TEMPLATES: Record<LeadHint['kind'], (f: Facts) => Texts> = {
  parents_marriage: parentsMarriage,
  godparent_house: godparentHouse,
  earlier_entry: otherEntry,
  later_entry: otherEntry,
  other: nextStep,
};

/** The words and years of one hint, by its kind. */
function texts(hint: LeadHint, entry: ReadEntry, ctx: LeadContext): Texts {
  const persons = new Map(entry.persons.map((p) => [p.key, p]));
  const named = hint.personKeys.map((k) => nameOf(persons.get(k)));
  return TEMPLATES[hint.kind]({ hint, named, year: hint.year ?? yearOf(entry.date), ctx });
}

/**
 * The lead suggestions of a reading, entry by entry. Each has a stable key (entry, kind and
 * persons), so a dismissed suggestion can be recognised again.
 */
export function leadSuggestions(result: ReadingResult, ctx: LeadContext): LeadSuggestion[] {
  const out: LeadSuggestion[] = [];
  const keys = new Set<string>();
  result.entries.forEach((entry, index) => {
    for (const hint of hintsOf(entry)) {
      const key = `${index}:${hint.kind}:${hint.personKeys.join('+')}:${hint.house ?? ''}`;
      if (keys.has(key)) continue;
      keys.add(key);
      const t = texts(hint, entry, ctx);
      const register = t.years && t.kind !== 'any' ? registerFor(ctx.registers, t.kind, t.years.from, t.years.to) : null;
      out.push({
        key,
        kind: hint.kind,
        entry: index,
        question: t.question,
        reason: t.reason,
        personKeys: hint.personKeys,
        years: t.years,
        parish: ctx.parish,
        archive: ctx.archive,
        sourceId: register?.sourceId ?? null,
        sourceTitle: register?.title ?? null,
      });
    }
  });
  return out;
}
