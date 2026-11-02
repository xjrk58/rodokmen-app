/**
 * Scan reading (scan-reading spec, ADR 0011): what the reader returns for one or more scans of
 * register pages, and the payloads of the reading routes.
 *
 * {@link ReadingResult} is the contract with the model: the server asks the Anthropic API for
 * JSON in exactly this shape (structured output), and then checks the answer against this
 * schema, refinements included. An answer that does not match is a failed reading, never
 * repaired by guessing. Only plain JSON shapes are used (no optional fields: a value the reader
 * does not have is null, an empty list or an empty text), so the JSON Schema sent to the API is
 * the same contract the server checks.
 */
import { z } from 'zod';
import { PersonSummary } from './api.js';
import { EdtfDate, Id, WebUrl } from './common.js';
import { EventType, RoleType, Sex, type NameType } from './tree.js';

/**
 * A BCP 47 language tag, simplified: the language subtag and optional script, region or variant
 * subtags (`la`, `de`, `cs`, `de-Latf`). Names carry the language they are written in (decision
 * #64); until Names have a language of their own (#17), {@link nameTypeForLanguage} maps it.
 */
export const LanguageTag = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'a BCP 47 language tag such as la, de or cs')
  .meta({ id: 'LanguageTag', description: 'BCP 47 language tag: la (Latin), de (German), cs (Czech), …' });

/** A house number (čp.) as the Tree keeps them: digits, optionally one letter. */
export const HOUSE_NUMBER = /^\d{1,5}[a-z]?$/;
const ReadHouse = z
  .string()
  .regex(HOUSE_NUMBER, 'a house number (čp.) is digits, optionally followed by one letter')
  .nullable()
  .describe('House number (čp.) as digits, such as "12" for "N. 12"; null when the page gives none or it cannot be read');

export const ReadName = z
  .object({
    given: z.string().max(200).describe('Given names as written on the page; empty when not given'),
    surname: z.string().max(200).describe('Surname as written on the page; empty when not given'),
    asWritten: z.string().trim().min(1).max(400).describe('The whole name exactly as on the page, in its spelling'),
    language: LanguageTag.describe('Language the name is written in'),
  })
  .meta({ id: 'ReadName' });

export const ReadPerson = z
  .object({
    key: z
      .string()
      .regex(/^p\d{1,3}$/, 'a person key looks like p1')
      .describe('p1, p2, …: unique within the whole reading'),
    role: RoleType.describe('child, father, mother, godparent, priest, … ; partner for bride and groom; other with a roleDetail'),
    roleDetail: z.string().max(200).nullable().describe('The role in words when it is "other", such as "midwife" or "father of the bride"'),
    sex: Sex,
    names: z.array(ReadName).min(1).max(5).describe('The first is the name as the entry gives it; others are further forms on the page'),
    description: z.string().max(400).nullable().describe('Status, occupation or descent as written, such as "colonus" or "filia legitima"'),
    house: ReadHouse,
    residence: z.string().max(200).nullable().describe('Where the person lives, as written, when not the entry’s own Place'),
  })
  .meta({ id: 'ReadPerson' });

export const Illegible = z
  .object({
    field: z.string().min(1).max(100).describe('What could not be read: "date", "house", "place", or a person’s value such as "p3.surname" or "p3.house"'),
    note: z.string().max(400).describe('What is visible there, such as "faded" or "ink blot over the number"'),
  })
  .meta({ id: 'Illegible' });

export const LEAD_HINT_KINDS = ['parents_marriage', 'godparent_house', 'earlier_entry', 'later_entry', 'other'] as const;
export const LeadHintKind = z.enum(LEAD_HINT_KINDS).meta({ id: 'LeadHintKind' });

/** A next step the entry implies (scan-reading spec, "Reading suggests next steps"). States no fact. */
export const LeadHint = z
  .object({
    kind: LeadHintKind,
    personKeys: z.array(z.string()).max(10).describe('The persons of the same entry it concerns'),
    house: ReadHouse,
    year: z.number().int().min(1000).max(2100).nullable().describe('The year it points to, when it names one'),
    note: z.string().max(400).describe('The next step in the words of the page, such as "married in Vrbice 1798"'),
  })
  .meta({ id: 'LeadHint' });

export const ReadEntry = z
  .object({
    page: z.number().int().min(0).max(9).describe('Index of the scan the entry is on, from 0'),
    type: EventType,
    typeDetail: z.string().max(200).nullable().describe('What kind of Event, when the type is "other"'),
    date: EdtfDate.nullable().describe('The date of the Event in the EDTF subset (1801-03-12, 1801-03, 1801, 1801?, 1801~); null when not legible'),
    dateAsWritten: z.string().max(200).nullable().describe('The date exactly as on the page'),
    house: ReadHouse,
    place: z.string().max(200).nullable().describe('The Place of the Event as written, when the entry names one'),
    transcription: z.string().trim().min(1).max(20_000).describe('The entry’s text in its original language and spelling'),
    persons: z.array(ReadPerson).max(40),
    illegible: z.array(Illegible).max(40),
    hints: z.array(LeadHint).max(10),
  })
  .meta({ id: 'ReadEntry' });

