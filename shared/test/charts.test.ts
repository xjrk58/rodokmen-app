// The proved rules of a Descendant chart (shared/src/charts.ts), on the spec's scenarios. The
// proofs cover every input; these cases show the rules do what the scenarios say.
import { describe, expect, it } from 'vitest';
import { compareChildren, compareFamilies, cutToSize, diedYoung, directLine, selectDescendants, type ChildEdge } from '../src/charts.js';

const child = (dated: boolean, day: number, recorded: number, id: string) => ({ dated, day, recorded, id });

describe('compareChildren and compareFamilies (Order within a Chart)', () => {
  it('"Undated child": baptised 1801, 1804, and one undated come in that order', () => {
    const kids = [child(false, 0, 1, 'c'), child(true, 18040101, 3, 'b'), child(true, 18010101, 2, 'a')];
    expect(kids.sort(compareChildren).map((k) => k.id)).toEqual(['a', 'b', 'c']);
  });

  it('"A range of years": 1803/1805 (from 1 January 1803) before 1 June 1804', () => {
    expect(compareChildren(child(true, 18030101, 2, 'x'), child(true, 18040601, 1, 'y'))).toBe(-1);
  });

  it('"Twins": the same day, in the order the Family records them, every time', () => {
    const a = child(true, 18300302, 2, '0002');
    const b = child(true, 18300302, 1, '0009');
    expect(compareChildren(a, b)).toBe(1);
    expect(compareChildren(b, a)).toBe(-1);
    // And by id, in code units, when even the recorded order is the same.
    expect(compareChildren(child(true, 1, 1, 'B'), child(true, 1, 1, 'a'))).toBe(-1);
  });

  it('orders Families by the marriage, undated last, then by id', () => {
    const fams = [
      { dated: false, day: 0, id: 'f1' },
      { dated: true, day: 18370515, id: 'f2' },
      { dated: true, day: 18250207, id: 'f3' },
    ];
    expect(fams.sort(compareFamilies).map((f) => f.id)).toEqual(['f3', 'f2', 'f1']);
  });
});

describe('diedYoung (Marks on cards)', () => {
  it('"Died young": born 2 March 1830, died 10 May 1832', () => {
    expect(diedYoung(true, 1830, 3, 2, true, 18320510)).toBe(true);
  });

  it('"Not certain": born about 1830, died between 1840 and 1850', () => {
    expect(diedYoung(true, 1828, 1, 1, true, 18501231)).toBe(false);
  });

  it('born on 29 February: 15 on 1 March of a year without 29 February', () => {
    expect(diedYoung(true, 1832, 2, 29, true, 18470228)).toBe(true);
    expect(diedYoung(true, 1832, 2, 29, true, 18470301)).toBe(false);
    // In a leap year the birthday is the day itself.
    expect(diedYoung(true, 1836, 2, 29, true, 18510228)).toBe(true);
    expect(diedYoung(true, 1836, 2, 29, true, 18510229)).toBe(false);
  });

  it('no mark without both dates', () => {
    expect(diedYoung(false, 0, 0, 0, true, 18000101)).toBe(false);
    expect(diedYoung(true, 1830, 1, 1, false, 0)).toBe(false);
  });
});

// Persons 0 … 9: 0 Jan, 1 Terezie, 2 Ludmila, 3 Karel, 4 Anna, 5 Antonín, 6 Václav (adopted), 7 Tomáš (step),
// 8 Karel's son, 9 Václav's son, 10 Tomáš's son. Families 0 Jan+Terezie, 1 Jan+Ludmila, 2 Karel, 3 Václav, 4 Tomáš.
const edge = (family: number, a: number, b: number, c: number, followed = true): ChildEdge => ({ family, a, b, child: c, followed });
const EDGES = [
  edge(0, 0, 1, 3),
  edge(0, 0, 1, 4),
  edge(1, 0, 2, 5),
  edge(1, 0, 2, 6),
  edge(1, 0, 2, 7, false),
  edge(2, 3, -1, 8),
  edge(3, 6, -1, 9),
  edge(4, 7, -1, 10),
];
const only = (n: number, ...starts: number[]) => Array.from({ length: n }, (_, i) => starts.includes(i));

