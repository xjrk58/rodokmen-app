// The Descendant chart's model from rows (shared/src/charts-model.ts) on the invented Novák
// family: golden models, rows in another order, and the card scenarios of the tree-charts spec.
// The golden files change only with UPDATE_GOLDEN=1, so that a change shows in the PR's diff.
import { describe, expect, it } from 'vitest';
import { DescendantChart, descendantChart, NotADescendant, type ChartPerson, type DescendantOptions } from '../src/index.js';
import { F, novakRows, P, shuffled } from './chart-fixture.js';
import { golden } from './golden.js';

const options = (o: Partial<DescendantOptions>): DescendantOptions => ({
  start: { personId: P.jan },
  generations: 4,
  form: 'tree',
  line: null,
  sheet: null,
  ...o,
});
const card = (model: DescendantChart, id: string): ChartPerson => model.persons.find((p) => p.id === id)!;

describe('descendantChart', () => {
  it('matches the golden models: the tree form, from a couple, the line form, and both Sheets', () => {
    const cases: Array<[string, Partial<DescendantOptions>]> = [
      ['novak-tree-4', {}],
      ['novak-couple-3', { start: { familyId: F.janKaterina }, generations: 3 }],
      ['novak-line', { form: 'line', line: P.petr, generations: 4 }],
      ['novak-tree-reduced', { generations: 6, sheet: 'reduced' }],
      ['novak-tree-nameless', { generations: 6, sheet: 'nameless' }],
    ];
    for (const [name, o] of cases) {
      const model = descendantChart(novakRows(), options(o));
      expect(DescendantChart.safeParse(model).success, name).toBe(true);
      golden(name, model);
    }
  });

  it('"Records in another order": the same rows shuffled give the same model', () => {
    for (const o of [{}, { generations: 6, line: P.petr }, { form: 'line' as const, line: P.martin }, { sheet: 'reduced' as const, generations: 6 }]) {
      const model = descendantChart(novakRows(), options(o));
      for (const seed of [1, 2, 3]) expect(descendantChart(shuffled(novakRows(), seed), options(o))).toEqual(model);
    }
  });

  it('"Second marriage" and "Adopted and step children": both Families, earlier first; the step child shown, not followed', () => {
    const model = descendantChart(novakRows(), options({}));
    const jan = model.nodes[0]!;
    expect(jan.families.map((f) => f.familyId)).toEqual([F.janKaterina, F.janLudmila]);
    const second = jan.families[1]!;
    const kids = second.children.map((key) => model.nodes.find((n) => n.key === key)!);
    // Ludmila's children: Václav (1836), Tomáš (1830, a step child: shown, not followed), Antonín (1838/1840).
    expect(kids.map((k) => [k.personId, k.followed])).toEqual([
      [P.tomas, false],
      [P.vaclav, true],
      [P.antonin, true],
    ]);
    const links = model.families.find((f) => f.id === F.janLudmila)!.children;
    expect(links.find((c) => c.personId === P.vaclav)?.linkType).toBe('adoptive');
    expect(links.find((c) => c.personId === P.tomas)?.linkType).toBe('step');
  });

  it('"Undated child": the child with no recorded birth comes after the dated ones', () => {
    const model = descendantChart(novakRows(), options({}));
    const first = model.nodes[0]!.families[0]!;
    expect(first.children).toEqual([P.karel, P.anna, P.josef]);
  });

  it('"Descended in two ways": the cousins\' Family and its descendants appear once, the other place points to it', () => {
    const model = descendantChart(novakRows(), options({ generations: 6 }));
    expect(model.nodes.filter((n) => n.personId === P.lukas && !n.pointer)).toHaveLength(1);
    const places = model.nodes.flatMap((n) => n.families.filter((f) => f.familyId === F.bohumilEva).map((f) => ({ by: n.personId, pointer: f.pointer })));
    expect(places).toEqual([
      { by: P.bohumil, pointer: false },
      { by: P.eva, pointer: true },
    ]);
  });

  it('"Not a descendant": a Direct line to the step child is refused', () => {
    expect(() => descendantChart(novakRows(), options({ line: P.tomas }))).toThrow(NotADescendant);
  });

  it('the Direct line in the tree form is marked as far as the Chart reaches, and says when it goes deeper', () => {
    const model = descendantChart(novakRows(), options({ generations: 3, line: P.petr }));
    expect(model.line).toEqual([P.jan, P.karel, P.bohumil, P.lukas, P.petr]);
    expect(model.nodes.filter((n) => n.onLine).map((n) => n.personId)).toEqual([P.jan, P.karel, P.bohumil]);
    expect(model.lineBeyond).toBe(true);
  });

  it('"Line to the Member": the line form has a row per generation, the line couple\'s children and the siblings\' Families', () => {
    const model = descendantChart(novakRows(), options({ form: 'line', line: P.petr }));
    expect(model.rows.map((r) => r.personId)).toEqual([P.jan, P.karel, P.bohumil, P.lukas, P.petr]);
    expect(model.rows[0]!.nextId).toBe(P.karel);
    expect(model.rows[0]!.children.map((c) => c.personId)).toEqual([P.karel, P.anna, P.josef]);
    expect(model.rows[3]!.familyId).toBe(F.lukasRuzena);
    expect(model.rows[3]!.children.map((c) => c.personId)).toEqual([P.petr, P.martin]);
  });

  it('"Married name" and "Nothing recorded but the Name"', () => {
    const model = descendantChart(novakRows(), options({}));
    expect(card(model, P.marie)).toMatchObject({ given: 'Marie', surname: 'Nováková', birthSurname: 'Dvořáková' });
    expect(card(model, P.josef)).toMatchObject({ born: null, died: null, birthYear: null, diedYoung: false });
  });

  it('"Renumbered House", "Only a baptism" and "Died young" on the cards', () => {
    const model = descendantChart(novakRows(), options({}));
    const jan = card(model, P.jan);
    expect(jan.born).toMatchObject({ type: 'baptism', date: '1801-03-12', place: 'Kamenná Lhota', houseNumber: '12' });
    expect(jan.died).toMatchObject({ type: 'death', houseNumber: '15' });
    expect(card(model, P.anna).diedYoung).toBe(true);
    expect(card(model, P.karel).diedYoung).toBe(false);
  });

  it('"Living grandchild" on screen and on a Sheet, and "Names left off"', () => {
    const screen = card(descendantChart(novakRows(), options({ generations: 6 })), P.petr);
    expect(screen).toMatchObject({ given: 'Petr', living: true, birthYear: 2010, reduced: false, born: { date: '2010-05-03', houseNumber: '15' } });
    const sheet = card(descendantChart(novakRows(), options({ generations: 6, sheet: 'reduced' })), P.petr);
    expect(sheet).toEqual({
      id: P.petr,
      sex: 'male',
      given: 'Petr',
      surname: 'Novák',
      birthSurname: null,
      living: true,
      relation: 'relative',
      familyRoot: false,
      born: null,
      died: null,
      birthYear: 2010,
      diedYoung: false,
      reduced: true,
      nameless: false,
    });
    const nameless = card(descendantChart(novakRows(), options({ generations: 6, sheet: 'nameless' })), P.petr);
    expect(nameless).toMatchObject({ given: '', surname: '', birthYear: null, born: null, reduced: true, nameless: true });
  });

  it('a Sheet leaves out the marriage of a Living partner and the Sources cited only for Living people', () => {
    const screen = descendantChart(novakRows(), options({ generations: 6 }));
    const sheet = descendantChart(novakRows(), options({ generations: 6, sheet: 'reduced' }));
    expect(screen.families.find((f) => f.id === F.lukasRuzena)?.marriage).not.toBeNull();
    expect(sheet.families.find((f) => f.id === F.lukasRuzena)?.marriage).toBeNull();
    // The census is cited for Václav's birth (shown) and Petr's (left out on the Sheet).
    expect(screen.sources.map((s) => s.title)).toEqual(['Matrika N Kamenná Lhota 1784–1850', 'Sčítání lidu 1869']);
    expect(sheet.sources.map((s) => s.title)).toEqual(['Matrika N Kamenná Lhota 1784–1850', 'Sčítání lidu 1869']);
    const withoutVaclav = novakRows();
    const rows = { ...withoutVaclav, events: withoutVaclav.events.filter((e) => !e.roles.some((r) => r.personId === P.vaclav)) };
    expect(descendantChart(rows, options({ generations: 6, sheet: 'reduced' })).sources.map((s) => s.title)).toEqual(['Matrika N Kamenná Lhota 1784–1850']);
  });

  it('"Weak link": the Possible relative is marked and the link to him is dotted', () => {
    const model = descendantChart(novakRows(), options({}));
    expect(card(model, P.bohumil).relation).toBe('possible');
    expect(model.families.find((f) => f.id === F.karelMarie)?.children[0]).toEqual({ personId: P.bohumil, linkType: 'birth', weakLink: true });
  });
});
