import { describe, expect, it } from 'vitest';
import {
  ACROSS,
  ADOPTIVE_LINK,
  BIRTH,
  BIRTH_LINK,
  CO_PARENT_IN_LAW,
  COLLATERAL,
  DIRECT,
  DOWN,
  FOSTER,
  FOSTER_LINK,
  MARRIAGE,
  NO_DEGREE,
  NO_LINE,
  PARTNER,
  SELF,
  STEP_LINK,
  STEP_SIBLING,
  UP,
  chainsUp,
  closestPath,
  compareKinshipPaths,
  connectionChain,
  isHalf,
  isPossiblePath,
  kinshipDegree,
  kinshipLine,
  namesOwnParentOrChild,
  type ParentLink,
  type PathKey,
} from '../src/kinship.js';

// The proved rules of kinship.ts, scenario by scenario (kinship spec). Persons are indexes.
const link = (child: number, parent: number, type = BIRTH_LINK, couple = 0): ParentLink => ({ child, parent, type, couple });

describe('line and degree (kinship spec, "Line and degree of kinship by birth" and "by marriage")', () => {
  it.each([
    ['great-grandfather', BIRTH, 3, 0, 3, DIRECT],
    ['sibling', BIRTH, 1, 1, 2, COLLATERAL],
    ['uncle', BIRTH, 2, 1, 3, COLLATERAL],
    ['first cousin', BIRTH, 2, 2, 4, COLLATERAL],
    ['first cousin once removed', BIRTH, 2, 3, 5, COLLATERAL],
    ['brother-in-law', MARRIAGE, 1, 1, 2, COLLATERAL],
    ['daughter-in-law', MARRIAGE, 0, 1, 1, DIRECT],
  ])('%s: degree %#', (_name, kind, up, down, degree, line) => {
    expect(kinshipDegree(kind, up, down)).toBe(degree);
    expect(kinshipLine(kind, up, down)).toBe(line);
  });

  it('wife, step-sibling, co-parent-in-law, foster and the reader have no line or degree', () => {
    for (const kind of [SELF, PARTNER, STEP_SIBLING, CO_PARENT_IN_LAW, FOSTER]) {
      expect(kinshipDegree(kind, 1, 1)).toBe(NO_DEGREE);
      expect(kinshipLine(kind, 1, 1)).toBe(NO_LINE);
    }
  });
});

describe('chains up (kinship spec, "Kinship is computed from Family links")', () => {
  it('follows birth and adoptive links only, at the fewest generations, through a collapsed pedigree', () => {
    // 0's parents are 1 and 2; both are children of 3 (cousins married: 3 is reached twice); 4 is a step parent of 0.
    const links = [link(0, 1), link(0, 2), link(1, 3), link(2, 5, ADOPTIVE_LINK), link(5, 3), link(0, 4, STEP_LINK), link(0, 6, FOSTER_LINK)];
    const c = chainsUp(7, 0, links);
    expect(c.dist).toEqual([0, 1, 1, 2, -1, 2, -1]);
    expect(links[c.via[3]!]!.child).toBe(1);
  });

  it('stops 12 generations up', () => {
    const links = Array.from({ length: 14 }, (_, i) => link(i, i + 1));
    const c = chainsUp(15, 0, links);
    expect(c.dist[12]).toBe(12);
    expect(c.dist[13]).toBe(-1);
  });

  it('godparent: a Role at an Event is no input, so a Person with no Family link is not reached', () => {
    expect(chainsUp(3, 0, [link(0, 1)]).dist[2]).toBe(-1);
  });
});

describe('the closest path (kinship spec, "Paths in a fixed order")', () => {
  it('two cousinships: of a second and a third cousin, the second is the closest, its chains meeting only at the top', () => {
    // 0 and 9 are second cousins through 4 (0-1-2-4, 9-8-7-4) and third cousins through 6 (0-1-3-5-6, 9-8-10-11-6).
    const links = [link(0, 1), link(1, 2), link(2, 4), link(9, 8), link(8, 7), link(7, 4), link(1, 3), link(3, 5), link(5, 6), link(8, 10), link(10, 11), link(11, 6)];
    const c = closestPath(12, 0, 9, links);
    expect(c.found).toBe(true);
    expect(c.top).toBe(4);
    expect(c.toFrom.persons).toEqual([4, 2, 1, 0]);
    expect(c.toTo.persons).toEqual([4, 7, 8, 9]);
  });

  it('the direct line: an ancestor is the common ancestor', () => {
    const c = closestPath(3, 0, 2, [link(0, 1), link(1, 2)]);
    expect([c.top, c.toFrom.links.length, c.toTo.links.length]).toEqual([2, 2, 0]);
  });

  it('none: no common ancestor within the limits', () => {
    expect(closestPath(3, 0, 2, [link(0, 1)]).found).toBe(false);
  });
});

