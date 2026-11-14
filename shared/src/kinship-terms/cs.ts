/**
 * Czech kinship terms (kinship spec, "Kinship terms by birth", "Kinship terms by marriage", "Half,
 * step, adoptive and foster kinship"; docs/reference/kinship-terms.md).
 *
 * The choice of word is proved with LemmaScript ({@link termCs}): the word, the number of "pra",
 * the "koleno" or generation, the marks and the grammatical gender follow the table of
 * design.md. The Owner chose the modern strýc and teta on both sides, "z n. kolena", and "pra"
 * written out up to three times (Open Questions 2 to 4). Spelling the chosen term ({@link spellCs})
 * is not proved; golden files check it (shared/test/golden/kinship/cs.txt).
 */
import type { TermInput } from './shapes.js';

// The numbers of shapes.ts, repeated: LemmaScript does not emit constants imported from another
// file (docs/verification.md, known issues). shared/test/kinship-terms.test.ts checks that they match.
const SHAPE_SELF = 0;
const SHAPE_PARTNER = 1;
const SHAPE_BIRTH = 2;
const SHAPE_PARTNER_KIN = 3;
const SHAPE_KIN_PARTNER = 4;
const SHAPE_STEP_SIBLING = 5;
const SHAPE_CO_PARENT_IN_LAW = 6;
const SHAPE_FOSTER = 7;
const MALE = 0;
const FEMALE = 1;
const MASCULINE = 0;
const FEMININE = 1;
const NEUTER = 2;
const COMBINED = 3;
const NOT_ADOPTIVE = 0;
const ADOPTIVE_WORD = 1;
const THROUGH_ADOPTION = 2;

/** The Czech words, each with its forms by sex in {@link CS_WORDS}. */
export const CS_SELF = 0;
export const CS_PARENT = 1;
export const CS_GRANDPARENT = 2;
export const CS_ANCESTOR = 3;
export const CS_CHILD = 4;
export const CS_GRANDCHILD = 5;
export const CS_DESCENDANT = 6;
export const CS_SIBLING = 7;
export const CS_UNCLE = 8;
export const CS_NEPHEW = 9;
export const CS_COUSIN = 10;
export const CS_RELATIVE = 11;
export const CS_SPOUSE = 12;
export const CS_PARTNER = 13;
export const CS_PARENT_IN_LAW = 14;
export const CS_SIBLING_IN_LAW = 15;
export const CS_STEPCHILD = 16;
export const CS_CHILD_IN_LAW = 17;
export const CS_STEPPARENT = 18;
export const CS_STEP_GRANDPARENT = 19;
export const CS_UNCLE_BY_MARRIAGE = 20;
export const CS_AFFINE = 21;
export const CS_STEP_SIBLING = 22;
export const CS_CO_PARENT_IN_LAW = 23;
export const CS_FOSTER_PARENT = 24;
export const CS_FOSTER_CHILD = 25;

/** The most "pra" a Czech term writes out (the Owner, Open Questions 4). */
export const MAX_PRA = 3;

/** The forms of a word: male, female, the neutral form for a Person with no sex recorded, or both forms joined. */
export const MALE_FORM = 0;
export const FEMALE_FORM = 1;
export const NEUTRAL_FORM = 2;
export const BOTH_FORMS = 3;

/** A Czech term as chosen: the word and its form, its "pra", "z n. kolena" or "v n. pokolení", the marks and the gender. */
export interface CsTerm {
  readonly word: number;
  readonly form: number;
  readonly pra: number;
  readonly koleno: number;
  readonly generation: number;
  readonly half: boolean;
  readonly adoptive: number;
  readonly gender: number;
}

// ---------------------------------------------------------------- the choice (proved)

