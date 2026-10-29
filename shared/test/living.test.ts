import { describe, expect, it } from 'vitest';
import { isLiving, livingCutoff, livingFactsFromEvents } from '../src/index.js';

const TODAY = new Date('2026-10-29T12:00:00Z');

describe('Living rule', () => {
  it('no dates at all: a Person with no birth and no death Event is Living', () => {
    expect(isLiving({ birthDates: [], deathRecorded: false }, TODAY)).toBe(true);
  });

  it('born more than 100 years ago: born 1920, no recorded death, current year 2026 → not Living', () => {
    expect(isLiving({ birthDates: ['1920'], deathRecorded: false }, TODAY)).toBe(false);
  });

  it('born less than 100 years ago: born 1950, no recorded death → Living', () => {
    expect(isLiving({ birthDates: ['1950'], deathRecorded: false }, TODAY)).toBe(true);
  });

  it('a recorded death means not Living, even when undated or recent', () => {
    expect(isLiving({ birthDates: [], deathRecorded: true }, TODAY)).toBe(false);
    expect(isLiving({ birthDates: ['1990'], deathRecorded: true }, TODAY)).toBe(false);
  });

  it('decides on the latest day the birth could be', () => {
    expect(livingCutoff(TODAY)).toBe('1926-10-29');
    expect(isLiving({ birthDates: ['1926-10-28'], deathRecorded: false }, TODAY)).toBe(false);
    expect(isLiving({ birthDates: ['1926-10-29'], deathRecorded: false }, TODAY)).toBe(true);
    // "about 1925" could be as late as 1927.
    expect(isLiving({ birthDates: ['1925~'], deathRecorded: false }, TODAY)).toBe(true);
    expect(isLiving({ birthDates: ['../1900'], deathRecorded: false }, TODAY)).toBe(false);
    // Open towards today, or undated: could be recent.
    expect(isLiving({ birthDates: ['1900/..'], deathRecorded: false }, TODAY)).toBe(true);
    expect(isLiving({ birthDates: [null], deathRecorded: false }, TODAY)).toBe(true);
  });

  it('the most constraining birth evidence wins (a baptism bounds the birth)', () => {
    expect(isLiving({ birthDates: [null, '1880'], deathRecorded: false }, TODAY)).toBe(false);
    expect(isLiving({ birthDates: ['1900/..', '1901'], deathRecorded: false }, TODAY)).toBe(false);
  });

  it('collects facts from Events by type and Role', () => {
    const facts = livingFactsFromEvents([
      { type: 'baptism', role: 'child', date: '1801-03-12' },
      { type: 'baptism', role: 'godparent', date: '1830' },
      { type: 'birth', role: 'mother', date: '1832' },
      { type: 'burial', role: 'priest', date: '1840' },
    ]);
    expect(facts).toEqual({ birthDates: ['1801-03-12'], deathRecorded: false });
    expect(livingFactsFromEvents([{ type: 'burial', role: 'deceased', date: null }]).deathRecorded).toBe(true);
  });
});
