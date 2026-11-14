import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { kinshipTerms, termsOf } from '../src/kinship-terms/index.js';
import * as shapes from '../src/kinship-terms/shapes.js';
import { FEMALE, MALE, SHAPE_BIRTH, SHAPE_CO_PARENT_IN_LAW, SHAPE_FOSTER, SHAPE_KIN_PARTNER, SHAPE_PARTNER, SHAPE_PARTNER_KIN, SHAPE_SELF, SHAPE_STEP_SIBLING, UNKNOWN_SEX, type TermInput } from '../src/kinship-terms/shapes.js';
import { expectGolden } from './golden.js';

const term = (shape: number, up: number, down: number, sex: number, marks: Partial<Pick<TermInput, 'half' | 'adoptive' | 'married'>> = {}): TermInput => ({
  shape,
  up,
  down,
  sex,
  half: marks.half ?? false,
  adoptive: marks.adoptive ?? false,
  married: marks.married ?? false,
});
const cs = (t: TermInput) => kinshipTerms.cs(t).text;
const en = (t: TermInput) => kinshipTerms.en(t).text;
const birth = (up: number, down: number, sex: number, marks = {}) => term(SHAPE_BIRTH, up, down, sex, marks);

describe('kinship terms by birth (kinship spec, "Kinship terms by birth")', () => {
  it('ancestors: the father of the father of the father, and the mother of the mother of the mother of the mother', () => {
    expect([cs(birth(3, 0, MALE)), en(birth(3, 0, MALE))]).toEqual(['praděd', 'great-grandfather']);
    expect([cs(birth(4, 0, FEMALE)), en(birth(4, 0, FEMALE))]).toEqual(['praprababička', 'great-great-grandmother']);
  });

  it('aunts, uncles, nieces: the father’s sister, the grandfather’s brother, the brother’s daughter', () => {
    expect([cs(birth(2, 1, FEMALE)), en(birth(2, 1, FEMALE))]).toEqual(['teta', 'aunt']);
    expect([cs(birth(3, 1, MALE)), en(birth(3, 1, MALE))]).toEqual(['prastrýc', 'great-uncle']);
    expect([cs(birth(1, 2, FEMALE)), en(birth(1, 2, FEMALE))]).toEqual(['neteř', 'niece']);
  });

  it('cousins: an uncle’s daughter, and a son of a first cousin of the father', () => {
    expect([cs(birth(2, 2, FEMALE)), en(birth(2, 2, FEMALE))]).toEqual(['sestřenice', 'first cousin']);
    expect([cs(birth(3, 3, MALE)), en(birth(3, 3, MALE))]).toEqual(['bratranec z 2. kolena', 'second cousin']);
  });

  it('removed cousins: a male first cousin of the father, and the son of a first cousin', () => {
    expect([cs(birth(3, 2, MALE)), en(birth(3, 2, MALE))]).toEqual(['strýc z 2. kolena', 'first cousin once removed']);
    expect([cs(birth(2, 3, MALE)), en(birth(2, 3, MALE))]).toEqual(['synovec z 2. kolena', 'first cousin once removed']);
  });

  it('sex not recorded: a grandchild', () => {
    expect([cs(birth(0, 2, UNKNOWN_SEX)), en(birth(0, 2, UNKNOWN_SEX))]).toEqual(['vnouče', 'grandchild']);
    expect(kinshipTerms.cs(birth(0, 2, UNKNOWN_SEX)).gender).toBe('n');
    expect(cs(birth(2, 2, UNKNOWN_SEX))).toBe('bratranec/sestřenice');
    expect(kinshipTerms.cs(birth(2, 2, UNKNOWN_SEX)).gender).toBeNull();
  });

  it('far up: an ancestor seven generations up', () => {
    expect([cs(birth(7, 0, MALE)), en(birth(7, 0, MALE))]).toEqual(['předek v 7. pokolení', '5th great-grandfather']);
    // "pra" written out three times at most (the Owner, Open Questions 4).
    expect(cs(birth(5, 0, MALE))).toBe('praprapraděd');
    expect(cs(birth(6, 0, MALE))).toBe('předek v 6. pokolení');
  });

  it('more than three "pra" in the collateral line: příbuzný, with the line and degree beside it', () => {
    expect(cs(birth(5, 1, MALE))).toBe('prapraprastrýc');
    expect(cs(birth(6, 1, MALE))).toBe('příbuzný');
    expect(cs(birth(1, 6, FEMALE))).toBe('příbuzná');
    expect(en(birth(6, 1, MALE))).toBe('4th great-uncle');
  });
});