/** The word for kinship by birth, `up` generations to the common ancestor and `down` from it. */
export function csBirthWord(up: number, down: number): number {
  //@ verify
  //@ requires up >= 0 && down >= 0
  if (up === 0 && down === 0) return CS_SELF;
  if (down === 0) {
    if (up === 1) return CS_PARENT;
    return up <= 2 + MAX_PRA ? CS_GRANDPARENT : CS_ANCESTOR;
  }
  if (up === 0) {
    if (down === 1) return CS_CHILD;
    return down <= 2 + MAX_PRA ? CS_GRANDCHILD : CS_DESCENDANT;
  }
  if (up === down) return up === 1 ? CS_SIBLING : CS_COUSIN;
  if (up > down) return up - down - 1 <= MAX_PRA ? CS_UNCLE : CS_RELATIVE;
  return down - up - 1 <= MAX_PRA ? CS_NEPHEW : CS_RELATIVE;
}

/** How many "pra" go before the word: one per generation beyond děd, vnuk, strýc and synovec. */
export function csPra(word: number, up: number, down: number): number {
  //@ verify
  if (word === CS_GRANDPARENT) return up - 2;
  if (word === CS_GRANDCHILD) return down - 2;
  if (word === CS_UNCLE) return up - down - 1;
  if (word === CS_NEPHEW) return down - up - 1;
  return 0;
}

/** The "koleno" of a cousin, a parent's cousin or a cousin's child; 0 for none. */
export function csKoleno(word: number, up: number, down: number): number {
  //@ verify
  if (word === CS_UNCLE && down >= 2) return down;
  if (word === CS_NEPHEW && up >= 2) return up;
  if (word === CS_COUSIN && up >= 3) return up - 1;
  return 0;
}

/** The word for the kin of the reader's partner. */
export function csPartnerKinWord(up: number, down: number): number {
  //@ verify
  if (up === 1 && down === 0) return CS_PARENT_IN_LAW;
  if (up === 1 && down === 1) return CS_SIBLING_IN_LAW;
  if (up === 0 && down === 1) return CS_STEPCHILD;
  return CS_AFFINE;
}

/** The word for the partner of the reader's kin. */
export function csKinPartnerWord(up: number, down: number): number {
  //@ verify
  if (up === 0 && down === 1) return CS_CHILD_IN_LAW;
  if (up === 1 && down === 1) return CS_SIBLING_IN_LAW;
  if (up === 1 && down === 0) return CS_STEPPARENT;
  if (up === 2 && down === 0) return CS_STEP_GRANDPARENT;
  if (up === 2 && down === 1) return CS_UNCLE_BY_MARRIAGE;
  return CS_AFFINE;
}

/** The word for a path of any shape. */
export function csWord(t: TermInput): number {
  //@ verify
  //@ requires t.up >= 0 && t.down >= 0
  if (t.shape === SHAPE_BIRTH) return csBirthWord(t.up, t.down);
  if (t.shape === SHAPE_PARTNER) return t.married ? CS_SPOUSE : CS_PARTNER;
  if (t.shape === SHAPE_PARTNER_KIN) return csPartnerKinWord(t.up, t.down);
  if (t.shape === SHAPE_KIN_PARTNER) return csKinPartnerWord(t.up, t.down);
  if (t.shape === SHAPE_STEP_SIBLING) return CS_STEP_SIBLING;
  if (t.shape === SHAPE_CO_PARENT_IN_LAW) return CS_CO_PARENT_IN_LAW;
  if (t.shape === SHAPE_FOSTER) return t.up >= 1 ? CS_FOSTER_PARENT : CS_FOSTER_CHILD;
  return CS_SELF;
}

/** The gender of a word for a Person whose sex is not recorded: its neutral form, or the combined one. */
export function csNeutralGender(word: number): number {
  //@ verify
  if (word === CS_CHILD || word === CS_GRANDCHILD || word === CS_STEPCHILD || word === CS_FOSTER_CHILD) return NEUTER;
  if (word === CS_SELF || word === CS_PARENT || word === CS_GRANDPARENT || word === CS_ANCESTOR || word === CS_DESCENDANT) return MASCULINE;
  if (word === CS_SIBLING || word === CS_STEPPARENT || word === CS_STEP_GRANDPARENT || word === CS_STEP_SIBLING) return MASCULINE;
  return COMBINED;
}

