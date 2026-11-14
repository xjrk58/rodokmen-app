import { describe, expect, it } from 'vitest';
import { FULL_BOUND, MAX_PATHS, SHORT_BOUND, type KinshipData, type KinshipPathOut } from '../src/index.js';
import { kin, lattice, seeded, short, Tree } from './kinship-tree.js';

// Every path of kinship on invented Trees (kinship spec). The reader is karel unless said otherwise.
const cs = (p: KinshipPathOut | undefined) => p?.term.cs.text;
const en = (p: KinshipPathOut | undefined) => p?.term.en.text;
const people = (p: KinshipPathOut) => p.steps.map((s) => s.person);

/** Karel, his parents, grandparents and great-grandparents on the father's side, his sister and his mother's brother. */
function family(): Tree {
  const t = new Tree();
  t.people(['karel', 'male'], ['petr', 'male'], ['eva', 'female'], ['josef', 'male'], ['ruzena', 'female'], ['jan', 'male'], ['dorota', 'female']);
  t.people(['jana', 'female'], ['tomas', 'male'], ['emil', 'male'], ['vera', 'female']);
  t.couple('f-jan', 'jan', 'dorota', 'josef');
  t.couple('f-josef', 'josef', 'ruzena', 'petr');
  t.couple('f-petr', 'petr', 'eva', 'karel', 'jana');
  t.couple('f-emil', 'emil', 'vera', 'eva', 'tomas');
  return t;
}

describe('kinship to the reader (kinship spec, "Kinship to the Member\'s own Person")', () => {
  it('great-grandfather: the father of his father\'s father, in the direct line, of the 3rd degree', () => {
    const [p] = kin(family().data, 'karel', 'jan').paths;
    expect([p!.kind, p!.line, p!.degree, cs(p), en(p)]).toEqual(['birth', 'direct', 3, 'praděd', 'great-grandfather']);
    expect(p!.commonAncestors).toEqual(['jan']);
  });

  it('their own page: the reader, with no line or degree', () => {
    const [p] = kin(family().data, 'karel', 'karel').paths;
    expect([p!.kind, p!.line, p!.degree, cs(p), en(p)]).toEqual(['self', null, null, 'vy', 'you']);
  });

  it('full siblings: one path, both parents its common ancestors; sibling of the 2nd degree', () => {
    const r = kin(family().data, 'karel', 'jana');
    expect(r.paths).toHaveLength(1);
    expect([r.paths[0]!.line, r.paths[0]!.degree, cs(r.paths[0]), r.paths[0]!.half]).toEqual(['collateral', 2, 'sestra', false]);
    expect(r.paths[0]!.commonAncestors).toEqual(['eva', 'petr']);
  });

  it('uncle: a brother of the mother, collateral, 3rd degree', () => {
    const [p] = kin(family().data, 'karel', 'tomas').paths;
    expect([p!.line, p!.degree, cs(p), en(p)]).toEqual(['collateral', 3, 'strýc', 'uncle']);
  });

  it('first cousin and once removed: 4th and 5th degree', () => {
    const t = family();
    t.people(['marie', 'female'], ['lida', 'female'], ['ota', 'male'], ['vit', 'male']);
    t.couple('f-tomas', 'tomas', 'lida', 'marie');
    t.couple('f-marie', 'ota', 'marie', 'vit');
    expect(kin(t.data, 'karel', 'marie').paths.map((p) => [p.degree, cs(p), en(p)])).toEqual([[4, 'sestřenice', 'first cousin']]);
    expect(kin(t.data, 'karel', 'vit').paths.map((p) => [p.degree, cs(p), en(p)])).toEqual([[5, 'synovec z 2. kolena', 'first cousin once removed']]);
  });

  it('godparent: a Person with no Family link has no kinship and no chain', () => {
    const t = family();
    t.person('kmotr');
    const r = kin(t.data, 'karel', 'kmotr');
    expect([r.paths, r.connection]).toEqual([[], null]);
  });
});

