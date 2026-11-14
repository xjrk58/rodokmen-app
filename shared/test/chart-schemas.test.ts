// The queries of the Chart routes (tree-charts spec; design.md, "The Chart model and its routes").
import { describe, expect, it } from 'vitest';
import { DescendantChartQuery, HouseChartQuery } from '../src/index.js';

const jan = '0192f0c4-7a1e-7c3b-9d2a-000000000001';
const family = '0192f0c4-7a1e-7c3b-9d2a-000000000002';
const petr = '0192f0c4-7a1e-7c3b-9d2a-000000000003';

describe('DescendantChartQuery', () => {
  it('defaults to the tree form of 4 generations, for the screen', () => {
    expect(DescendantChartQuery.parse({ person: jan })).toEqual({ person: jan, generations: 4, form: 'tree' });
    expect(DescendantChartQuery.parse({ family, generations: '8', sheet: 'nameless' })).toEqual({ family, generations: 8, form: 'tree', sheet: 'nameless' });
  });

  it('refuses 1 and 9 generations', () => {
    for (const generations of ['1', '9', '4.5']) expect(DescendantChartQuery.safeParse({ person: jan, generations }).success, generations).toBe(false);
    for (const generations of ['2', '8']) expect(DescendantChartQuery.safeParse({ person: jan, generations }).success, generations).toBe(true);
  });

  it('needs exactly one start: a Person or a Family', () => {
    const both = DescendantChartQuery.safeParse({ person: jan, family });
    expect(both.success).toBe(false);
    expect(both.error?.issues[0]?.message).toBe('give either person or family');
    expect(DescendantChartQuery.safeParse({}).success).toBe(false);
  });

  it('refuses the line form without the end of the Direct line', () => {
    const r = DescendantChartQuery.safeParse({ person: jan, form: 'line' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['line']);
    expect(DescendantChartQuery.parse({ person: jan, form: 'line', line: petr })).toMatchObject({ form: 'line', line: petr });
    // The tree form may name a Direct line to emphasise.
    expect(DescendantChartQuery.parse({ person: jan, line: petr })).toMatchObject({ form: 'tree', line: petr });
  });

  it('knows only the two Sheet variants', () => {
    expect(DescendantChartQuery.safeParse({ person: jan, sheet: 'full' }).success).toBe(false);
  });
});

describe('HouseChartQuery', () => {
  it('hides Unrelated people by default and takes an optional period', () => {
    expect(HouseChartQuery.parse({})).toEqual({ unrelated: 'false' });
    expect(HouseChartQuery.parse({ from: '1790', to: '1850', unrelated: 'true', sheet: 'reduced' })).toEqual({
      from: 1790,
      to: 1850,
      unrelated: 'true',
      sheet: 'reduced',
    });
  });

  it('refuses a period that ends before it starts', () => {
    expect(HouseChartQuery.safeParse({ from: '1850', to: '1790' }).success).toBe(false);
  });
});