/** How the term says adoption: "adoptivní" for one adoptive link alone, "(přes osvojení)" for a longer path. */
export function csAdoptive(t: TermInput): number {
  //@ verify
  if (!t.adoptive || t.shape === SHAPE_SELF || t.shape === SHAPE_PARTNER || t.shape === SHAPE_FOSTER) return NOT_ADOPTIVE;
  if (t.shape === SHAPE_BIRTH && t.up + t.down === 1) return ADOPTIVE_WORD;
  return THROUGH_ADOPTION;
}

/** The Czech term of a path (design.md, the Czech table). */
export function termCs(t: TermInput): CsTerm {
  //@ verify
  //@ contract kinship: Kinship terms by birth
  //@ contract kinship: Kinship terms by marriage
  //@ contract kinship: Half, step, adoptive and foster kinship
  //@ requires t.up >= 0 && t.down >= 0
  // The direct line up ("Ancestors": otec, děd, praděd, praprababička; "Far up": předek v 7. pokolení).
  //@ ensures t.shape === SHAPE_BIRTH && t.down === 0 && t.up === 1 ==> \result.word === CS_PARENT && \result.pra === 0
  //@ ensures t.shape === SHAPE_BIRTH && t.down === 0 && t.up >= 2 && t.up <= 2 + MAX_PRA ==> \result.word === CS_GRANDPARENT && \result.pra === t.up - 2
  //@ ensures t.shape === SHAPE_BIRTH && t.down === 0 && t.up > 2 + MAX_PRA ==> \result.word === CS_ANCESTOR && \result.pra === 0 && \result.generation === t.up
  // The direct line down.
  //@ ensures t.shape === SHAPE_BIRTH && t.up === 0 && t.down === 1 ==> \result.word === CS_CHILD && \result.pra === 0
  //@ ensures t.shape === SHAPE_BIRTH && t.up === 0 && t.down >= 2 && t.down <= 2 + MAX_PRA ==> \result.word === CS_GRANDCHILD && \result.pra === t.down - 2
  //@ ensures t.shape === SHAPE_BIRTH && t.up === 0 && t.down > 2 + MAX_PRA ==> \result.word === CS_DESCENDANT && \result.pra === 0 && \result.generation === t.down
  // Siblings, and "Aunts, uncles, nieces" (teta, prastrýc, neteř), "Removed cousins" (strýc z 2. kolena, synovec z 2. kolena).
  //@ ensures t.shape === SHAPE_BIRTH && t.up === 1 && t.down === 1 ==> \result.word === CS_SIBLING
  //@ ensures t.shape === SHAPE_BIRTH && t.down >= 1 && t.up > t.down && t.up - t.down - 1 <= MAX_PRA ==> \result.word === CS_UNCLE && \result.pra === t.up - t.down - 1 && \result.koleno === (t.down >= 2 ? t.down : 0)
  //@ ensures t.shape === SHAPE_BIRTH && t.up >= 1 && t.down > t.up && t.down - t.up - 1 <= MAX_PRA ==> \result.word === CS_NEPHEW && \result.pra === t.down - t.up - 1 && \result.koleno === (t.up >= 2 ? t.up : 0)
  // "Cousins": sestřenice, bratranec z 2. kolena.
  //@ ensures t.shape === SHAPE_BIRTH && t.up === t.down && t.up >= 2 ==> \result.word === CS_COUSIN && \result.pra === 0 && \result.koleno === (t.up >= 3 ? t.up - 1 : 0)
  // More than three "pra" in the collateral line: příbuzný, with the line and degree beside it.
  //@ ensures t.shape === SHAPE_BIRTH && t.down >= 1 && t.up - t.down - 1 > MAX_PRA ==> \result.word === CS_RELATIVE && \result.pra === 0 && \result.koleno === 0
  //@ ensures t.shape === SHAPE_BIRTH && t.up >= 1 && t.down - t.up - 1 > MAX_PRA ==> \result.word === CS_RELATIVE && \result.pra === 0 && \result.koleno === 0
  // "Wife", "Partner without a recorded marriage".
  //@ ensures t.shape === SHAPE_PARTNER ==> \result.word === (t.married ? CS_SPOUSE : CS_PARTNER)
  // "Parents-in-law and children-in-law" (tchán, snacha, zeť), "Brothers- and sisters-in-law" (švagr, švagrová),
  // "Stepmother", "Married into the family further away" (sešvagřený).
  //@ ensures t.shape === SHAPE_PARTNER_KIN && t.up === 1 && t.down === 0 ==> \result.word === CS_PARENT_IN_LAW
  //@ ensures t.shape === SHAPE_PARTNER_KIN && t.up === 1 && t.down === 1 ==> \result.word === CS_SIBLING_IN_LAW
  //@ ensures t.shape === SHAPE_PARTNER_KIN && t.up === 0 && t.down === 1 ==> \result.word === CS_STEPCHILD
  //@ ensures t.shape === SHAPE_KIN_PARTNER && t.up === 0 && t.down === 1 ==> \result.word === CS_CHILD_IN_LAW
  //@ ensures t.shape === SHAPE_KIN_PARTNER && t.up === 1 && t.down === 1 ==> \result.word === CS_SIBLING_IN_LAW
  //@ ensures t.shape === SHAPE_KIN_PARTNER && t.up === 1 && t.down === 0 ==> \result.word === CS_STEPPARENT
  //@ ensures t.shape === SHAPE_KIN_PARTNER && t.up === 2 && t.down === 0 ==> \result.word === CS_STEP_GRANDPARENT
  //@ ensures t.shape === SHAPE_KIN_PARTNER && t.up === 2 && t.down === 1 ==> \result.word === CS_UNCLE_BY_MARRIAGE
  //@ ensures t.shape === SHAPE_KIN_PARTNER && t.up === 2 && t.down === 2 ==> \result.word === CS_AFFINE
  //@ ensures t.shape === SHAPE_STEP_SIBLING ==> \result.word === CS_STEP_SIBLING
  //@ ensures t.shape === SHAPE_CO_PARENT_IN_LAW ==> \result.word === CS_CO_PARENT_IN_LAW
  //@ ensures t.shape === SHAPE_FOSTER ==> \result.word === (t.up >= 1 ? CS_FOSTER_PARENT : CS_FOSTER_CHILD)
  // The gender follows the sex; with no sex recorded, the neutral or combined form ("Sex not recorded": vnouče).
  //@ ensures t.sex === MALE ==> \result.form === MALE_FORM && \result.gender === MASCULINE
  //@ ensures t.sex === FEMALE ==> \result.form === FEMALE_FORM && \result.gender === FEMININE
  //@ ensures t.sex !== MALE && t.sex !== FEMALE ==> \result.gender === csNeutralGender(\result.word) && \result.form === (\result.gender === COMBINED ? BOTH_FORMS : NEUTRAL_FORM)
  //@ ensures t.sex !== MALE && t.sex !== FEMALE && t.shape === SHAPE_BIRTH && t.up === 0 && t.down === 2 ==> \result.word === CS_GRANDCHILD && \result.form === NEUTRAL_FORM && \result.gender === NEUTER
  // Half only by birth ("Half-brother": polorodý bratr); adoption as a word for one link, else after the term ("Through adoption").
  //@ ensures \result.half <==> t.shape === SHAPE_BIRTH && t.half
  //@ ensures !t.adoptive ==> \result.adoptive === NOT_ADOPTIVE
  //@ ensures t.adoptive && t.shape === SHAPE_BIRTH && t.up + t.down === 1 ==> \result.adoptive === ADOPTIVE_WORD
  //@ ensures t.adoptive && t.shape === SHAPE_BIRTH && t.up + t.down >= 2 ==> \result.adoptive === THROUGH_ADOPTION
  //@ ensures t.adoptive && (t.shape === SHAPE_PARTNER_KIN || t.shape === SHAPE_KIN_PARTNER) ==> \result.adoptive === THROUGH_ADOPTION
  const word = csWord(t);
  const gender = t.sex === MALE ? MASCULINE : t.sex === FEMALE ? FEMININE : csNeutralGender(word);
  const form = t.sex === MALE ? MALE_FORM : t.sex === FEMALE ? FEMALE_FORM : gender === COMBINED ? BOTH_FORMS : NEUTRAL_FORM;
  return {
    word,
    form,
    pra: t.shape === SHAPE_BIRTH ? csPra(word, t.up, t.down) : 0,
    koleno: t.shape === SHAPE_BIRTH ? csKoleno(word, t.up, t.down) : 0,
    generation: word === CS_ANCESTOR ? t.up : word === CS_DESCENDANT ? t.down : 0,
    half: t.shape === SHAPE_BIRTH && t.half,
    adoptive: csAdoptive(t),
    gender,
  };
}

