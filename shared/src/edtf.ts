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
 *
 * The day arithmetic behind the table is proved with LemmaScript (ADR 0009,
 * docs/verification.md): every function marked `//@ verify` meets its `//@` specification,
 * checked by `pnpm --filter @rodokmen/shared verify`. That covers the calendar, what a
 * year, month or day covers, how "about" widens, the range of every form and the sort
 * order. Reading the text (regular expressions, error messages) and writing ISO days are
 * not proved; the tests cover them.
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

// ---------------------------------------------------------------- calendar (proleptic Gregorian)
// Days are records of whole numbers so that the prover can reason about them; ISO strings
// are made from them only when a ParsedEdtf is built.

/** A calendar day. It is a real day when {@link isValidDay} holds. */
export interface CalendarDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function isLeapYear(year: number): boolean {
  //@ verify
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  //@ verify
  //@ requires 1 <= month && month <= 12
  //@ ensures 28 <= \result && \result <= 31
  //@ ensures month === 2 ==> \result === (isLeapYear(year) ? 29 : 28)
  //@ ensures (month === 4 || month === 6 || month === 9 || month === 11) ==> \result === 30
  //@ ensures (month === 1 || month === 3 || month === 5 || month === 7 || month === 8 || month === 10 || month === 12) ==> \result === 31
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

/** Whether the record names a day that exists, such as 1804-02-29 but not 1801-02-29. */
function isValidDay(d: CalendarDay): boolean {
  //@ verify
  return 1 <= d.month && d.month <= 12 && 1 <= d.day && d.day <= daysInMonth(d.year, d.month);
}

/**
 * The day as one number that sorts like the calendar: 1801-03-12 is 18010312. For real
 * days the numbers are ordered exactly like the days (year, then month, then day).
 */
function dayNumber(d: CalendarDay): number {
  //@ verify
  return d.year * 10000 + d.month * 100 + d.day;
}

/**
 * Moves a day by whole months, keeping the day of the month where that month has it and
 * otherwise taking the month's last day (31 January + 1 month is 28 or 29 February).
 * Results before year 1 are clamped to 0001-01-01.
 */
function addMonths(d: CalendarDay, months: number): CalendarDay {
  //@ verify
  //@ requires isValidDay(d) && d.year >= 1
  //@ ensures isValidDay(\result) && \result.year >= 1
  //@ ensures months >= 0 ==> dayNumber(\result) >= dayNumber(d)
  //@ ensures months <= 0 ==> dayNumber(\result) <= dayNumber(d)
  //@ ensures d.year * 12 + d.month - 1 + months >= 12 ==> \result.year * 12 + \result.month === d.year * 12 + d.month + months
  const monthIndex = d.year * 12 + (d.month - 1) + months;
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  if (year < 1) return { year: 1, month: 1, day: 1 };
  return { year, month, day: Math.min(d.day, daysInMonth(year, month)) };
}

/** Moves a day by whole days, across month and year ends. */
function addDays(d: CalendarDay, days: number): CalendarDay {
  //@ verify
  //@ requires isValidDay(d)
  //@ ensures isValidDay(\result)
  //@ ensures days >= 0 ==> dayNumber(\result) >= dayNumber(d)
  //@ ensures days <= 0 ==> dayNumber(\result) <= dayNumber(d)
  let year = d.year;
  let month = d.month;
  let day = d.day + days;
  // Backwards: borrow whole months until the day is in its month. Runs only when days < 0.
  while (day < 1) {
    //@ invariant 1 <= month && month <= 12
    //@ invariant days >= 0 ==> year === d.year && month === d.month && day === d.day + days
    //@ invariant days <= 0 ==> day <= daysInMonth(year, month)
    //@ invariant days <= 0 ==> year * 12 + month < d.year * 12 + d.month || (year === d.year && month === d.month && day <= d.day)
    //@ decreases 1 - day
    month = month - 1;
    if (month < 1) {
      month = 12;
      year = year - 1;
    }
    day = day + daysInMonth(year, month);
  }
  // Forwards: carry whole months until the day is in its month. Runs only when days > 0.
  while (day > daysInMonth(year, month)) {
    //@ invariant 1 <= month && month <= 12
    //@ invariant day >= 1
    //@ invariant days <= 0 ==> day <= daysInMonth(year, month)
    //@ invariant days <= 0 ==> year * 12 + month < d.year * 12 + d.month || (year === d.year && month === d.month && day <= d.day)
    //@ invariant days >= 0 ==> year * 12 + month > d.year * 12 + d.month || (year === d.year && month === d.month && day >= d.day)
    //@ decreases day
    day = day - daysInMonth(year, month);
    month = month + 1;
    if (month > 12) {
      month = 1;
      year = year + 1;
    }
  }
  return { year, month, day };
}

// ---------------------------------------------------------------- the range of each form

/** A plain day, month or year: the first and last day it could be. */
interface SimpleDate {
  readonly precision: EdtfPrecision;
  readonly first: CalendarDay;
  readonly last: CalendarDay;
}

/** What the text says, before any day arithmetic. */
type EdtfSyntax =
  | { readonly kind: 'single'; readonly qualifier: EdtfQualifier; readonly date: SimpleDate }
  | { readonly kind: 'between'; readonly start: SimpleDate; readonly end: SimpleDate }
  | { readonly kind: 'before'; readonly end: SimpleDate }
  | { readonly kind: 'after'; readonly start: SimpleDate };

/** The days a date could be: both ends, one end open, or an interval that ends before it starts. */
type EdtfRange =
  | { readonly kind: 'closed'; readonly earliest: CalendarDay; readonly latest: CalendarDay }
  | { readonly kind: 'openStart'; readonly latest: CalendarDay }
  | { readonly kind: 'openEnd'; readonly earliest: CalendarDay }
  | { readonly kind: 'reversed' };

/** `1801` is every day of 1801 and no other. */
function yearDate(year: number): SimpleDate {
  //@ verify
  //@ contract tree-model: Dates allow uncertainty
  //@ ensures \result.precision === 'year'
  //@ ensures isValidDay(\result.first) && isValidDay(\result.last)
  //@ ensures forall(d: CalendarDay, isValidDay(d) ==> ((dayNumber(\result.first) <= dayNumber(d) && dayNumber(d) <= dayNumber(\result.last)) === (d.year === year)))
  return { precision: 'year', first: { year, month: 1, day: 1 }, last: { year, month: 12, day: 31 } };
}

/** `1801-03` is every day of March 1801 and no other. */
function monthDate(year: number, month: number): SimpleDate {
  //@ verify
  //@ contract tree-model: Dates allow uncertainty
  //@ requires 1 <= month && month <= 12
  //@ ensures \result.precision === 'month'
  //@ ensures isValidDay(\result.first) && isValidDay(\result.last)
  //@ ensures forall(d: CalendarDay, isValidDay(d) ==> ((dayNumber(\result.first) <= dayNumber(d) && dayNumber(d) <= dayNumber(\result.last)) === (d.year === year && d.month === month)))
  return { precision: 'month', first: { year, month, day: 1 }, last: { year, month, day: daysInMonth(year, month) } };
}

/** `1801-03-12` is that day and no other. */
function dayDate(day: CalendarDay): SimpleDate {
  //@ verify
  //@ contract tree-model: Dates allow uncertainty
  //@ requires isValidDay(day)
  //@ ensures \result.precision === 'day'
  //@ ensures isValidDay(\result.first) && isValidDay(\result.last)
  //@ ensures forall(d: CalendarDay, isValidDay(d) ==> ((dayNumber(\result.first) <= dayNumber(d) && dayNumber(d) <= dayNumber(\result.last)) === (d.year === day.year && d.month === day.month && d.day === day.day)))
  return { precision: 'day', first: day, last: day };
}

/** How far "about" reaches on each side, per precision: {@link APPROXIMATE_SPREAD}. */
interface Spread {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** "About": the stated range widened on both sides by the spread of its precision. */
function widenAbout(date: SimpleDate, spread: Spread): SimpleDate {
  //@ verify
  //@ contract tree-model: Dates allow uncertainty
  //@ requires isValidDay(date.first) && isValidDay(date.last) && date.first.year >= 1 && date.last.year >= 1
  //@ requires spread.year >= 0 && spread.month >= 0 && spread.day >= 0
  //@ ensures \result.precision === date.precision
  //@ ensures isValidDay(\result.first) && isValidDay(\result.last)
  //@ ensures dayNumber(\result.first) <= dayNumber(date.first) && dayNumber(date.last) <= dayNumber(\result.last)
  if (date.precision === 'day') {
    return { precision: date.precision, first: addDays(date.first, -spread.day), last: addDays(date.last, spread.day) };
  }
  const months = date.precision === 'year' ? spread.year * 12 : spread.month;
  return { precision: date.precision, first: addMonths(date.first, -months), last: addMonths(date.last, months) };
}

/**
 * The days a date could be, for every form in the table above. A closed range never ends
 * before it starts: an interval that would is reported as "reversed" and refused.
 */
function rangeOf(s: EdtfSyntax, spread: Spread): EdtfRange {
  //@ verify
  //@ contract tree-model: Dates allow uncertainty
  //@ requires spread.year >= 0 && spread.month >= 0 && spread.day >= 0
  //@ requires s.kind === 'single' ==> isValidDay(s.date.first) && isValidDay(s.date.last) && s.date.first.year >= 1 && s.date.last.year >= 1 && dayNumber(s.date.first) <= dayNumber(s.date.last)
  //@ requires s.kind === 'between' ==> isValidDay(s.start.first) && isValidDay(s.end.last)
  //@ requires s.kind === 'before' ==> isValidDay(s.end.last)
  //@ requires s.kind === 'after' ==> isValidDay(s.start.first)
  //@ ensures \result.kind === 'closed' ==> isValidDay(\result.earliest) && isValidDay(\result.latest) && dayNumber(\result.earliest) <= dayNumber(\result.latest)
  //@ ensures \result.kind === 'openStart' ==> isValidDay(\result.latest)
  //@ ensures \result.kind === 'openEnd' ==> isValidDay(\result.earliest)
  //@ ensures \result.kind === 'reversed' ==> s.kind === 'between'
  //@ ensures s.kind === 'single' ==> \result.kind === 'closed' && dayNumber(\result.earliest) <= dayNumber(s.date.first) && dayNumber(s.date.last) <= dayNumber(\result.latest)
  //@ ensures s.kind === 'single' && s.qualifier !== 'approximate' ==> \result.kind === 'closed' && \result.earliest === s.date.first && \result.latest === s.date.last
  //@ ensures s.kind === 'between' ==> (\result.kind === 'closed' && \result.earliest === s.start.first && \result.latest === s.end.last) || (\result.kind === 'reversed' && dayNumber(s.start.first) > dayNumber(s.end.last))
  //@ ensures s.kind === 'before' ==> \result.kind === 'openStart' && \result.latest === s.end.last
  //@ ensures s.kind === 'after' ==> \result.kind === 'openEnd' && \result.earliest === s.start.first
  switch (s.kind) {
    case 'single': {
      const date = s.qualifier === 'approximate' ? widenAbout(s.date, spread) : s.date;
      return { kind: 'closed', earliest: date.first, latest: date.last };
    }
    case 'between':
      if (dayNumber(s.start.first) > dayNumber(s.end.last)) return { kind: 'reversed' };
      return { kind: 'closed', earliest: s.start.first, latest: s.end.last };
    case 'before':
      return { kind: 'openStart', latest: s.end.last };
    case 'after':
      return { kind: 'openEnd', earliest: s.start.first };
  }
}

//@ skip
const SIMPLE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

function parseSimple(text: string, input: string): SimpleDate {
  const m = SIMPLE.exec(text);
  if (!m) throw new EdtfError(input, 'expected YYYY, YYYY-MM or YYYY-MM-DD');
  const year = Number(m[1]);
  if (year < 1) throw new EdtfError(input, 'year must be 0001 or later');
  if (m[2] === undefined) return yearDate(year);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new EdtfError(input, `month ${m[2]} does not exist`);
  if (m[3] === undefined) return monthDate(year, month);
  const day = { year, month, day: Number(m[3]) };
  if (!isValidDay(day)) throw new EdtfError(input, `day ${m[3]} does not exist in ${m[1]}-${m[2]}`);
  return dayDate(day);
}

function parseSyntax(input: string): EdtfSyntax {
  if (typeof input !== 'string' || input.length === 0) throw new EdtfError(String(input), 'empty');
  if (input !== input.trim()) throw new EdtfError(input, 'leading or trailing spaces');

  if (input.includes('/')) {
    const parts = input.split('/');
    if (parts.length !== 2) throw new EdtfError(input, 'an interval has exactly one "/"');
    const [startText, endText] = parts as [string, string];
    if (startText === '..' && endText === '..') throw new EdtfError(input, 'an interval needs at least one end');
    if (startText === '') throw new EdtfError(input, 'use "../" for an open start');
    if (endText === '') throw new EdtfError(input, 'use "/.." for an open end');
    if (startText === '..') return { kind: 'before', end: parseSimple(endText, input) };
    if (endText === '..') return { kind: 'after', start: parseSimple(startText, input) };
    const start = parseSimple(startText, input);
    return { kind: 'between', start, end: parseSimple(endText, input) };
  }

  const last = input.at(-1);
  if (last === '~') return { kind: 'single', qualifier: 'approximate', date: parseSimple(input.slice(0, -1), input) };
  if (last === '?') return { kind: 'single', qualifier: 'uncertain', date: parseSimple(input.slice(0, -1), input) };
  return { kind: 'single', qualifier: 'exact', date: parseSimple(input, input) };
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export function isoDay(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function isoOf(d: CalendarDay): string {
  return isoDay(d.year, d.month, d.day);
}

const PRECISION_RANK: Record<EdtfPrecision, number> = { day: 0, month: 1, year: 2 };

function formOf(s: EdtfSyntax): EdtfForm {
  if (s.kind !== 'single') return s.kind;
  if (s.qualifier === 'approximate') return 'about';
  if (s.qualifier === 'uncertain') return 'uncertain';
  return s.date.precision;
}

function precisionOf(s: EdtfSyntax): EdtfPrecision {
  switch (s.kind) {
    case 'single':
      return s.date.precision;
    case 'before':
      return s.end.precision;
    case 'after':
      return s.start.precision;
    case 'between':
      return PRECISION_RANK[s.start.precision] >= PRECISION_RANK[s.end.precision] ? s.start.precision : s.end.precision;
  }
}

/** Parses a date in the EDTF subset. Throws {@link EdtfError} if it is not one. */
export function parseEdtf(input: string): ParsedEdtf {
  const syntax = parseSyntax(input);
  const range = rangeOf(syntax, APPROXIMATE_SPREAD);
  if (range.kind === 'reversed') throw new EdtfError(input, 'the interval ends before it starts');
  return {
    input,
    form: formOf(syntax),
    qualifier: syntax.kind === 'single' ? syntax.qualifier : 'exact',
    precision: precisionOf(syntax),
    earliest: range.kind === 'openStart' ? null : isoOf(range.earliest),
    latest: range.kind === 'openEnd' ? null : isoOf(range.latest),
  };
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
  //@ verify
  //@ contract tree-model: Dates allow uncertainty
  //@ ensures a === null ==> \result <= 0
  //@ ensures a !== null && a.earliest === null ==> \result <= 0
  //@ ensures \result === -compareByEarliest(b, a)
  //@ ensures -1 <= \result && \result <= 1
  const ka = a?.earliest ?? '';
  const kb = b?.earliest ?? '';
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}
