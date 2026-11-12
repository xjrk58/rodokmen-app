import { describe, expect, it } from 'vitest';
import {
  anchorBound,
  dayKey,
  dayText,
  MARRIAGE,
  OWN_BIRTH,
  PARENT_DEATH,
  presumeDeaths,
  presumedDead,
  type BirthAnchor,
  type ParentLink,
  type PresumptionFacts,
} from '../src/presumed-death.js';

/** Presumed death (vault-import spec, "Presumed death when birth is provably long ago"; #132). Invented people only. */
const TODAY = new Date('2026-11-05T12:00:00Z');
/** A day as an integer; a year alone is its last day, as the latest day of the date. */
const day = (iso: string) => {
  const [year = 0, month = 12, d = 31] = iso.split('-').map(Number);
  return dayKey(year, month, d);
};

/** Facts about invented Persons by name: their own facts and their parent links. */
function facts(
  names: string[],
  own: { death?: string[]; birth?: Array<[string, string]>; married?: Array<[string, string]>; parentDied?: Array<[string, string]> },
  parents: Array<[string, string, 'father' | 'mother']> = [],
): PresumptionFacts {
  const at = (name: string) => names.indexOf(name);
  const anchors: BirthAnchor[] = [
    ...(own.birth ?? []).map(([n, d]) => ({ person: at(n), kind: OWN_BIRTH, day: day(d) })),
    ...(own.married ?? []).map(([n, d]) => ({ person: at(n), kind: MARRIAGE, day: day(d) })),
    ...(own.parentDied ?? []).map(([n, d]) => ({ person: at(n), kind: PARENT_DEATH, day: day(d) })),
  ];
  const links: ParentLink[] = parents.map(([parent, child, role]) => ({ parent: at(parent), child: at(child), mother: role === 'mother' }));
  return {
    count: names.length,
    hasDeath: names.map((n) => (own.death ?? []).includes(n)),
    ownBirth: names.map((n) => (own.birth ?? []).some(([b]) => b === n)),
    anchors,
    links,
  };
}
const presumed = (names: string[], f: PresumptionFacts) =>
  Object.fromEntries(presumeDeaths(f, TODAY).presumed.map((p) => [names[p.person]!, dayText(p.chain.values.at(-1)!)]));

describe('presumed death', () => {
  it('married in 1803, no dates of his own: born by 1791-02-10 at the latest, so presumed dead', () => {
    const names = ['Jan Novák'];
    expect(presumed(names, facts(names, { married: [['Jan Novák', '1803-02-10']] }))).toEqual({ 'Jan Novák': '1791-02-10' });
  });

  it('a son born in 1801 tightens his father’s bound to 1789', () => {
    const names = ['Jan Novák', 'Petr Novák'];
    const f = facts(names, { married: [['Jan Novák', '1803-02-10']], birth: [['Petr Novák', '1801-12-31']] }, [['Jan Novák', 'Petr Novák', 'father']]);
    // The son has a birth date of his own: the Living rule decides for him.
    expect(presumed(names, f)).toEqual({ 'Jan Novák': '1789-12-31' });
  });

  it('married in 1925: born by 1913, within 125 years, so left alone and Living', () => {
    const names = ['Anna Nováková'];
    expect(presumed(names, facts(names, { married: [['Anna Nováková', '1925-06-01']] }))).toEqual({});
  });

  it('no dates and no relatives: left alone', () => {
    expect(presumed(['Nikdo'], facts(['Nikdo'], {}))).toEqual({});
  });

  it('a recorded death, or a birth date of one’s own, decides alone', () => {
    const names = ['Dead', 'Born'];
    const f = facts(names, {
      death: ['Dead'],
      married: [
        ['Dead', '1800-01-01'],
        ['Born', '1800-01-01'],
      ],
      birth: [['Born', '1990']],
    });
    expect(presumed(names, f)).toEqual({});
  });

  it('a child is born at most a year after a parent’s death, and at most 60 years after the mother', () => {
    const names = ['Mother', 'Child', 'Orphan'];
    const f = facts(names, { married: [['Mother', '1840-05-05']], parentDied: [['Orphan', '1890-03-01']] }, [['Mother', 'Child', 'mother']]);
    expect(presumed(names, f)).toEqual({ Mother: '1828-05-05', Child: '1888-05-05', Orphan: '1891-03-01' });
  });

  it('a father’s bound does not pass to his children: only a mother’s does', () => {
    const names = ['Father', 'Child'];
    const f = facts(names, { married: [['Father', '1860-05-05']] }, [['Father', 'Child', 'father']]);
    expect(presumed(names, f)).toEqual({ Father: '1848-05-05' });
  });

  it('the cutoff is exclusive: born by exactly 125 years before the run is not enough', () => {
    const names = ['Edge', 'Before'];
    const f = facts(names, {
      married: [
        ['Edge', '1913-11-05'],
        ['Before', '1913-11-04'],
      ],
    });
    expect(presumed(names, f)).toEqual({ Before: '1901-11-04' });
  });

  it('29 February: a bound in a common year admits the days up to 28 February', () => {
    expect(anchorBound({ person: 0, kind: MARRIAGE, day: day('1804-02-29') })).toBe(day('1792-02-29'));
    expect(dayText(day('1805-02-29'))).toBe('1805-02-28');
    expect(dayText(day('1804-02-29'))).toBe('1804-02-29');
  });

  it('parent links that go round in a circle do not settle, and nothing rests on them', () => {
    const names = ['A', 'B'];
    const f = facts(names, { married: [['A', '1950-01-01']] }, [
      ['A', 'B', 'father'],
      ['B', 'A', 'father'],
    ]);
    const result = presumeDeaths(f, TODAY);
    expect(result.settled).toBe(false);
    expect(result.presumed).toEqual([]);
  });

  it('the proved check refuses a chain whose step does not follow, or that ends elsewhere', () => {
    const anchors: BirthAnchor[] = [{ person: 0, kind: MARRIAGE, day: day('1803-02-10') }];
    const links: ParentLink[] = [{ parent: 1, child: 0, mother: false }];
    const good = { persons: [0, 1], values: [day('1791-02-10'), day('1779-02-10')], rules: [0, 0] };
    const tooTight = { persons: [0, 1], values: [day('1791-02-10'), day('1778-02-10')], rules: [0, 0] };
    const cutoff = day('1901-11-05');
    const run = (chain: typeof good) =>
      presumedDead(2, [false, false], [false, false], anchors, links, [{ persons: [], values: [], rules: [] }, chain], cutoff);
    expect(run(good)).toEqual([false, true]);
    expect(run(tooTight)).toEqual([false, false]);
    expect(run({ ...good, persons: [0, 0] })).toEqual([false, false]);
  });
});
