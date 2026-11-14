// The House chart: its proved rules (shared/src/house-chart.ts) and its model from rows
// (shared/src/house-chart-model.ts) on an invented House, with the scenarios of the tree-charts
// spec and golden models.
import { describe, expect, it } from 'vitest';
import { compareRows, familyAt, HouseChart, houseChart, houseRows, placesAtHouse, succession, type HouseOptions } from '../src/index.js';
import { shuffled } from './chart-fixture.js';
import { golden } from './golden.js';
import { H, HF, houseRowsFixture, oldHouseRows } from './house-fixture.js';

const options = (o: Partial<HouseOptions> = {}): HouseOptions => ({ from: null, to: null, unrelated: false, sheet: null, ...o });

describe('the proved rules', () => {
  it('"Godmother from next door": a godparent, witness, priest or informant places nobody', () => {
    for (const role of ['godparent', 'witness', 'priest', 'informant'])
      for (const type of ['baptism', 'residence', 'burial']) expect(placesAtHouse(type, role)).toBe(false);
    expect(placesAtHouse('baptism', 'mother')).toBe(true);
    expect(placesAtHouse('marriage', 'partner')).toBe(true);
    expect(placesAtHouse('census', 'other')).toBe(true);
  });

  it('an Event belongs to the latest Family whose marriage is not known to be later', () => {
    // Married 1825 and 1840 (the second undated works as not later): an Event in 1830 belongs to the first.
    expect(familyAt([true, true], [18250101, 18400101], false, 18301231)).toBe(0);
    expect(familyAt([true, false], [18250101, 0], false, 18301231)).toBe(1);
    expect(familyAt([true], [18500101], false, 18301231)).toBe(-1);
  });

  it('periods run from the earliest to the latest day of the placing Events', () => {
    const p = (row: number, role: string, earliest: number, latest: number) => ({
      row,
      type: 'baptism',
      role,
      dated: true,
      openStart: false,
      openEnd: false,
      earliest,
      latest,
    });
    const rows = houseRows(2, [
      p(0, 'child', 17950402, 17950402),
      p(0, 'godparent', 17000101, 19000101),
      p(0, 'mother', 18100815, 18100815),
      p(1, 'witness', 1, 2),
    ]);
    expect([rows.earliest[0], rows.latest[0]]).toEqual([17950402, 18100815]);
    // A row placed only by a witness is no row.
    expect(rows.by[1]).toBe(-1);
  });

  it('rows order by their first day, undated last, then by key', () => {
    expect(compareRows({ dated: true, day: 17950402, key: 'b' }, { dated: true, day: 18250110, key: 'a' })).toBe(-1);
    expect(compareRows({ dated: false, day: 0, key: 'a' }, { dated: true, day: 18250110, key: 'b' })).toBe(1);
  });

  it('succession: son, daughter, married in, remarriage, none', () => {
    // Rows: 0 parents (0, 1); 1 son 2 with wife 3; 2 daughter 4 of row 1 with 5 from elsewhere; 3 widow 4 with 6; 4 newcomers 7, 8.
    const s = succession(
      [0, 2, 5, 6, 7],
      [1, 3, 4, 4, 8],
      ['male', 'female', 'male', 'female', 'female', 'male', 'male', 'male', 'female'],
      [
        { child: 2, row: 0 },
        { child: 4, row: 1 },
      ],
    );
    expect(s.kind).toEqual([0, 1, 2, 4, 0]);
    expect(s.from).toEqual([-1, 0, 1, 2, -1]);
    expect(s.through).toEqual([-1, 2, 4, 4, -1]);
    expect(s.marriedIn).toEqual([-1, 3, 5, -1, -1]);
  });
});

