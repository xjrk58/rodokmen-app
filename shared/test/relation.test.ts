import { describe, expect, it } from 'vitest';
import {
  isConfirming,
  isStrongLink,
  parseRelationFilter,
  POSSIBLE,
  reachFrom,
  RELATIVE,
  relationLevels,
  relationsOf,
  UNRELATED,
  type FamilyLinkById,
} from '../src/index.js';

// Invented Persons: a couple of Family roots, their son and grandson, the grandson's wife,
// a man linked by a weak father link, and a godparent from the same village.
const link = (a: string, b: string, ...confidences: string[]): FamilyLinkById => ({ a, b, confidences });

describe('the relation rule (tree-model spec, "Relation to the family is computed")', () => {
  const persons = ['vaclav', 'dorota', 'josef', 'karel', 'anna', 'tomas', 'godmother'];
  const roots = ['vaclav', 'dorota'];
  const tree = [
    link('vaclav', 'dorota', 'high'), // their marriage
    link('vaclav', 'josef', 'normal'), // parent links from the son's baptism
    link('dorota', 'josef', 'normal'),
    link('josef', 'karel', 'very_high'), // the grandson
  ];

  it('first Family roots: the roots are Relatives, and so is everyone reached from them through confirmed links', () => {
    const r = relationsOf(persons, roots, tree);
    expect(r.get('vaclav')).toBe('relative');
    expect(r.get('dorota')).toBe('relative');
    expect(r.get('karel')).toBe('relative');
  });

  it("linked through a confirmed marriage: the wife of a root's grandson, marriage Citation of high confidence, is a Relative", () => {
    expect(relationsOf(persons, roots, [...tree, link('karel', 'anna', 'high')]).get('anna')).toBe('relative');
  });

  it('only a weak link: a man linked only through a father link whose single Citation has low confidence is a Possible relative', () => {
    const r = relationsOf(persons, roots, [...tree, link('karel', 'tomas', 'low')]);
    expect(r.get('tomas')).toBe('possible');
    // and so is everyone reached only through him
    expect(
      relationsOf([...persons, 'tomas-son'], roots, [...tree, link('karel', 'tomas', 'low'), link('tomas', 'tomas-son', 'very_high')]).get('tomas-son'),
    ).toBe('possible');
  });

  it('a link without any Citation is weak', () => {
    expect(relationsOf(persons, roots, [...tree, link('karel', 'tomas')]).get('tomas')).toBe('possible');
  });

  it('godparent from the same village: a Person who appears only as godparent at a family baptism is an Unrelated person', () => {
    // A Role at an Event is no Family link, so the godmother has no link at all.
    expect(relationsOf(persons, roots, tree).get('godmother')).toBe('unrelated');
  });

  it('evidence improves: the weak father link gets a second Citation of high confidence, and he becomes a Relative', () => {
    expect(relationsOf(persons, roots, [...tree, link('karel', 'tomas', 'low')]).get('tomas')).toBe('possible');
    expect(relationsOf(persons, roots, [...tree, link('karel', 'tomas', 'low', 'high')]).get('tomas')).toBe('relative');
  });

  it('a weaker chain does not hide a confirmed one: a Person reached both ways is a Relative', () => {
    const r = relationsOf(persons, roots, [...tree, link('vaclav', 'anna', 'very_low'), link('josef', 'anna', 'normal')]);
    expect(r.get('anna')).toBe('relative');
  });

  it('cycles: links that loop back (a cousin marriage, pedigree collapse) end the search and change nothing', () => {
    const loop = [
      ...tree,
      link('karel', 'anna', 'high'),
      link('anna', 'josef', 'low'),
      link('anna', 'karel', 'low'),
      link('tomas', 'godmother', 'low'),
      link('godmother', 'tomas', 'high'),
    ];
    const r = relationsOf(persons, roots, loop);
    expect(r.get('anna')).toBe('relative');
    // a separate loop with no Family root stays unrelated
    expect(r.get('tomas')).toBe('unrelated');
    expect(r.get('godmother')).toBe('unrelated');
  });

  it('several roots: each research line is reached from its own root', () => {
    const r = relationsOf(['a', 'b', 'c', 'd', 'e'], ['a', 'd'], [link('a', 'b', 'normal'), link('d', 'e', 'low'), link('b', 'c', 'very_low')]);
    expect([...r.values()]).toEqual(['relative', 'relative', 'possible', 'relative', 'possible']);
  });

  it('no Family roots yet: everyone is an Unrelated person', () => {
    const r = relationsOf(persons, [], tree);
    expect(new Set(r.values())).toEqual(new Set(['unrelated']));
  });

  it('a root marked again or links to unknown Persons change nothing', () => {
    const r = relationsOf(['a', 'b'], ['a', 'a', 'gone'], [link('a', 'b', 'high'), link('b', 'gone', 'high'), link('a', 'a', 'low')]);
    expect([...r.values()]).toEqual(['relative', 'relative']);
  });

  it('follows links in both directions, in any order', () => {
    // A long chain listed from its far end: the search goes over the links until nothing changes.
    const chain = Array.from({ length: 30 }, (_, i) => link(`p${i + 1}`, `p${i}`, 'normal')).reverse();
    const ids = Array.from({ length: 31 }, (_, i) => `p${i}`);
    expect(new Set(relationsOf(ids, ['p30'], chain).values())).toEqual(new Set(['relative']));
  });
});

describe('the parts of the rule', () => {
  it('normal, high and very high confidence confirm a link; low and very low do not', () => {
    expect(['very_low', 'low', 'normal', 'high', 'very_high'].map(isConfirming)).toEqual([false, false, true, true, true]);
    expect(isStrongLink({ a: 0, b: 1, confidences: ['low', 'very_low'] })).toBe(false);
    expect(isStrongLink({ a: 0, b: 1, confidences: ['low', 'normal'] })).toBe(true);
  });

  it('a search says through which link and in which order it reached each Person', () => {
    const r = reachFrom(
      3,
      [true, false, false],
      [
        { a: 1, b: 2, confidences: ['high'] },
        { a: 0, b: 1, confidences: ['high'] },
      ],
      true,
    );
    expect(r.reached).toEqual([true, true, true]);
    expect(r.via).toEqual([-1, 1, 0]);
    expect(r.order[0]).toBeLessThan(r.order[1]!);
    expect(r.order[1]).toBeLessThan(r.order[2]!);
  });

  it('levels: Relative 2, Possible relative 1, Unrelated person 0', () => {
    expect(relationLevels(3, [true, false, false], [{ a: 0, b: 1, confidences: ['low'] }])).toEqual([RELATIVE, POSSIBLE, UNRELATED]);
  });

  it('the relation filter of search and the map: any combination, unknown words left out', () => {
    expect(parseRelationFilter(undefined)).toBeNull();
    expect(parseRelationFilter('relative,possible')).toEqual(['relative', 'possible']);
    expect(parseRelationFilter('unrelated,unrelated,cousin')).toEqual(['unrelated']);
  });
});
