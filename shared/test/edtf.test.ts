import { describe, expect, it } from 'vitest';
import { compareByEarliest, EdtfDate, isEdtf, overlapsYears, parseEdtf, tryParseEdtf } from '../src/index.js';

/**
 * Every form the tree-model spec lists ("Dates allow uncertainty"), with the earliest and
 * latest days the parser derives. The same table is in the header of src/edtf.ts.
 */
const EXAMPLES: Array<[input: string, form: string, earliest: string | null, latest: string | null]> = [
  ['1801-03-12', 'day', '1801-03-12', '1801-03-12'],
  ['1801-03', 'month', '1801-03-01', '1801-03-31'],
  ['1800-02', 'month', '1800-02-01', '1800-02-28'],
  ['1804-02', 'month', '1804-02-01', '1804-02-29'],
  ['1801', 'year', '1801-01-01', '1801-12-31'],
  ['1801~', 'about', '1799-01-01', '1803-12-31'],
  ['1801-05~', 'about', '1801-04-01', '1801-06-30'],
  ['1801-01~', 'about', '1800-12-01', '1801-02-28'],
  ['1801-03-12~', 'about', '1801-03-05', '1801-03-19'],
  ['1801?', 'uncertain', '1801-01-01', '1801-12-31'],
  ['1801-03-12?', 'uncertain', '1801-03-12', '1801-03-12'],
  ['1801/1803', 'between', '1801-01-01', '1803-12-31'],
  ['1801-03/1801-05-10', 'between', '1801-03-01', '1801-05-10'],
  ['../1805', 'before', null, '1805-12-31'],
  ['../1805-06', 'before', null, '1805-06-30'],
  ['1790/..', 'after', '1790-01-01', null],
  ['1790-04-02/..', 'after', '1790-04-02', null],
];

describe('EDTF subset parser', () => {
  it.each(EXAMPLES)('%s is %s from %s to %s', (input, form, earliest, latest) => {
    const parsed = parseEdtf(input);
    expect(parsed.input).toBe(input);
    expect(parsed.form).toBe(form);
    expect(parsed.earliest).toBe(earliest);
    expect(parsed.latest).toBe(latest);
  });

  it.each([
    '',
    ' 1801',
    '1801 ',
    '180',
    '18011',
    '1801-13',
    '1801-00',
    '1801-02-29',
    '1800-02-29',
    '1801-04-31',
    '1801-3-1',
    '0000',
    '1801~?',
    '1801%',
    '~1801',
    '1803/1801',
    '../..',
    '/1805',
    '1790/',
    '1801~/1803',
    '1801/1802/1803',
    'about 1801',
    '12.3.1801',
  ])('refuses %j', (input) => {
    expect(isEdtf(input)).toBe(false);
    expect(() => parseEdtf(input)).toThrow(/EDTF subset/);
  });

  it('accepts 29 February in leap years only', () => {
    expect(isEdtf('1804-02-29')).toBe(true);
    expect(isEdtf('2000-02-29')).toBe(true);
    expect(isEdtf('1900-02-29')).toBe(false);
  });

  it('keeps "1801~" and "../1805" as written and makes both sortable and filterable by year', () => {
    const about = parseEdtf('1801~');
    const before = parseEdtf('../1805');
    expect([about.input, before.input]).toEqual(['1801~', '../1805']);
    // Ordered by the earliest date each could be: an open start sorts first.
    expect([about, before].sort(compareByEarliest).map((d) => d.input)).toEqual(['../1805', '1801~']);
    expect(overlapsYears(about, 1800, 1802)).toBe(true);
    expect(overlapsYears(about, 1810, 1820)).toBe(false);
    expect(overlapsYears(before, 1800, 1810)).toBe(true);
    expect(overlapsYears(before, 1806, 1810)).toBe(false);
    expect(overlapsYears(parseEdtf('1790/..'), 1840, 1850)).toBe(true);
    expect(overlapsYears(parseEdtf('1790/..'), 1700, 1789)).toBe(false);
  });

  it('gives a readable error', () => {
    const result = tryParseEdtf('1801-13');
    expect(result).toEqual({ ok: false, error: '"1801-13" is not a date in the EDTF subset: month 13 does not exist' });
  });

  it('is exposed as a Zod schema', () => {
    expect(EdtfDate.safeParse('1801~').success).toBe(true);
    const bad = EdtfDate.safeParse('1801-02-30');
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toMatch(/day 30 does not exist/);
  });
});
