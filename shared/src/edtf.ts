/**
 * The EDTF subset used for every date in the Tree.
 *
 * Accepted forms (see the tree-model spec, "Dates allow uncertainty"):
 *
 * | Form        | Example            | earliest     | latest       |
 * |-------------|--------------------|--------------|--------------|
 * | day         | `1801-03-12`       | 1801-03-12   | 1801-03-12   |
 * | month       | `1801-03`          | 1801-03-01   | 1801-03-31   |
 * | year        | `1801`             | 1801-01-01   | 1801-12-31   |
 * | about       | `1801~`            | 1799-01-01   | 1803-12-31   |
 * | uncertain   | `1801?`            | 1801-01-01   | 1801-12-31   |
 * | between     | `1801/1803`        | 1801-01-01   | 1803-12-31   |
 * | before      | `../1805`          | (open)       | 1805-12-31   |
 * | after       | `1790/..`          | 1790-01-01   | (open)       |
 *
 * "About" (`~`) widens the range by {@link APPROXIMATE_SPREAD} of its precision
 * (2 years for a year, 1 month for a month, 7 days for a day). "Uncertain" (`?`)
 * keeps the stated range: the value is doubtful, not vague. Either qualifier may
 * follow a day, month or year. Interval ends are plain days, months or years.
 *
 * `earliest` and `latest` are ISO days (`YYYY-MM-DD`); `null` means the range
 * is open on that side. Events sort by `earliest` (open sorts first).
 */

export type EdtfPrecision = 'day' | 'month' | 'year';
export type EdtfQualifier = 'exact' | 'approximate' | 'uncertain';
export type EdtfForm = 'day' | 'month' | 'year' | 'about' | 'uncertain' | 'between' | 'before' | 'after';

export interface ParsedEdtf {
  /** The date exactly as written. */
  readonly input: string;
  readonly form: EdtfForm;
  readonly qualifier: EdtfQualifier;
  /** Precision of a single date; for intervals the precision of the coarser end. */
  readonly precision: EdtfPrecision;
  /** First day the date could be, or null when open. */
  readonly earliest: string | null;
  /** Last day the date could be, or null when open. */
  readonly latest: string | null;
}

export const APPROXIMATE_SPREAD = { year: 2, month: 1, day: 7 } as const;

export class EdtfError extends Error {
  constructor(
    readonly input: string,
    reason: string,
  ) {
    super(`"${input}" is not a date in the EDTF subset: ${reason}`);
    this.name = 'EdtfError';
  }
}

interface SimpleDate {
  year: number;
  month: number | null;
  day: number | null;
  precision: EdtfPrecision;
}

const SIMPLE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