describe('kinship terms by marriage (kinship spec, "Kinship terms by marriage")', () => {
  it('parents-in-law and children-in-law: the wife’s father, the son’s wife, the daughter’s husband', () => {
    expect([cs(term(SHAPE_PARTNER_KIN, 1, 0, MALE)), en(term(SHAPE_PARTNER_KIN, 1, 0, MALE))]).toEqual(['tchán', 'father-in-law']);
    expect([cs(term(SHAPE_KIN_PARTNER, 0, 1, FEMALE)), en(term(SHAPE_KIN_PARTNER, 0, 1, FEMALE))]).toEqual(['snacha', 'daughter-in-law']);
    expect([cs(term(SHAPE_KIN_PARTNER, 0, 1, MALE)), en(term(SHAPE_KIN_PARTNER, 0, 1, MALE))]).toEqual(['zeť', 'son-in-law']);
  });

  it('brothers- and sisters-in-law: the sister’s husband, the wife’s brother, the brother’s wife', () => {
    expect([cs(term(SHAPE_KIN_PARTNER, 1, 1, MALE)), en(term(SHAPE_KIN_PARTNER, 1, 1, MALE))]).toEqual(['švagr', 'brother-in-law']);
    expect([cs(term(SHAPE_PARTNER_KIN, 1, 1, MALE)), en(term(SHAPE_PARTNER_KIN, 1, 1, MALE))]).toEqual(['švagr', 'brother-in-law']);
    expect([cs(term(SHAPE_KIN_PARTNER, 1, 1, FEMALE)), en(term(SHAPE_KIN_PARTNER, 1, 1, FEMALE))]).toEqual(['švagrová', 'sister-in-law']);
  });

  it('married into the family further away: the husband of a first cousin', () => {
    expect([cs(term(SHAPE_KIN_PARTNER, 2, 2, MALE)), en(term(SHAPE_KIN_PARTNER, 2, 2, MALE))]).toEqual(['sešvagřený', 'related by marriage']);
  });

  it('wife, and a partner without a recorded marriage', () => {
    expect([cs(term(SHAPE_PARTNER, 0, 0, FEMALE, { married: true })), en(term(SHAPE_PARTNER, 0, 0, FEMALE, { married: true }))]).toEqual(['manželka', 'wife']);
    expect([cs(term(SHAPE_PARTNER, 0, 0, FEMALE)), en(term(SHAPE_PARTNER, 0, 0, FEMALE))]).toEqual(['partnerka', 'partner']);
  });
});

describe('half, step, adoptive and foster kinship (kinship spec)', () => {
  it('half-brother', () => {
    expect([cs(birth(1, 1, MALE, { half: true })), en(birth(1, 1, MALE, { half: true }))]).toEqual(['polorodý bratr', 'half-brother']);
    expect(en(birth(2, 2, FEMALE, { half: true }))).toBe('half first cousin');
  });

  it('through adoption: a birth son of an adopted daughter, and one adoptive link alone', () => {
    expect([cs(birth(0, 2, MALE, { adoptive: true })), en(birth(0, 2, MALE, { adoptive: true }))]).toEqual(['vnuk (přes osvojení)', 'grandson (through adoption)']);
    expect([cs(birth(1, 0, FEMALE, { adoptive: true })), en(birth(1, 0, FEMALE, { adoptive: true }))]).toEqual(['adoptivní matka', 'adoptive mother']);
    expect([cs(birth(0, 1, FEMALE, { adoptive: true })), en(birth(0, 1, FEMALE, { adoptive: true }))]).toEqual(['adoptivní dcera', 'adopted daughter']);
  });

  it('stepmother, stepson, step-sibling, co-parents-in-law and foster pairs', () => {
    expect([cs(term(SHAPE_KIN_PARTNER, 1, 0, FEMALE)), en(term(SHAPE_KIN_PARTNER, 1, 0, FEMALE))]).toEqual(['nevlastní matka', 'stepmother']);
    expect([cs(term(SHAPE_PARTNER_KIN, 0, 1, MALE)), en(term(SHAPE_PARTNER_KIN, 0, 1, MALE))]).toEqual(['nevlastní syn', 'stepson']);
    expect([cs(term(SHAPE_STEP_SIBLING, 1, 1, FEMALE)), en(term(SHAPE_STEP_SIBLING, 1, 1, FEMALE))]).toEqual(['nevlastní sestra', 'stepsister']);
    expect([cs(term(SHAPE_CO_PARENT_IN_LAW, 1, 1, FEMALE)), en(term(SHAPE_CO_PARENT_IN_LAW, 1, 1, FEMALE))]).toEqual(['svatka', 'co-mother-in-law']);
    expect([cs(term(SHAPE_FOSTER, 1, 0, MALE)), en(term(SHAPE_FOSTER, 1, 0, MALE))]).toEqual(['pěstoun', 'foster father']);
    expect([cs(term(SHAPE_FOSTER, 0, 1, UNKNOWN_SEX)), en(term(SHAPE_FOSTER, 0, 1, UNKNOWN_SEX))]).toEqual(['svěřené dítě', 'foster child']);
  });

  it('the reader', () => {
    expect(termsOf(term(SHAPE_SELF, 0, 0, MALE))).toEqual({ cs: { text: 'vy', gender: 'm' }, en: { text: 'you', gender: 'm' } });
  });
});

