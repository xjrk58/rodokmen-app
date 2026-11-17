// The queries of the Chart routes (tree-charts spec; design.md, "The Chart model and its routes"),
// and the two variants of the model: kinship on the screen's cards only (add-kinship task 8.1).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DescendantChart,
  DescendantChartQuery,
  DescendantChartScreen,
  DescendantChartSheet,
  HouseChart,
  HouseChartQuery,
  HouseChartSheet,
  type KinshipShort,
} from '../src/index.js';

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'charts');

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

describe('kinship on Chart cards (tree-charts spec, "Kinship on Chart cards")', () => {
  const golden = (name: string): unknown => JSON.parse(readFileSync(join(GOLDEN, `${name}.json`), 'utf8'));
  const kinship: KinshipShort = {
    kind: 'birth',
    term: { cs: { text: 'děd', gender: 'm' }, en: { text: 'grandfather', gender: 'm' } },
    possible: false,
    line: 'direct',
    degree: 2,
    others: 0,
    more: false,
  };

  it('takes kinship=1 on the screen variant of both Charts, and refuses it with sheet', () => {
    expect(DescendantChartQuery.parse({ person: jan, kinship: '1' })).toMatchObject({ kinship: '1' });
    expect(HouseChartQuery.parse({ kinship: '1' })).toMatchObject({ kinship: '1' });
    for (const sheet of ['reduced', 'nameless']) {
      const d = DescendantChartQuery.safeParse({ person: jan, sheet, kinship: '1' });
      expect(d.success, sheet).toBe(false);
      expect(d.error?.issues[0]?.path).toEqual(['kinship']);
      expect(HouseChartQuery.safeParse({ sheet, kinship: '1' }).success, sheet).toBe(false);
    }
    expect(DescendantChartQuery.safeParse({ person: jan, kinship: 'true' }).success).toBe(false);
  });

  it('has no kinship field in the Sheet variant: a Sheet with one fails its schema, the screen variant takes it', () => {
    expect(Object.keys(DescendantChartSheet.shape.persons.element.shape)).not.toContain('kinship');
    expect(Object.keys(HouseChartSheet.shape.persons.element.shape)).not.toContain('kinship');
    expect(Object.keys(DescendantChartScreen.shape.persons.element.shape)).toContain('kinship');
    for (const name of ['novak-tree-reduced', 'novak-tree-nameless']) {
      const sheet = DescendantChart.parse(golden(name));
      expect(sheet.sheet, name).not.toBeNull();
      expect(DescendantChart.safeParse({ ...sheet, persons: sheet.persons.map((p) => ({ ...p, kinship })) }).success, name).toBe(false);
    }
    const house = HouseChart.parse(golden('house-a-sheet'));
    expect(HouseChart.safeParse({ ...house, persons: house.persons.map((p) => ({ ...p, kinship: null })) }).success).toBe(false);
    const screen = DescendantChart.parse(golden('novak-tree-4'));
    const withKinship = DescendantChart.parse({ ...screen, persons: screen.persons.map((p) => ({ ...p, kinship })) });
    expect(withKinship.persons[0]).toMatchObject({ kinship });
  });
});