describe('the order of paths (kinship spec, "Paths in a fixed order")', () => {
  const key = (kind: number, degree: number, up: number, down: number, persons: number[], possible = false): PathKey => ({ kind, degree, possible, up, down, persons });

  it('brother-in-law and cousin: the brother-in-law (2nd degree) before the third cousin (8th)', () => {
    expect(compareKinshipPaths(key(MARRIAGE, 2, 1, 1, [0, 1, 2]), key(BIRTH, 8, 4, 4, [0, 3, 4, 5, 6, 7, 8, 9, 2]))).toBe(-1);
  });

  it('by birth before by marriage at the same degree, confirmed before possible, the reader and partners first', () => {
    expect(compareKinshipPaths(key(BIRTH, 2, 1, 1, [0, 1, 2]), key(MARRIAGE, 2, 1, 1, [0, 3, 2]))).toBe(-1);
    expect(compareKinshipPaths(key(BIRTH, 4, 2, 2, [0, 1, 2, 3, 4], true), key(BIRTH, 4, 2, 2, [0, 5, 6, 7, 4]))).toBe(1);
    expect(compareKinshipPaths(key(PARTNER, NO_DEGREE, 0, 0, [0, 1]), key(BIRTH, 1, 0, 1, [0, 1]))).toBe(-1);
    expect(compareKinshipPaths(key(BIRTH, 9, 5, 4, [0]), key(STEP_SIBLING, NO_DEGREE, 1, 1, [0, 1, 2, 3]))).toBe(-1);
  });

  it('equal paths: the Persons decide, antisymmetrically, and only the same path is 0', () => {
    const a = key(BIRTH, 4, 2, 2, [0, 1, 2, 3, 4]);
    const b = key(BIRTH, 4, 2, 2, [0, 5, 2, 6, 4]);
    expect(compareKinshipPaths(a, b)).toBe(-1);
    expect(compareKinshipPaths(b, a)).toBe(1);
    expect(compareKinshipPaths(a, { ...a, persons: [...a.persons] })).toBe(0);
  });
});

describe('evidence (kinship spec, "Kinship follows the evidence")', () => {
  it('weak father link, and evidence improves', () => {
    const strong = { a: 0, b: 1, confidences: ['high'] };
    expect(isPossiblePath([strong, { a: 1, b: 2, confidences: ['low'] }])).toBe(true);
    expect(isPossiblePath([strong, { a: 1, b: 2, confidences: [] }])).toBe(true);
    expect(isPossiblePath([strong, { a: 1, b: 2, confidences: ['low', 'high'] }])).toBe(false);
  });
});

describe('half, step and foster (kinship spec, "Half, step, adoptive and foster kinship")', () => {
  it('half-brother: one common ancestor through two couples; the direct line is never half', () => {
    expect(isHalf(1, 1, 3, 4)).toBe(true);
    expect(isHalf(1, 1, 3, 3)).toBe(false);
    expect(isHalf(2, 0, 3, -1)).toBe(false);
  });

  it('own child, not a stepchild; stepmother kept', () => {
    expect(namesOwnParentOrChild([{ dir: ACROSS, couple: 5 }, { dir: DOWN, couple: 5 }])).toBe(true);
    expect(namesOwnParentOrChild([{ dir: UP, couple: 5 }, { dir: ACROSS, couple: 6 }])).toBe(false);
    expect(namesOwnParentOrChild([{ dir: UP, couple: 5 }, { dir: ACROSS, couple: 5 }])).toBe(true);
  });
});

describe('the connection chain (kinship spec, "Limits of the kinship search")', () => {
  it('through two marriages: the shortest chain of any Family links', () => {
    const links = [
      { a: 0, b: 1, confidences: [] },
      { a: 1, b: 2, confidences: [] },
      { a: 2, b: 3, confidences: [] },
      { a: 3, b: 4, confidences: [] },
      { a: 0, b: 4, confidences: [] },
    ];
    const c = connectionChain(5, 0, 3, links);
    expect(c.found).toBe(true);
    expect(c.persons).toEqual([0, 4, 3]);
  });

  it('no chain: nothing listed, and the reach of the Person leaves the reader out', () => {
    const c = connectionChain(4, 0, 3, [{ a: 0, b: 1, confidences: [] }, { a: 2, b: 3, confidences: [] }]);
    expect(c.found).toBe(false);
    expect(c.persons).toEqual([]);
    expect(c.reached).toEqual([false, false, true, true]);
  });
});