export const ReadPage = z
  .object({
    page: z.number().int().min(0).max(9).describe('Index of the scan, from 0, in the order they were sent'),
    transcription: z.string().max(20_000).describe('The whole page in its original language and spelling, line by line'),
    languages: z.array(LanguageTag).max(5).describe('Languages the page is written in'),
  })
  .meta({ id: 'ReadPage' });

/** Where each check of {@link ReadingResult} points, by field. */
function personsOf(entries: ReadonlyArray<z.infer<typeof ReadEntry>>) {
  return entries.flatMap((e, entry) => e.persons.map((p, person) => ({ p, entry, person })));
}

/**
 * What the reader found on the scans. Checked beyond its shape: pages numbered 0, 1, … in order,
 * entries on those pages, person keys unique, hints naming persons of their own entry, and no
 * value both given and reported illegible ("never guess it").
 */
export const ReadingResult = z
  .object({
    pages: z.array(ReadPage).min(1).max(10),
    entries: z.array(ReadEntry).max(30),
    note: z.string().max(2000).nullable().describe('Anything about the scans as a whole, such as "the right margin is cut off"'),
  })
  .superRefine((r, ctx) => {
    r.pages.forEach((p, i) => {
      if (p.page !== i) ctx.addIssue({ code: 'custom', message: `pages are numbered from 0 in order; found ${p.page} at ${i}`, path: ['pages', i, 'page'] });
    });
    const seen = new Set<string>();
    for (const { p, entry, person } of personsOf(r.entries)) {
      if (seen.has(p.key)) ctx.addIssue({ code: 'custom', message: `person key ${p.key} is used twice`, path: ['entries', entry, 'persons', person, 'key'] });
      seen.add(p.key);
    }
    r.entries.forEach((e, i) => {
      if (e.page >= r.pages.length)
        ctx.addIssue({ code: 'custom', message: `entry ${i + 1} is on page ${e.page}, which was not read`, path: ['entries', i, 'page'] });
      const keys = new Set(e.persons.map((p) => p.key));
      e.hints.forEach((h, j) => {
        for (const k of h.personKeys)
          if (!keys.has(k)) ctx.addIssue({ code: 'custom', message: `hint ${j + 1} names ${k}, who is not in this entry`, path: ['entries', i, 'hints', j] });
      });
      const unreadable = new Set(e.illegible.map((x) => x.field));
      if (unreadable.has('house') && e.house !== null)
        ctx.addIssue({ code: 'custom', message: 'a house number reported illegible must be left empty', path: ['entries', i, 'house'] });
      if (unreadable.has('date') && e.date !== null)
        ctx.addIssue({ code: 'custom', message: 'a date reported illegible must be left empty', path: ['entries', i, 'date'] });
      e.persons.forEach((p, j) => {
        if (unreadable.has(`${p.key}.house`) && p.house !== null)
          ctx.addIssue({
            code: 'custom',
            message: `${p.key}: a house number reported illegible must be left empty`,
            path: ['entries', i, 'persons', j, 'house'],
          });
      });
    });
  })
  .meta({ id: 'ReadingResult' });

export type LanguageTag = z.infer<typeof LanguageTag>;
export type ReadName = z.infer<typeof ReadName>;
export type ReadPerson = z.infer<typeof ReadPerson>;
export type Illegible = z.infer<typeof Illegible>;
export type LeadHint = z.infer<typeof LeadHint>;
export type LeadHintKind = z.infer<typeof LeadHintKind>;
export type ReadEntry = z.infer<typeof ReadEntry>;
export type ReadPage = z.infer<typeof ReadPage>;
export type ReadingResult = z.infer<typeof ReadingResult>;

/**
 * Today's Name type for a name written in a language (decision #64): Latin and German forms have
 * types of their own, any other language is "other". Once Names carry a language tag (#17), the
 * tag is kept as it is and this mapping goes away.
 */
export function nameTypeForLanguage(tag: string): NameType {
  const language = tag.toLowerCase().split('-')[0];
  if (language === 'la') return 'latin';
  if (language === 'de') return 'german';
  return 'other';
}

// ---------------------------------------------------------------- requests

/** Archive viewers are never fetched (scan-reading spec, "Only scans the Member supplies"). */
export const PORTAL_LINK_MESSAGE =
  'This is a link to an archive viewer, not an image. Save the page as an image or take a photo of it, and add that; the link is kept as the Citation’s link.';

const looksLikeLink = (value: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim()) || /^www\./i.test(value.trim());