describe('kinship by marriage (kinship spec, "Line and degree of kinship by marriage", "Kinship terms by marriage")', () => {
  function married(): Tree {
    const t = family();
    t.people(['alena', 'female'], ['bohus', 'male'], ['hana', 'female'], ['ivan', 'male'], ['syn', 'male'], ['snacha', 'female']);
    t.couple('f-hana', 'bohus', 'hana', 'alena', 'ivan');
    t.couple('f-karel', 'karel', 'alena', 'syn');
    t.family('f-syn', 'syn', 'snacha');
    return t;
  }

  it('wife: named as his wife, with no line or degree', () => {
    const [p] = kin(married().data, 'karel', 'alena').paths;
    expect([p!.kind, p!.line, p!.degree, cs(p), en(p)]).toEqual(['partner', null, null, 'manželka', 'wife']);
  });

  it('partner without a recorded marriage: partnerka', () => {
    const t = married();
    t.data.families.find((f) => f.id === 'f-karel')!.married = false;
    expect(cs(kin(t.data, 'karel', 'alena').paths[0])).toBe('partnerka');
  });

  it('brother-in-law: the wife\'s brother, by marriage, collateral, 2nd degree', () => {
    const [p] = kin(married().data, 'karel', 'ivan').paths;
    expect([p!.kind, p!.line, p!.degree, cs(p), en(p)]).toEqual(['marriage', 'collateral', 2, 'švagr', 'brother-in-law']);
    expect(people(p!)).toEqual(['alena', 'bohus', 'ivan']);
  });

  it('daughter-in-law and parents-in-law', () => {
    const [p] = kin(married().data, 'karel', 'snacha').paths;
    expect([p!.kind, p!.line, p!.degree, cs(p), en(p)]).toEqual(['marriage', 'direct', 1, 'snacha', 'daughter-in-law']);
    expect(cs(kin(married().data, 'karel', 'bohus').paths[0])).toBe('tchán');
    expect(cs(kin(married().data, 'karel', 'hana').paths[0])).toBe('tchyně');
  });

  it('own child, not a stepchild: the son of the reader and his wife has one path, by birth', () => {
    expect(kin(married().data, 'karel', 'syn').paths.map((p) => [p.kind, cs(p)])).toEqual([['birth', 'syn']]);
  });

  it('married into the family further away: the husband of a first cousin', () => {
    const t = married();
    t.people(['marie', 'female'], ['lida', 'female'], ['ota', 'male']);
    t.couple('f-tomas', 'tomas', 'lida', 'marie');
    t.family('f-marie', 'ota', 'marie');
    const [p] = kin(t.data, 'karel', 'ota').paths;
    expect([p!.kind, p!.line, p!.degree, cs(p), en(p)]).toEqual(['marriage', 'collateral', 4, 'sešvagřený', 'related by marriage']);
    expect(people(p!)).toContain('marie');
  });

  it('through two marriages: no kinship, a chain with 2 partner links', () => {
    const t = married();
    t.people(['marta', 'female'], ['bedrich', 'male'], ['dusan', 'male'], ['otec', 'male']);
    t.couple('f-hana', 'bohus', 'hana', 'marta');
    t.couple('f-bedrich-parents', 'otec', null, 'bedrich', 'dusan');
    t.family('f-marta', 'bedrich', 'marta');
    const r = kin(t.data, 'karel', 'dusan');
    expect(r.paths).toEqual([]);
    expect(r.connection!.marriages).toBe(2);
    expect(r.connection!.steps.map((s) => s.person)).toEqual(['alena', 'bohus', 'marta', 'bedrich', 'otec', 'dusan']);
  });
});