describe('houseChart', () => {
  it('matches the golden models: the House, with Unrelated people, and as a Sheet', () => {
    for (const [name, o] of [
      ['house-a', {}],
      ['house-a-unrelated', { unrelated: true }],
      ['house-a-sheet', { sheet: 'reduced' as const, unrelated: true }],
    ] as const) {
      const model = houseChart(houseRowsFixture(), options(o));
      expect(HouseChart.safeParse(model).success, name).toBe(true);
      golden(name, model);
    }
  });

  it('"Records in another order": the same rows shuffled give the same model', () => {
    for (const o of [{}, { unrelated: true }, { sheet: 'reduced' as const }]) {
      const model = houseChart(houseRowsFixture(), options(o));
      for (const seed of [1, 2, 3]) expect(houseChart({ ...shuffled(houseRowsFixture(), seed), house: houseRowsFixture().house }, options(o))).toEqual(model);
    }
  });

  it('"Two generations", "Son takes over" and "Godmother from next door"', () => {
    const model = houseChart(houseRowsFixture(), options());
    expect(model.rows.map((r) => r.key)).toEqual([HF.parents, HF.jan, HF.anna, HF.widow, HF.lukas]);
    expect(model.rows[0]).toMatchObject({ earliest: '1795-04-02', latest: '1810-08-15' });
    expect(model.rows[1]).toMatchObject({ earliest: '1825-01-10', latest: '1850-11-05', link: { kind: 'son', rowKey: HF.parents, personId: H.jan } });
    expect(model.persons.map((p) => p.id)).not.toContain(H.godmother);
  });

  it('"Renumbered House": each row shows the numbers of its own period', () => {
    const model = houseChart(houseRowsFixture(), options());
    expect(model.house.numbers).toEqual([
      { number: '12', from: null, to: '1805' },
      { number: '15', from: '1806', to: null },
    ]);
    expect(model.rows[0]!.numbers).toEqual(['12', '15']);
    expect(model.rows[1]!.numbers).toEqual(['15']);
  });

  it('"Son-in-law marries in", "Widow remarries" and "A new family"', () => {
    const model = houseChart(houseRowsFixture(), options({ unrelated: true }));
    const row = (key: string) => model.rows.find((r) => r.key === key)!;
    expect(row(HF.anna)).toMatchObject({ link: { kind: 'daughter', rowKey: HF.jan, personId: H.anna }, marriedIn: H.josefDvorak });
    expect(row(HF.widow)).toMatchObject({ link: { kind: 'remarriage', rowKey: HF.anna, personId: H.anna }, marriedIn: null });
    expect(row(HF.lodgers)).toMatchObject({ link: { kind: 'none', rowKey: null, personId: null } });
  });

  it('"Unrelated lodgers" and "Overlapping periods"', () => {
    const hidden = houseChart(houseRowsFixture(), options());
    expect(hidden.rows.map((r) => r.key)).not.toContain(HF.lodgers);
    expect(hidden.hiddenUnrelated).toBe(1);
    const shown = houseChart(houseRowsFixture(), options({ unrelated: true }));
    const lodgers = shown.rows.find((r) => r.key === HF.lodgers)!;
    expect(lodgers).toMatchObject({ unrelated: true, earliest: '1832-02-02' });
    // Its period lies inside Jan's row's; both appear, and neither row says who held the House.
    expect(shown.rows.map((r) => r.key).indexOf(HF.lodgers)).toBe(2);
    expect(JSON.stringify(shown)).not.toMatch(/holder/i);
  });

  it('a Sheet leaves out the Events Living people took part in, and the rows they alone placed', () => {
    const sheet = houseChart(houseRowsFixture(), options({ sheet: 'reduced' }));
    expect(sheet.rows.map((r) => r.key)).not.toContain(HF.lukas);
    expect(sheet.persons.find((p) => p.id === H.petr)).toBeUndefined();
  });

  it('"An old House": 95 rows over 300 years ask for a period, and show the rows of the period chosen', () => {
    const asked = houseChart(oldHouseRows(), options());
    expect(asked).toMatchObject({ needsPeriod: true, total: 95, rows: [], firstYear: 1650, lastYear: 1932 });
    const period = houseChart(oldHouseRows(), options({ from: 1700, to: 1760 }));
    expect(period.needsPeriod).toBe(false);
    expect(period.rows).toHaveLength(20);
    expect(period.rows[0]!.earliest).toBe('1701-01-01');
  });
});
