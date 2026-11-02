import { z } from 'zod';
import { tryParseEdtf } from '../edtf.js';

/** UUIDv7 primary key of every record. Inputs accept any RFC 9562 UUID. */
export const Id = z.uuid().meta({ id: 'Id', description: 'Record id (UUIDv7)' });

/** Integer version of a record, incremented in the same transaction as each change. */
export const Version = z.number().int().positive().meta({ id: 'Version', description: 'Record version; changes whenever the record changes' });

/** A date in the EDTF subset (see shared/src/edtf.ts). */
export const EdtfDate = z
  .string()
  .min(4)
  .max(32)
  .superRefine((value, ctx) => {
    const result = tryParseEdtf(value);
    if (!result.ok) ctx.addIssue({ code: 'custom', message: result.error });
  })
  .meta({
    id: 'EdtfDate',
    description: 'Date in the EDTF subset: 1801-03-12, 1801-03, 1801, 1801~ (about), 1801? (uncertain), 1801/1803 (between), ../1805 (before), 1790/.. (after)',
    examples: ['1801-03-12', '1801~', '../1805'],
  });

/** ISO calendar day, `YYYY-MM-DD`. */
export const IsoDay = z.iso.date();

/** A date as written plus the derived range, as the API returns it. */
export const DatedValue = z
  .object({
    date: z.string().describe('EDTF-subset date as written'),
    earliest: IsoDay.nullable().describe('First day it could be; null when open'),
    latest: IsoDay.nullable().describe('Last day it could be; null when open'),
  })
  .meta({ id: 'DatedValue' });

/** A period with optional, possibly open ends. Ends are EDTF-subset dates, usually years. */
export const Period = z
  .object({
    from: EdtfDate.nullable().describe('Start of the period; null when unknown or open'),
    to: EdtfDate.nullable().describe('End of the period (inclusive); null when ongoing or open'),
  })
  .superRefine((p, ctx) => {
    if (p.from === null || p.to === null) return;
    const from = tryParseEdtf(p.from);
    const to = tryParseEdtf(p.to);
    if (from.ok && to.ok && from.value.earliest !== null && to.value.latest !== null && from.value.earliest > to.value.latest) {
      ctx.addIssue({ code: 'custom', message: 'the period ends before it starts', path: ['to'] });
    }
  })
  .meta({ id: 'Period' });

/**
 * A link to a web page, such as an archive's online scan of a register: http or https only, so
 * a stored link can never run script (`javascript:`) or carry a page of its own (`data:`).
 */
export const WebUrl = z.url({ protocol: /^https?$/, error: 'a web link starting with http:// or https://' }).max(2000);

export const GeoPoint = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  })
  .meta({ id: 'GeoPoint', description: 'WGS 84 point' });

/** Language of the interface and of emails. */
export const UiLanguage = z.enum(['cs', 'en']).meta({ id: 'UiLanguage' });

/**
 * A BCP 47 language tag in its canonical case (RFC 5646): a language subtag (`cs`, `la`, `de`,
 * `pl`, `ru`), optionally a script (`sr-Latn`), a region (`de-AT`) and variants. Checked for its
 * shape, not against a list, so a new language needs no change here. The database checks the
 * same pattern (migration 0010_name_languages).
 */
export const LANGUAGE_TAG_PATTERN = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?(-([0-9a-z]{5,8}|[0-9][0-9a-z]{3}))*$/;

/** The language a Name is written in (tree-model spec, "Names carry a language tag"). */
export const LanguageTag = z
  .string()
  .max(35)
  .regex(LANGUAGE_TAG_PATTERN, 'a BCP 47 language tag such as cs, la, de or pl')
  .meta({
    id: 'LanguageTag',
    description: 'BCP 47 language tag in canonical case, such as cs (Czech), la (Latin), de (German) or pl (Polish)',
    examples: ['cs', 'la', 'de'],
  });

/** Languages that historical Place names were recorded in. */
export const NameLanguage = z.enum(['cs', 'de', 'la']).meta({ id: 'NameLanguage', description: 'Czech, German or Latin' });

export const ApiError = z
  .object({
    statusCode: z.number().int(),
    error: z.string(),
    message: z.string(),
    code: z.string().optional(),
  })
  .meta({ id: 'ApiError' });

/** Paging of search results: at most 200 at a time. */
export const Paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export type Id = z.infer<typeof Id>;
export type EdtfDate = z.infer<typeof EdtfDate>;
export type DatedValue = z.infer<typeof DatedValue>;
export type Period = z.infer<typeof Period>;
export type GeoPoint = z.infer<typeof GeoPoint>;
export type UiLanguage = z.infer<typeof UiLanguage>;
export type NameLanguage = z.infer<typeof NameLanguage>;
export type LanguageTag = z.infer<typeof LanguageTag>;
export type ApiError = z.infer<typeof ApiError>;
