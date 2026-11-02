/**
 * What the sentences of review and history share (proposal-summaries.ts, place-summaries.ts):
 * the languages, quoting, and the names of record kinds.
 */
import type { UiLanguage } from './common.js';
import type { NotesRecord, Operation, SettableRecord } from './proposals.js';
import type { PlaceType } from './tree.js';

export type SummaryLanguage = UiLanguage;

/** Labels of the records operations refer to, such as a Person's name or "the baptism (1801-03-12)". */
export interface SummaryContext {
  label(ref: string, language: SummaryLanguage): string;
}

export type Op<K extends Operation['op']> = Extract<Operation, { op: K }>;

/** What every sentence needs: the label of a referenced record, and the language. */
export interface Say {
  L: (ref: string) => string;
  cs: boolean;
  language: SummaryLanguage;
  ctx: SummaryContext;
}

export const quote = (s: string, language: SummaryLanguage) => (language === 'cs' ? `„${s}“` : `“${s}”`);

export const RECORD_LABELS: Record<SummaryLanguage, Record<SettableRecord | NotesRecord, string>> = {
  en: {
    person: 'Person',
    name: 'Name',
    event: 'Event',
    role: 'Role',
    childLink: 'child link',
    source: 'Source',
    citation: 'Citation',
    family: 'Family',
    place: 'Place',
    house: 'House',
    parish: 'Parish',
    estate: 'Estate',
  },
  cs: {
    person: 'osoba',
    name: 'jméno',
    event: 'událost',
    role: 'role',
    childLink: 'vazba dítěte',
    source: 'pramen',
    citation: 'citace',
    family: 'rodina',
    place: 'místo',
    house: 'dům',
    parish: 'farnost',
    estate: 'panství',
  },
};

export const PLACE_TYPE_LABELS: Record<SummaryLanguage, Record<PlaceType, string>> = {
  en: { village: 'village', town: 'town', hamlet: 'hamlet', other: 'place' },
  cs: { village: 'vesnice', town: 'město', hamlet: 'osada', other: 'místo' },
};