function parseSimple(text: string, input: string): SimpleDate {
  const m = SIMPLE.exec(text);
  if (!m) throw new EdtfError(input, 'expected YYYY, YYYY-MM or YYYY-MM-DD');
  const year = Number(m[1]);
  if (year < 1) throw new EdtfError(input, 'year must be 0001 or later');
  if (m[2] === undefined) return { year, month: null, day: null, precision: 'year' };
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new EdtfError(input, `month ${m[2]} does not exist`);
  if (m[3] === undefined) return { year, month, day: null, precision: 'month' };
  const day = Number(m[3]);
  if (day < 1 || day > daysInMonth(year, month)) throw new EdtfError(input, `day ${m[3]} does not exist in ${m[1]}-${m[2]}`);
  return { year, month, day, precision: 'day' };
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export function isoDay(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Shifts an ISO day by whole years, months or days (proleptic Gregorian, UTC). */
function shift(iso: string, unit: EdtfPrecision, amount: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  if (unit === 'day') {
    // setUTCFullYear, unlike Date.UTC, does not map years 0-99 to 1900-1999.
    const date = new Date(0);
    date.setUTCFullYear(y, m - 1, d + amount);
    return isoDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  const monthIndex = unit === 'year' ? (y + amount) * 12 + (m - 1) : y * 12 + (m - 1) + amount;
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  if (year < 1) return '0001-01-01';
  return isoDay(year, month, Math.min(d, daysInMonth(year, month)));
}

function firstDay(d: SimpleDate): string {
  return isoDay(d.year, d.month ?? 1, d.day ?? 1);
}

function lastDay(d: SimpleDate): string {
  const month = d.month ?? 12;
  return isoDay(d.year, month, d.day ?? daysInMonth(d.year, month));
}

const PRECISION_RANK: Record<EdtfPrecision, number> = { day: 0, month: 1, year: 2 };

/** Parses a date in the EDTF subset. Throws {@link EdtfError} if it is not one. */
export function parseEdtf(input: string): ParsedEdtf {
  if (typeof input !== 'string' || input.length === 0) throw new EdtfError(String(input), 'empty');
  if (input !== input.trim()) throw new EdtfError(input, 'leading or trailing spaces');

  if (input.includes('/')) {
    const parts = input.split('/');
    if (parts.length !== 2) throw new EdtfError(input, 'an interval has exactly one "/"');
    const [startText, endText] = parts as [string, string];
    if (startText === '..' && endText === '..') throw new EdtfError(input, 'an interval needs at least one end');
    if (startText === '') throw new EdtfError(input, 'use "../" for an open start');
    if (endText === '') throw new EdtfError(input, 'use "/.." for an open end');
    if (startText === '..') {
      const end = parseSimple(endText, input);
      return { input, form: 'before', qualifier: 'exact', precision: end.precision, earliest: null, latest: lastDay(end) };
    }
    if (endText === '..') {
      const start = parseSimple(startText, input);
      return { input, form: 'after', qualifier: 'exact', precision: start.precision, earliest: firstDay(start), latest: null };
    }
    const start = parseSimple(startText, input);
    const end = parseSimple(endText, input);
    const earliest = firstDay(start);
    const latest = lastDay(end);
    if (earliest > latest) throw new EdtfError(input, 'the interval ends before it starts');
    const precision = PRECISION_RANK[start.precision] >= PRECISION_RANK[end.precision] ? start.precision : end.precision;
    return { input, form: 'between', qualifier: 'exact', precision, earliest, latest };
  }

  const last = input.at(-1);
  if (last === '~' || last === '?') {
    const date = parseSimple(input.slice(0, -1), input);
    if (last === '?') {
      return { input, form: 'uncertain', qualifier: 'uncertain', precision: date.precision, earliest: firstDay(date), latest: lastDay(date) };
    }
    const spread = APPROXIMATE_SPREAD[date.precision];
    return {
      input,
      form: 'about',
      qualifier: 'approximate',
      precision: date.precision,
      earliest: shift(firstDay(date), date.precision, -spread),
      latest: shift(lastDay(date), date.precision, spread),
    };
  }

  const date = parseSimple(input, input);
  return { input, form: date.precision, qualifier: 'exact', precision: date.precision, earliest: firstDay(date), latest: lastDay(date) };
}

export type EdtfResult = { ok: true; value: ParsedEdtf } | { ok: false; error: string };

export function tryParseEdtf(input: string): EdtfResult {
  try {
    return { ok: true, value: parseEdtf(input) };
  } catch (e) {
    if (e instanceof EdtfError) return { ok: false, error: e.message };
    throw e;
  }
}

export function isEdtf(input: string): boolean {
  return tryParseEdtf(input).ok;
}

/** Year of an ISO day, or null. */
export function yearOf(iso: string | null): number | null {
  return iso === null ? null : Number(iso.slice(0, 4));
}

/** Whether the date's possible range overlaps the inclusive year range (either bound may be open). */
export function overlapsYears(parsed: ParsedEdtf, fromYear: number | null, toYear: number | null): boolean {
  const from = fromYear === null ? null : isoDay(fromYear, 1, 1);
  const to = toYear === null ? null : isoDay(toYear, 12, 31);
  const startsBeforeEnd = to === null || parsed.earliest === null || parsed.earliest <= to;
  const endsAfterStart = from === null || parsed.latest === null || parsed.latest >= from;
  return startsBeforeEnd && endsAfterStart;
}

/** Sort key: the earliest day the date could be; open starts and undated sort first. */
export function compareByEarliest(a: ParsedEdtf | null, b: ParsedEdtf | null): number {
  const ka = a?.earliest ?? '';
  const kb = b?.earliest ?? '';
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}