// ---------------------------------------------------------------- the spelling (golden files)

/** Each word's forms: male, female, and for a Person with no sex recorded. */
const CS_WORDS: readonly (readonly [string, string, string])[] = [
  ['vy', 'vy', 'vy'],
  ['otec', 'matka', 'rodič'],
  ['děd', 'babička', 'prarodič'],
  ['předek', 'předkyně', 'předek'],
  ['syn', 'dcera', 'dítě'],
  ['vnuk', 'vnučka', 'vnouče'],
  ['potomek', 'potomkyně', 'potomek'],
  ['bratr', 'sestra', 'sourozenec'],
  ['strýc', 'teta', ''],
  ['synovec', 'neteř', ''],
  ['bratranec', 'sestřenice', ''],
  ['příbuzný', 'příbuzná', ''],
  ['manžel', 'manželka', ''],
  ['partner', 'partnerka', ''],
  ['tchán', 'tchyně', ''],
  ['švagr', 'švagrová', ''],
  ['nevlastní syn', 'nevlastní dcera', 'nevlastní dítě'],
  ['zeť', 'snacha', ''],
  ['nevlastní otec', 'nevlastní matka', 'nevlastní rodič'],
  ['nevlastní děd', 'nevlastní babička', 'nevlastní prarodič'],
  ['přiženěný strýc', 'přivdaná teta', ''],
  ['sešvagřený', 'sešvagřená', ''],
  ['nevlastní bratr', 'nevlastní sestra', 'nevlastní sourozenec'],
  ['svat', 'svatka', ''],
  ['pěstoun', 'pěstounka', ''],
  ['svěřený syn', 'svěřená dcera', 'svěřené dítě'],
];

