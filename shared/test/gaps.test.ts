import { describe, expect, it } from 'vitest';
import { gapKey, suggestGaps, type GapMarriage, type GapPerson, type Register } from '../src/gaps.js';

/** A Relative born about 1801 (1799–1803) in a Place of the Parish "horni", with no baptism Citation. */
const jan: GapPerson = {
  personId: 'jan',
  relative: true,
  birthCited: false,
  parentsKnown: true,
  datesKnown: true,
  from: 1799,
  to: 1803,
  parishIds: ['horni'],
};
const births: Register = { sourceId: 'n-horni', parishId: 'horni', kind: 'birth', from: 1784, to: 1820 };
const marriages: Register = { sourceId: 'o-horni', parishId: 'horni', kind: 'marriage', from: 1784, to: 1850 };
const deaths: Register = { sourceId: 'z-horni', parishId: 'horni', kind: 'death', from: 1784, to: 1850 };
const otherParish: Register = { sourceId: 'n-dolni', parishId: 'dolni', kind: 'birth', from: 1700, to: 1900 };
const MARGIN = 1;

const run = (persons: GapPerson[], weddings: GapMarriage[] = [], registers: Register[] = [births, marriages, deaths, otherParish], decided: string[] = []) =>
  suggestGaps(persons, weddings, registers, decided, MARGIN).map((s) => ({
    kind: s.kind,
    subjectId: s.subjectId,
    sourceId: s.sourceId,
    from: s.from,
    to: s.to,
    key: s.key,
  }));

describe('the gap finder (research-leads: Gap finder suggests leads)', () => {
  it('missing baptism: names the Parish’s birth register and the years 1798–1804', () => {
    expect(run([jan])).toEqual([{ kind: 'birth', subjectId: 'jan', sourceId: 'n-horni', from: 1798, to: 1804, key: 'birth:jan:n-horni' }]);
  });

  it('keeps to the years the register covers', () => {
    const late = { ...births, from: 1802, to: 1830 };
    expect(run([jan], [], [late])).toEqual([{ kind: 'birth', subjectId: 'jan', sourceId: 'n-horni', from: 1802, to: 1804, key: 'birth:jan:n-horni' }]);
    // A register whose years miss the birth does not fit; the gap is suggested on its own.
    const after = { ...births, from: 1810, to: 1830 };
    expect(run([jan], [], [after])).toEqual([{ kind: 'birth', subjectId: 'jan', sourceId: '', from: 1798, to: 1804, key: 'birth:jan:' }]);
  });

  it('a birth Citation, or not being a Relative, means no suggestion', () => {
    expect(run([{ ...jan, birthCited: true }])).toEqual([]);
    expect(run([{ ...jan, relative: false }])).toEqual([]);
  });

  it('without the Parish or the years, the missing baptism is suggested without a register', () => {
    expect(run([{ ...jan, parishIds: [] }])).toEqual([{ kind: 'birth', subjectId: 'jan', sourceId: '', from: 1798, to: 1804, key: 'birth:jan:' }]);
    expect(run([{ ...jan, datesKnown: false, from: 0, to: 0 }])).toEqual([
      { kind: 'birth', subjectId: 'jan', sourceId: '', from: 0, to: 0, key: 'birth:jan:' },
    ]);
  });

  it('unknown parents with a known Parish and years: the birth register, which names them', () => {
    const anna = { ...jan, personId: 'anna', birthCited: true, parentsKnown: false };
    expect(run([anna])).toEqual([{ kind: 'parents', subjectId: 'anna', sourceId: 'n-horni', from: 1798, to: 1804, key: 'parents:anna:n-horni' }]);
    // Without the Parish or the years it is no gap of this kind.
    expect(run([{ ...anna, parishIds: [] }])).toEqual([]);
    expect(run([{ ...anna, datesKnown: false }])).toEqual([]);
  });

  it('a marriage without a Citation: the Parish’s marriage register', () => {
    const wedding: GapMarriage = { familyId: 'fam', relative: true, cited: false, datesKnown: true, from: 1825, to: 1825, parishIds: ['horni'] };
    expect(run([], [wedding])).toEqual([{ kind: 'marriage', subjectId: 'fam', sourceId: 'o-horni', from: 1824, to: 1826, key: 'marriage:fam:o-horni' }]);
    expect(run([], [{ ...wedding, cited: true }])).toEqual([]);
    expect(run([], [{ ...wedding, relative: false }])).toEqual([]);
    expect(run([], [{ ...wedding, datesKnown: false, parishIds: [] }])).toEqual([
      { kind: 'marriage', subjectId: 'fam', sourceId: '', from: 0, to: 0, key: 'marriage:fam:' },
    ]);
  });

  it('dismissed suggestion: the same lead is not suggested again, other registers still are', () => {
    const second = { ...births, sourceId: 'n-horni-index' };
    expect(run([jan], [], [births, second]).map((s) => s.key)).toEqual(['birth:jan:n-horni', 'birth:jan:n-horni-index']);
    expect(run([jan], [], [births, second], [gapKey('birth', 'jan', 'n-horni')]).map((s) => s.key)).toEqual(['birth:jan:n-horni-index']);
    // Dismissing the gap on its own does not bring it back while registers fit, nor the other way round.
    expect(run([jan], [], [births], [gapKey('birth', 'jan', 'n-horni')])).toEqual([]);
    expect(run([{ ...jan, parishIds: [] }], [], [births], [gapKey('birth', 'jan', '')])).toEqual([]);
  });
});