describe('half, step, adoptive and foster kinship (kinship spec)', () => {
  it('half-brother: a son of the father and his second wife', () => {
    const t = family();
    t.people(['zdena', 'female'], ['pavel', 'male']);
    t.couple('f-petr-2', 'petr', 'zdena', 'pavel');
    const [p] = kin(t.data, 'karel', 'pavel').paths;
    expect([p!.half, p!.degree, cs(p), en(p)]).toEqual([true, 2, 'polorodý bratr', 'half-brother']);
    expect(p!.commonAncestors).toEqual(['petr']);
    // The stepmother: the father's second wife, not his mother.
    const [m] = kin(t.data, 'karel', 'zdena').paths;
    expect([m!.kind, m!.line, m!.degree, cs(m), en(m)]).toEqual(['marriage', 'direct', 1, 'nevlastní matka', 'stepmother']);
  });

  it('one couple recorded as two Families: their children are full siblings', () => {
    const t = family();
    t.person('ludek');
    t.couple('f-petr-again', 'petr', 'eva', 'ludek');
    const [p] = kin(t.data, 'karel', 'ludek').paths;
    expect([p!.half, cs(p)]).toEqual([false, 'bratr']);
  });

  it('through adoption: a birth son of a daughter the reader adopted', () => {
    const t = new Tree();
    t.people(['karel', 'male'], ['alena', 'female'], ['dcera', 'female'], ['zet', 'male'], ['vnuk', 'male']);
    t.family('f-karel', 'karel', 'alena');
    t.child('f-karel', 'dcera', { type: 'adoptive' });
    t.couple('f-dcera', 'zet', 'dcera', 'vnuk');
    const [p] = kin(t.data, 'karel', 'vnuk').paths;
    expect([p!.line, p!.degree, p!.adoptive, cs(p), en(p)]).toEqual(['direct', 2, true, 'vnuk (přes osvojení)', 'grandson (through adoption)']);
    expect(cs(kin(t.data, 'karel', 'dcera').paths[0])).toBe('adoptivní dcera');
  });

  it('foster child of the grandparents: no kinship through the foster link, only a chain', () => {
    const t = family();
    t.person('svereny');
    t.child('f-josef', 'svereny', { type: 'foster' });
    const r = kin(t.data, 'karel', 'svereny');
    expect(r.paths).toEqual([]);
    expect(r.connection?.marriages).toBe(0);
    // Between the foster parent and the child the link names its own pair.
    expect(cs(kin(t.data, 'josef', 'svereny').paths[0])).toBe('svěřený syn');
    expect(cs(kin(t.data, 'svereny', 'ruzena').paths[0])).toBe('pěstounka');
  });

  it('a step child link names a stepchild of the partner who is not a parent by birth', () => {
    const t = family();
    t.person('nevlastni');
    t.child('f-petr', 'nevlastni', { type: 'step' });
    expect(kin(t.data, 'petr', 'nevlastni').paths.map((p) => [p.kind, p.degree, cs(p)])).toEqual([['marriage', 1, 'nevlastní syn']]);
    expect(kin(t.data, 'nevlastni', 'eva').paths.map((p) => cs(p))).toEqual(['nevlastní matka']);
  });

  it('step-siblings and co-parents-in-law are named', () => {
    const t = family();
    t.people(['zdena', 'female'], ['jiri', 'male'], ['olga', 'female'], ['syn', 'male'], ['snacha', 'female'], ['svat', 'male']);
    // Petr's second wife Zdena has a daughter Olga with Jiří: Olga is Karel's stepsister.
    t.family('f-petr-2', 'petr', 'zdena');
    t.couple('f-zdena', 'jiri', 'zdena', 'olga');
    expect(kin(t.data, 'karel', 'olga').paths.map((p) => [p.kind, p.degree, cs(p), en(p)])).toEqual([
      ['stepSibling', null, 'nevlastní sestra', 'stepsister'],
    ]);
    // Karel's son married Svat's daughter: Svat is Karel's svat.
    t.family('f-karel', 'karel', null);
    t.child('f-karel', 'syn');
    t.couple('f-svat', 'svat', null, 'snacha');
    t.family('f-syn', 'syn', 'snacha');
    expect(kin(t.data, 'karel', 'svat').paths.map((p) => [p.kind, cs(p), en(p)])).toEqual([['coParentInLaw', 'svat', 'co-father-in-law']]);
  });
});

describe('several paths and their order (kinship spec, "Kinship along several paths", "Paths in a fixed order")', () => {
  /** Second cousins: great-grandparents jan and dorota, through two of their children. */
  function cousins(): Tree {
    const t = family();
    t.people(['matej', 'male'], ['adela', 'female'], ['vojtech', 'male'], ['blanka', 'female'], ['marie', 'female'], ['cyril', 'male']);
    t.couple('f-jan', 'jan', 'dorota', 'matej');
    t.couple('f-matej', 'matej', 'adela', 'vojtech');
    t.couple('f-vojtech', 'vojtech', 'blanka', 'marie');
    return t;
  }

  it('a wife who is also a cousin: named his wife, related in one more way as his second cousin of the 6th degree', () => {
    const t = cousins();
    t.family('f-karel', 'karel', 'marie');
    const r = kin(t.data, 'karel', 'marie');
    expect(r.paths.map((p) => [p.kind, p.degree, cs(p)])).toEqual([
      ['partner', null, 'manželka'],
      ['birth', 6, 'sestřenice z 2. kolena'],
    ]);
  });

  it('every Person on the way: the path to a second cousin names each Person and step', () => {
    const [p] = kin(cousins().data, 'karel', 'marie').paths;
    // Of the two common ancestors, both confirmed, the path shows the one with the lower id.
    expect(people(p!)).toEqual(['petr', 'josef', 'dorota', 'matej', 'vojtech', 'marie']);
    expect(p!.steps.map((s) => s.link)).toEqual(['parent', 'parent', 'parent', 'child', 'child', 'child']);
    expect(p!.commonAncestors).toEqual(['dorota', 'jan']);
  });

  it('double first cousins: two brothers married two sisters; two paths of the 4th degree', () => {
    const t = new Tree();
    t.people(['karel', 'male'], ['petr', 'male'], ['eva', 'female'], ['pavel', 'male'], ['ema', 'female'], ['otec', 'male'], ['matka', 'female']);
    t.people(['dedek', 'male'], ['babi', 'female'], ['ivo', 'male']);
    t.couple('f-bratri', 'otec', 'matka', 'petr', 'pavel');
    t.couple('f-sestry', 'dedek', 'babi', 'eva', 'ema');
    t.couple('f-petr', 'petr', 'eva', 'karel');
    t.couple('f-pavel', 'pavel', 'ema', 'ivo');
    const r = kin(t.data, 'karel', 'ivo');
    expect(r.paths.map((p) => [p.degree, cs(p)])).toEqual([
      [4, 'bratranec'],
      [4, 'bratranec'],
    ]);
  });

  it('brother-in-law and cousin: brother-in-law (2nd degree) first, third cousin (8th) second', () => {
    const t = new Tree();
    // A fourth-generation common pair, so that the wife's brother is also a third cousin.
    t.people(['karel', 'male'], ['alena', 'female'], ['ivan', 'male'], ['a', 'male'], ['b', 'female'], ['top', 'male'], ['topw', 'female']);
    t.people(['k1', 'male'], ['k2', 'male'], ['k3', 'male'], ['i1', 'male'], ['i2', 'male'], ['i3', 'male']);
    t.couple('f-top', 'top', 'topw', 'k3', 'i3');
    t.couple('f-k3', 'k3', null, 'k2');
    t.couple('f-k2', 'k2', null, 'k1');
    t.couple('f-k1', 'k1', null, 'karel');
    t.couple('f-i3', 'i3', null, 'i2');
    t.couple('f-i2', 'i2', null, 'i1');
    t.couple('f-i1', 'i1', null, 'ivan');
    t.couple('f-ab', 'a', 'b', 'alena', 'ivan');
    t.family('f-karel', 'karel', 'alena');
    expect(kin(t.data, 'karel', 'ivan').paths.map((p) => [p.kind, p.degree, cs(p)])).toEqual([
      ['marriage', 2, 'švagr'],
      ['birth', 8, 'bratranec z 3. kolena'],
    ]);
  });

  it('many paths: the first 100 listed, and there may be more', () => {
    const { tree, last } = lattice(9);
    const r = kin(tree.data, last[0], last[1]);
    expect(r.paths).toHaveLength(MAX_PATHS);
    expect(r.more).toBe(true);
    // The first is the closest: first cousins through the couple of the generation above.
    expect([r.paths[0]!.degree, r.paths[0]!.commonAncestors.length]).toEqual([4, 2]);
  });
});