describe('golden files of the terms (shared/test/golden/kinship/)', () => {
  const SEXES: Array<[string, number]> = [
    ['male', MALE],
    ['female', FEMALE],
    ['unknown', UNKNOWN_SEX],
  ];

  /** Every combination of up and down up to 8, each sex, half and adoptive, and each shape by marriage. */
  function table(lang: 'cs' | 'en'): string {
    const lines: string[] = [];
    const say = (label: string, t: TermInput) => lines.push(`${label}: ${kinshipTerms[lang](t).text}`);
    for (const [name, sex] of SEXES) say(`self ${name}`, term(SHAPE_SELF, 0, 0, sex));
    for (let up = 0; up <= 8; up++) {
      for (let down = 0; down <= 8; down++) {
        if (up === 0 && down === 0) continue;
        for (const [name, sex] of SEXES) {
          say(`birth up ${up} down ${down} ${name}`, birth(up, down, sex));
          if (up >= 1 && down >= 1) say(`birth up ${up} down ${down} ${name} half`, birth(up, down, sex, { half: true }));
          say(`birth up ${up} down ${down} ${name} adoptive`, birth(up, down, sex, { adoptive: true }));
        }
      }
    }
    for (const [name, sex] of SEXES) {
      say(`partner ${name} married`, term(SHAPE_PARTNER, 0, 0, sex, { married: true }));
      say(`partner ${name}`, term(SHAPE_PARTNER, 0, 0, sex));
    }
    for (const [shape, label] of [
      [SHAPE_PARTNER_KIN, 'partner’s kin'],
      [SHAPE_KIN_PARTNER, 'kin’s partner'],
    ] as const) {
      for (let up = 0; up <= 3; up++) {
        for (let down = 0; down <= 3; down++) {
          if (up === 0 && down === 0) continue;
          for (const [name, sex] of SEXES) say(`${label} up ${up} down ${down} ${name}`, term(shape, up, down, sex));
        }
      }
      for (const [name, sex] of SEXES) say(`${label} up 1 down 1 ${name} adoptive`, term(shape, 1, 1, sex, { adoptive: true }));
    }
    for (const [name, sex] of SEXES) {
      say(`step-sibling ${name}`, term(SHAPE_STEP_SIBLING, 1, 1, sex));
      say(`co-parent-in-law ${name}`, term(SHAPE_CO_PARENT_IN_LAW, 1, 1, sex));
      say(`foster parent ${name}`, term(SHAPE_FOSTER, 1, 0, sex));
      say(`foster child ${name}`, term(SHAPE_FOSTER, 0, 1, sex));
    }
    return `${lines.join('\n')}\n`;
  }

  for (const lang of ['cs', 'en'] as const) {
    it(`${lang}.txt lists every term`, () => {
      expectGolden(new URL(`golden/kinship/${lang}.txt`, import.meta.url).pathname, table(lang));
    });
  }

  it('the Czech file holds the Owner’s choices: modern strýc and teta, "z n. kolena", "pra" three times at most', () => {
    const text = table('cs');
    expect(text).not.toMatch(/ujec|strýna|ujčina/);
    expect(text).toContain('birth up 3 down 3 male: bratranec z 2. kolena');
    expect(text).toContain('birth up 5 down 0 male: praprapraděd');
    expect(text).toContain('birth up 6 down 0 female: předkyně v 6. pokolení');
    // "prarodič" holds a "pra" of its own: "praprapraprarodič" is "praprapraděd" with no sex recorded.
    expect(text).not.toMatch(/(pra){4}(děd|babička|strýc|teta|synovec|neteř|vnuk|vnučka|vnouče)/);
  });
});

describe('the term rules repeat the numbers of shapes.ts', () => {
  // LemmaScript does not emit constants imported from another file, so cs.ts and en.ts repeat them.
  for (const file of ['cs.ts', 'en.ts']) {
    it(file, () => {
      const source = readFileSync(new URL(`../src/kinship-terms/${file}`, import.meta.url), 'utf8');
      const repeated = [...source.matchAll(/^const ([A-Z_]+) = (\d+);$/gm)];
      expect(repeated.length).toBeGreaterThan(10);
      for (const [, name, value] of repeated) expect([name, (shapes as Record<string, unknown>)[name!]]).toEqual([name, Number(value)]);
    });
  }
});
