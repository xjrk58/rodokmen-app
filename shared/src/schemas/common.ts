import { z } from 'zod';
import { isEdtf, tryParseEdtf } from '../edtf.js';

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

export const GeoPoint = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  })
  .meta({ id: 'GeoPoint', description: 'WGS 84 point' });

/** Language of the interface and of emails. */
export const UiLanguage = z.enum(['cs', 'en']).meta({ id: 'UiLanguage' });

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

export const Paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export { isEdtf };

export type Id = z.infer<typeof Id>;
export type EdtfDate = z.infer<typeof EdtfDate>;
export type DatedValue = z.infer<typeof DatedValue>;
export type Period = z.infer<typeof Period>;
export type GeoPoint = z.infer<typeof GeoPoint>;
export type UiLanguage = z.infer<typeof UiLanguage>;
export type NameLanguage = z.infer<typeof NameLanguage>;
export type ApiError = z.infer<typeof ApiError>;