describe('selectDescendants (Descendant chart)', () => {
  it('"Second marriage" and "Adopted and step children": both Families, the adopted child followed, the step child not', () => {
    const s = selectDescendants(11, only(11, 0), -1, EDGES, 3);
    expect(s.gen).toEqual([1, 0, 0, 2, 2, 2, 2, 0, 3, 3, 0]);
    expect(s.parent[9]).toBe(6);
    expect(s.via[9]).toBe(6);
  });

  it('"From a couple": 3 generations from the Family of Jan and Terezie hold no great-grandchildren, nor Ludmila\'s children', () => {
    const deeper = [...EDGES, edge(5, 8, -1, 11)];
    const s = selectDescendants(12, only(12, 0, 1), 0, deeper, 3);
    expect(s.gen).toEqual([1, 1, 0, 2, 2, 0, 0, 0, 3, 0, 0, 0]);
  });

  it('"Descended in two ways": a child of two descendants is selected once, at the smaller generation', () => {
    // 3 (gen 2) and 9 (gen 3) have a child 11 together; 11 is generation 3 through 3.
    const s = selectDescendants(12, only(12, 0), -1, [...EDGES, edge(6, 3, 9, 11)], 6);
    expect(s.gen[11]).toBe(3);
    expect(s.parent[11]).toBe(3);
  });
});

describe('directLine (Direct line)', () => {
  it('"Line to the Member": from the start down to the end, one link per generation', () => {
    const line = directLine(11, EDGES, 0, -1, 9, 12);
    expect(line.persons).toEqual([0, 6, 9]);
    expect(line.via).toEqual([3, 6]);
  });

  it('"Not a descendant": no line to a step child\'s son, nor to anyone beyond 12 generations', () => {
    expect(directLine(11, EDGES, 0, -1, 10, 12).persons).toEqual([]);
    expect(directLine(11, EDGES, 0, -1, 9, 2).persons).toEqual([]);
  });

  it('"Two ways down": the way that comes first in the Chart\'s order', () => {
    // 11 is a child of 8 (through 3) and of 9 (through 6): through 3 comes first.
    const edges = [...EDGES, edge(5, 8, -1, 11), edge(6, 9, -1, 11)];
    expect(directLine(12, edges, 0, -1, 11, 12).persons).toEqual([0, 3, 8, 11]);
    // Unless that way is too long for the line.
    const longer = [...EDGES, edge(5, 8, -1, 12), edge(7, 12, -1, 11), edge(6, 9, -1, 11)];
    expect(directLine(13, longer, 0, -1, 11, 4).persons).toEqual([0, 6, 9, 11]);
  });
});

describe('cutToSize (Size of a Chart)', () => {
  it('"A large family": 700 cards in 6 generations, 380 in the first 4: keeps 4 and counts each one\'s descendants left out', () => {
    // A chain of generations: 1 start, 3 children, each with descendants; the cards are given per generation.
    const gen = [1, 2, 2, 3, 4, 4, 5, 5, 6, 6, 6];
    const parent = [-1, 0, 0, 1, 3, 3, 4, 5, 6, 6, 7];
    const cut = cutToSize(gen.length, gen, parent, [10, 70, 100, 200, 160, 160], 500);
    expect(cut.kept).toBe(4);
    expect(cut.total).toBe(5);
    expect(cut.leftOut[4]).toBe(3);
    expect(cut.leftOut[5]).toBe(2);
    expect(cut.leftOut.filter((n, i) => n > 0 && gen[i] !== 4)).toEqual([]);
    expect(cut.leftOut.reduce((a, b) => a + b, 0)).toBe(cut.total);
  });

  it('keeps every generation asked for when they fit, and 2 when even 2 do not', () => {
    expect(cutToSize(1, [1], [-1], [1, 100, 100, 100], 500).kept).toBe(4);
    expect(cutToSize(1, [1], [-1], [1, 600, 10], 500).kept).toBe(2);
  });
});