/** True for text that is a web address rather than an uploaded image's id. */
export function isPortalLink(value: string): boolean {
  return looksLikeLink(value);
}

/** An uploaded image to read, by its upload id. A pasted link is refused with what to do instead. */
const ScanRef = z
  .string()
  .superRefine((value, ctx) => {
    if (looksLikeLink(value)) ctx.addIssue({ code: 'custom', message: PORTAL_LINK_MESSAGE });
    else if (!Id.safeParse(value).success) ctx.addIssue({ code: 'custom', message: 'an upload id (POST /api/uploads)' });
  })
  .describe('Upload id of a finished upload (POST /api/uploads): your own, or one already attached to a Citation');

export const ReadingCrop = z
  .strictObject({
    uploadId: Id,
    left: z.number().min(0).max(1).describe('From the left edge, as a share of the width'),
    top: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .refine((c) => c.left + c.width <= 1.000001 && c.top + c.height <= 1.000001, { message: 'the crop lies outside the image' })
  .meta({ id: 'ReadingCrop', description: 'The part of a scan the Member marked, as shares of its width and height' });

export const ReadingYears = z
  .strictObject({ from: z.number().int().min(1000).max(2100), to: z.number().int().min(1000).max(2100) })
  .refine((y) => y.from <= y.to, { message: 'the years end before they start', path: ['to'] })
  .meta({ id: 'ReadingYears' });

/** What the Member knows about the scans; every field may be left out. */
export const ReadingContext = z
  .strictObject({
    sourceId: Id.nullable().default(null).describe('The Source in the Tree the pages are from, when known'),
    sourceTitle: z.string().trim().max(400).nullable().default(null).describe('The register as the Member names it, when it is not in the Tree'),
    page: z.string().trim().max(200).nullable().default(null).describe('Page or frame'),
    placeId: Id.nullable().default(null).describe('The Place the entries are from'),
    years: ReadingYears.nullable().default(null),
    note: z.string().trim().max(2000).nullable().default(null).describe('Anything else the Member knows'),
    link: WebUrl.nullable().default(null).describe('The archive viewer address of the page: kept as the Citation’s link, never fetched'),
  })
  .meta({ id: 'ReadingContext' });

export const CreateReadingBody = z
  .strictObject({
    uploadIds: z.array(ScanRef).min(1).max(5).describe('The scans to read, in page order'),
    crops: z.array(ReadingCrop).max(5).default([]).describe('Marked parts: only these are sent, not the whole scan'),
    context: ReadingContext.default({ sourceId: null, sourceTitle: null, page: null, placeId: null, years: null, note: null, link: null }),
  })
  .superRefine((b, ctx) => {
    const ids = new Set(b.uploadIds);
    if (ids.size !== b.uploadIds.length) ctx.addIssue({ code: 'custom', message: 'each scan once', path: ['uploadIds'] });
    const cropped = new Set<string>();
    b.crops.forEach((c, i) => {
      if (!ids.has(c.uploadId)) ctx.addIssue({ code: 'custom', message: 'a crop of a scan that is not read', path: ['crops', i, 'uploadId'] });
      if (cropped.has(c.uploadId)) ctx.addIssue({ code: 'custom', message: 'one crop per scan', path: ['crops', i, 'uploadId'] });
      cropped.add(c.uploadId);
    });
  })
  .meta({ id: 'CreateReadingBody' });

export type ReadingCrop = z.infer<typeof ReadingCrop>;
export type ReadingContext = z.infer<typeof ReadingContext>;
export type CreateReadingBody = z.infer<typeof CreateReadingBody>;

// ---------------------------------------------------------------- views

export const ReadingStatus = z.enum(['queued', 'running', 'done', 'failed']).meta({ id: 'ReadingStatus' });
export type ReadingStatus = z.infer<typeof ReadingStatus>;

const Sentence = z.object({ cs: z.string(), en: z.string() });

export const MatchReasons = z
  .object({
    name: z.boolean().describe('A given name and a surname, or their variants, match a Name of the Person'),
    house: z.boolean().describe('The Person has an Event at a House that carried the read house number'),
    years: z.boolean().describe('The Person’s birth fits the years the role allows'),
    place: z.boolean().describe('The Person has an Event at the Place of the reading'),
    family: z.boolean().describe('A partner of the Person matches another person of the entry'),
  })
  .meta({ id: 'MatchReasons' });

export const MatchCandidate = z
  .object({ person: PersonSummary, score: z.number().int(), reasons: MatchReasons })
  .meta({ id: 'MatchCandidate', description: 'An existing Person a read name probably refers to, with the reasons' });

export const PersonMatches = z
  .object({ key: z.string().describe('The read person'), candidates: z.array(MatchCandidate).describe('Best first; empty when nobody fits') })
  .meta({ id: 'PersonMatches' });

export const LeadSuggestion = z
  .object({
    key: z.string().describe('Stable key of the suggestion within the reading'),
    kind: LeadHintKind,
    entry: z.number().int().describe('Index of the entry it follows from'),
    question: Sentence,
    reason: Sentence,
    personKeys: z.array(z.string()),
    years: z.object({ from: z.number().int(), to: z.number().int() }).nullable(),
    parish: z.string().nullable(),
    archive: z.string().nullable(),
    sourceId: Id.nullable().describe('A register of the Tree to check, when one covers the Parish and years'),
    sourceTitle: z.string().nullable(),
  })
  .meta({ id: 'LeadSuggestion', description: 'A Research lead the reading suggests, for the Member to accept or dismiss' });

export const ReadingError = z.object({ code: z.string(), message: z.string() }).meta({ id: 'ReadingError' });

export const ReadingView = z
  .object({
    id: Id,
    status: ReadingStatus,
    author: z.object({ id: Id, displayName: z.string(), isAgent: z.boolean() }),
    uploadIds: z.array(Id),
    crops: z.array(ReadingCrop),
    context: ReadingContext,
    model: z.string().nullable().describe('The model that read the scans'),
    createdAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
    result: ReadingResult.nullable().describe('What was read; null until done'),
    error: ReadingError.nullable().describe('Why the reading failed'),
    matches: z.array(PersonMatches).describe('For each read person, the existing Persons it may be'),
    houses: z.array(Id.nullable()).describe('For each entry, the House of the Place that carried its house number then, when the Tree has it'),
    leads: z.array(LeadSuggestion),
  })
  .meta({ id: 'ReadingView' });

export const ReadingStatusView = z
  .object({
    dailyLimit: z.number().int(),
    usedToday: z.number().int(),
    remaining: z.number().int(),
  })
  .meta({ id: 'ReadingStatusView', description: 'Scan reading is switched on: what is left of your readings today' });

export const ReadingUsage = z
  .object({
    day: z.iso.date(),
    author: z.object({ id: Id, displayName: z.string(), isAgent: z.boolean() }),
    readings: z.number().int(),
    failed: z.number().int(),
  })
  .meta({ id: 'ReadingUsage' });

export const ScanReadingSettings = z
  .object({
    enabled: z.boolean(),
    dailyLimit: z.number().int().describe('Readings per Member (or Agent) per day'),
    configured: z.boolean().describe('The server has an Anthropic API key; without one scan reading cannot be switched on'),
    model: z.string().describe('The model that reads (RODOKMEN_SCAN_MODEL)'),
    changedAt: z.iso.datetime().nullable(),
    changedBy: z.string().nullable(),
    usage: z.array(ReadingUsage).describe('Readings per Member and day, the last 30 days, newest first'),
  })
  .meta({ id: 'ScanReadingSettings' });

export const UpdateScanReadingBody = z
  .strictObject({
    enabled: z.boolean().describe('Scans are sent to Anthropic’s API to be read while this is on'),
    dailyLimit: z.number().int().min(1).max(200),
  })
  .meta({ id: 'UpdateScanReadingBody' });

export type MatchReasons = z.infer<typeof MatchReasons>;
export type MatchCandidate = z.infer<typeof MatchCandidate>;
export type PersonMatches = z.infer<typeof PersonMatches>;
export type LeadSuggestion = z.infer<typeof LeadSuggestion>;
export type ReadingView = z.infer<typeof ReadingView>;
export type ReadingStatusView = z.infer<typeof ReadingStatusView>;
export type ReadingUsage = z.infer<typeof ReadingUsage>;
export type ScanReadingSettings = z.infer<typeof ScanReadingSettings>;
export type UpdateScanReadingBody = z.infer<typeof UpdateScanReadingBody>;

// ---------------------------------------------------------------- Proposals from a reading

/**
 * The "read by AI" marks of a Proposal drafted from readings: which values of which operations
 * are still as the reader produced them, unconfirmed and unchanged by the Member. The server
 * stores and shows them, and caps the confidence of the Proposal's new Citations at normal.
 */
export const ReaderMark = z
  .strictObject({
    position: z.number().int().min(0).describe('Index of the operation'),
    fields: z.array(z.string().max(60)).min(1).max(20).describe('Its fields still as read, such as "name.surname" or "date"'),
  })
  .meta({ id: 'ReaderMark' });

export const ReaderInfo = z
  .strictObject({
    readingIds: z.array(Id).min(1).max(10).describe('The readings the Proposal was drafted from'),
    marks: z.array(ReaderMark).max(300).default([]),
  })
  .meta({ id: 'ReaderInfo', description: 'The Proposal was drafted from scan readings' });

export type ReaderMark = z.infer<typeof ReaderMark>;
export type ReaderInfo = z.infer<typeof ReaderInfo>;