/** One form of a term: the half or adoptive word, "pra", and the word, in that form. */
function csForm(term: CsTerm, form: number): string {
  const forms = CS_WORDS[term.word]!;
  let word = forms[form]!;
  if (term.adoptive === ADOPTIVE_WORD && (term.word === CS_PARENT || term.word === CS_CHILD)) word = `adoptivní ${word}`;
  const gender = form === MALE_FORM ? MASCULINE : form === FEMALE_FORM ? FEMININE : term.gender;
  const half = term.half ? (gender === FEMININE ? 'polorodá ' : gender === NEUTER ? 'polorodé ' : 'polorodý ') : '';
  return `${half}${'pra'.repeat(term.pra)}${word}`;
}

const GENDERS = ['m', 'f', 'n', null] as const;

/** The Czech term as written, nominative and alone, with its gender (null for a combined form such as "bratranec/sestřenice"). */
export function spellCs(term: CsTerm): { text: string; gender: 'm' | 'f' | 'n' | null } {
  let text = term.form === BOTH_FORMS ? `${csForm(term, MALE_FORM)}/${csForm(term, FEMALE_FORM)}` : csForm(term, term.form);
  if (term.generation > 0) text += ` v ${term.generation}. pokolení`;
  if (term.koleno > 0) text += ` z ${term.koleno}. kolena`;
  if (term.adoptive === THROUGH_ADOPTION) text += ' (přes osvojení)';
  return { text, gender: GENDERS[term.gender] ?? null };
}