describe('evidence (kinship spec, "Kinship follows the evidence")', () => {
  it('weak father link: possibly a great-grandfather; a confirming Citation takes the mark away', () => {
    const t = family();
    t.data.childLinks.find((c) => c.childId === 'josef')!.confidences1 = ['low'];
    const [p] = kin(t.data, 'karel', 'jan').paths;
    expect([p!.possible, cs(p)]).toEqual([true, 'praděd']);
    expect(p!.steps.map((s) => s.weak)).toEqual([false, false, true]);
    t.data.childLinks.find((c) => c.childId === 'josef')!.confidences1 = ['low', 'high'];
    expect(kin(t.data, 'karel', 'jan').paths[0]!.possible).toBe(false);
  });

  it('the closest path comes first even when it is only possible (the Owner, Open Questions 1)', () => {
    const t = new Tree();
    t.people(['karel', 'male'], ['otec', 'male'], ['ded', 'male'], ['stryc', 'male'], ['bratranec', 'male'], ['x', 'male'], ['y', 'male'], ['z', 'male'], ['w', 'male']);
    t.family('f-ded', 'ded', null);
    t.child('f-ded', 'otec', { confidences1: ['low'] });
    t.child('f-ded', 'stryc');
    t.couple('f-otec', 'otec', null, 'karel');
    t.couple('f-stryc', 'stryc', null, 'bratranec');
    const [p] = kin(t.data, 'karel', 'bratranec').paths;
    expect([p!.degree, p!.possible]).toEqual([4, true]);
  });
});

describe('fixed rules and limits (kinship spec, "Kinship follows fixed rules", "Limits of the kinship search")', () => {
  function shuffled(data: KinshipData, seed: number): KinshipData {
    const random = seeded(seed);
    const shuffle = <T>(xs: readonly T[]) => xs.map((x) => [random(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
    return { persons: shuffle(data.persons), families: shuffle(data.families), childLinks: shuffle(data.childLinks) };
  }

  it('records in another order give the same paths, path for path', () => {
    const { tree, last } = lattice(5);
    const expected = kin(tree.data, last[0], last[1]);
    for (const seed of [1, 2, 3]) expect(kin(shuffled(tree.data, seed), last[0], last[1])).toEqual(expected);
  });

  it('a dense collapsed pedigree: the work stops at the bound, and the short form names the same first path', () => {
    const { tree, last } = lattice(12);
    const full = kin(tree.data, last[0], last[1]);
    expect(full.more).toBe(true);
    expect(full.units).toBeLessThanOrEqual(FULL_BOUND + 20_000);
    const s = short(tree.data, last[0], last[1])!;
    expect(s.units).toBeLessThanOrEqual(SHORT_BOUND + 20_000);
    expect(s.first).toEqual(full.paths[0]);
  });
});
