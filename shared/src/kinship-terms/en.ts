/**
 * English kinship terms (kinship spec, "Kinship terms by birth", "Kinship terms by marriage",
 * "Half, step, adoptive and foster kinship"; docs/reference/kinship-terms.md).
 *
 * The choice of word is proved with LemmaScript ({@link termEn}): the word, the number of "great",
 * the cousin number, the removes, the marks and the grammatical gender follow the table of
 * design.md. Spelling the chosen term ({@link spellEn}) is not proved; golden files check it
 * (shared/test/golden/kinship/en.txt).
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
const COMBINED = 3;
const NOT_ADOPTIVE = 0;
const ADOPTIVE_WORD = 1;
const THROUGH_ADOPTION = 2;

/** The English words, each with its forms by sex in {@link EN_WORDS}. */
export const EN_SELF = 0;
export const EN_PARENT = 1;
export const EN_GRANDPARENT = 2;
export const EN_CHILD = 3;
export const EN_GRANDCHILD = 4;
export const EN_SIBLING = 5;
export const EN_UNCLE = 6;
export const EN_NEPHEW = 7;
export const EN_COUSIN = 8;
export const EN_SPOUSE = 9;
export const EN_PARTNER = 10;
export const EN_PARENT_IN_LAW = 11;
export const EN_SIBLING_IN_LAW = 12;
export const EN_STEPCHILD = 13;
export const EN_CHILD_IN_LAW = 14;
export const EN_STEPPARENT = 15;
export const EN_STEP_GRANDPARENT = 16;
export const EN_UNCLE_BY_MARRIAGE = 17;
export const EN_AFFINE = 18;
export const EN_STEP_SIBLING = 19;
export const EN_CO_PARENT_IN_LAW = 20;
export const EN_FOSTER_PARENT = 21;
export const EN_FOSTER_CHILD = 22;

/** An English term as chosen: the word and its form (0 male, 1 female, 2 neutral), "great", the cousin number and removes, the marks and the gender. */
export interface EnTerm {
  readonly word: number;
  readonly form: number;
  readonly greats: number;
  readonly cousin: number;
  readonly removed: number;
  readonly half: boolean;
  readonly adoptive: number;
  readonly gender: number;
}

// ---------------------------------------------------------------- the choice (proved)

/** The word for kinship by birth, `up` generations to the common ancestor and `down` from it. */
export function enBirthWord(up: number, down: number): number {
  //@ verify
  //@ requires up >= 0 && down >= 0
  if (up === 0 && down === 0) return EN_SELF;
  if (down === 0) return up === 1 ? EN_PARENT : EN_GRANDPARENT;
  if (up === 0) return down === 1 ? EN_CHILD : EN_GRANDCHILD;
  if (up === 1 && down === 1) return EN_SIBLING;
  if (down === 1) return EN_UNCLE;
  if (up === 1) return EN_NEPHEW;
  return EN_COUSIN;
}

/** How many "great" go before the word: one per generation beyond grandparent, grandchild, uncle and nephew. */
export function enGreats(word: number, up: number, down: number): number {
  //@ verify
  if (word === EN_GRANDPARENT) return up - 2;
  if (word === EN_GRANDCHILD) return down - 2;
  if (word === EN_UNCLE) return up - 2;
  if (word === EN_NEPHEW) return down - 2;
  return 0;
}

/** The word for the kin of the reader's partner. */
export function enPartnerKinWord(up: number, down: number): number {
  //@ verify
  if (up === 1 && down === 0) return EN_PARENT_IN_LAW;
  if (up === 1 && down === 1) return EN_SIBLING_IN_LAW;
  if (up === 0 && down === 1) return EN_STEPCHILD;
  return EN_AFFINE;
}

/** The word for the partner of the reader's kin. */
export function enKinPartnerWord(up: number, down: number): number {
  //@ verify
  if (up === 0 && down === 1) return EN_CHILD_IN_LAW;
  if (up === 1 && down === 1) return EN_SIBLING_IN_LAW;
  if (up === 1 && down === 0) return EN_STEPPARENT;
  if (up === 2 && down === 0) return EN_STEP_GRANDPARENT;
  if (up === 2 && down === 1) return EN_UNCLE_BY_MARRIAGE;
  return EN_AFFINE;
}

/** The word for a path of any shape. */
export function enWord(t: TermInput): number {
  //@ verify
  //@ requires t.up >= 0 && t.down >= 0
  if (t.shape === SHAPE_BIRTH) return enBirthWord(t.up, t.down);
  if (t.shape === SHAPE_PARTNER) return t.married ? EN_SPOUSE : EN_PARTNER;
  if (t.shape === SHAPE_PARTNER_KIN) return enPartnerKinWord(t.up, t.down);
  if (t.shape === SHAPE_KIN_PARTNER) return enKinPartnerWord(t.up, t.down);
  if (t.shape === SHAPE_STEP_SIBLING) return EN_STEP_SIBLING;
  if (t.shape === SHAPE_CO_PARENT_IN_LAW) return EN_CO_PARENT_IN_LAW;
  if (t.shape === SHAPE_FOSTER) return t.up >= 1 ? EN_FOSTER_PARENT : EN_FOSTER_CHILD;
  return EN_SELF;
}

/** Whether a word has a neutral form for a Person with no sex recorded (parent, child, sibling, spouse …); otherwise both forms are joined. */
export function enHasNeutral(word: number): boolean {
  //@ verify
  return word !== EN_UNCLE && word !== EN_NEPHEW && word !== EN_UNCLE_BY_MARRIAGE;
}

/** How the term says adoption: "adoptive" or "adopted" for one adoptive link alone, "(through adoption)" for a longer path. */
export function enAdoptive(t: TermInput): number {
  //@ verify
  if (!t.adoptive || t.shape === SHAPE_SELF || t.shape === SHAPE_PARTNER || t.shape === SHAPE_FOSTER) return NOT_ADOPTIVE;
  if (t.shape === SHAPE_BIRTH && t.up + t.down === 1) return ADOPTIVE_WORD;
  return THROUGH_ADOPTION;
}

/** The English term of a path (design.md, the English table). */
export function termEn(t: TermInput): EnTerm {
  //@ verify
  //@ contract kinship: Kinship terms by birth
  //@ contract kinship: Kinship terms by marriage
  //@ contract kinship: Half, step, adoptive and foster kinship
  //@ requires t.up >= 0 && t.down >= 0
  // The direct line ("Ancestors": great-grandfather, great-great-grandmother; "Far up": 5th great-grandfather).
  //@ ensures t.shape === SHAPE_BIRTH && t.down === 0 && t.up === 1 ==> \result.word === EN_PARENT && \result.greats === 0
  //@ ensures t.shape === SHAPE_BIRTH && t.down === 0 && t.up >= 2 ==> \result.word === EN_GRANDPARENT && \result.greats === t.up - 2
  //@ ensures t.shape === SHAPE_BIRTH && t.up === 0 && t.down === 1 ==> \result.word === EN_CHILD && \result.greats === 0
  //@ ensures t.shape === SHAPE_BIRTH && t.up === 0 && t.down >= 2 ==> \result.word === EN_GRANDCHILD && \result.greats === t.down - 2
  // Siblings, and "Aunts, uncles, nieces" (aunt, great-uncle, niece).
  //@ ensures t.shape === SHAPE_BIRTH && t.up === 1 && t.down === 1 ==> \result.word === EN_SIBLING
  //@ ensures t.shape === SHAPE_BIRTH && t.down === 1 && t.up >= 2 ==> \result.word === EN_UNCLE && \result.greats === t.up - 2 && \result.cousin === 0
  //@ ensures t.shape === SHAPE_BIRTH && t.up === 1 && t.down >= 2 ==> \result.word === EN_NEPHEW && \result.greats === t.down - 2 && \result.cousin === 0
  // "Cousins" and "Removed cousins": the n-th cousin (the smaller generation less one), removed by the difference.
  //@ ensures t.shape === SHAPE_BIRTH && t.up >= 2 && t.down >= 2 ==> \result.word === EN_COUSIN && \result.greats === 0 && \result.cousin === (t.up < t.down ? t.up : t.down) - 1 && \result.removed === (t.up < t.down ? t.down - t.up : t.up - t.down)
  //@ ensures t.shape === SHAPE_BIRTH && t.up === 2 && t.down === 3 ==> \result.cousin === 1 && \result.removed === 1
  //@ ensures t.shape === SHAPE_BIRTH && t.up === 3 && t.down === 2 ==> \result.cousin === 1 && \result.removed === 1
  //@ ensures \result.word !== EN_COUSIN ==> \result.cousin === 0 && \result.removed === 0
  // "Wife", "Partner without a recorded marriage".
  //@ ensures t.shape === SHAPE_PARTNER ==> \result.word === (t.married ? EN_SPOUSE : EN_PARTNER)
  // "Parents-in-law and children-in-law", "Brothers- and sisters-in-law", "Stepmother", "Married into the family further away".
  //@ ensures t.shape === SHAPE_PARTNER_KIN && t.up === 1 && t.down === 0 ==> \result.word === EN_PARENT_IN_LAW
  //@ ensures t.shape === SHAPE_PARTNER_KIN && t.up === 1 && t.down === 1 ==> \result.word === EN_SIBLING_IN_LAW
  //@ ensures t.shape === SHAPE_PARTNER_KIN && t.up === 0 && t.down === 1 ==> \result.word === EN_STEPCHILD
  //@ ensures t.shape === SHAPE_KIN_PARTNER && t.up === 0 && t.down === 1 ==> \result.word === EN_CHILD_IN_LAW
  //@ ensures t.shape === SHAPE_KIN_PARTNER && t.up === 1 && t.down === 1 ==> \result.word === EN_SIBLING_IN_LAW
  //@ ensures t.shape === SHAPE_KIN_PARTNER && t.up === 1 && t.down === 0 ==> \result.word === EN_STEPPARENT
  //@ ensures t.shape === SHAPE_KIN_PARTNER && t.up === 2 && t.down === 0 ==> \result.word === EN_STEP_GRANDPARENT
  //@ ensures t.shape === SHAPE_KIN_PARTNER && t.up === 2 && t.down === 1 ==> \result.word === EN_UNCLE_BY_MARRIAGE
  //@ ensures t.shape === SHAPE_KIN_PARTNER && t.up === 2 && t.down === 2 ==> \result.word === EN_AFFINE
  //@ ensures t.shape === SHAPE_STEP_SIBLING ==> \result.word === EN_STEP_SIBLING
  //@ ensures t.shape === SHAPE_CO_PARENT_IN_LAW ==> \result.word === EN_CO_PARENT_IN_LAW
  //@ ensures t.shape === SHAPE_FOSTER ==> \result.word === (t.up >= 1 ? EN_FOSTER_PARENT : EN_FOSTER_CHILD)
  // The gender follows the sex; with no sex recorded, the neutral form ("Sex not recorded": grandchild) or both forms.
  //@ ensures t.sex === MALE ==> \result.form === 0 && \result.gender === MASCULINE
  //@ ensures t.sex === FEMALE ==> \result.form === 1 && \result.gender === FEMININE
  //@ ensures t.sex !== MALE && t.sex !== FEMALE ==> \result.gender === COMBINED && \result.form === (enHasNeutral(\result.word) ? 2 : 3)
  // Half only by birth ("Half-brother"); adoption as a word for one link, else after the term ("Through adoption").
  //@ ensures \result.half <==> t.shape === SHAPE_BIRTH && t.half
  //@ ensures !t.adoptive ==> \result.adoptive === NOT_ADOPTIVE
  //@ ensures t.adoptive && t.shape === SHAPE_BIRTH && t.up + t.down === 1 ==> \result.adoptive === ADOPTIVE_WORD
  //@ ensures t.adoptive && t.shape === SHAPE_BIRTH && t.up + t.down >= 2 ==> \result.adoptive === THROUGH_ADOPTION
  //@ ensures t.adoptive && (t.shape === SHAPE_PARTNER_KIN || t.shape === SHAPE_KIN_PARTNER) ==> \result.adoptive === THROUGH_ADOPTION
  const word = enWord(t);
  const cousin = word === EN_COUSIN;
  return {
    word,
    form: t.sex === MALE ? 0 : t.sex === FEMALE ? 1 : enHasNeutral(word) ? 2 : 3,
    greats: t.shape === SHAPE_BIRTH ? enGreats(word, t.up, t.down) : 0,
    cousin: cousin ? (t.up < t.down ? t.up : t.down) - 1 : 0,
    removed: cousin ? (t.up < t.down ? t.down - t.up : t.up - t.down) : 0,
    half: t.shape === SHAPE_BIRTH && t.half,
    adoptive: enAdoptive(t),
    gender: t.sex === MALE ? MASCULINE : t.sex === FEMALE ? FEMININE : COMBINED,
  };
}

// ---------------------------------------------------------------- the spelling (golden files)

/** Each word's forms: male, female, and for a Person with no sex recorded. */
const EN_WORDS: readonly (readonly [string, string, string])[] = [
  ['you', 'you', 'you'],
  ['father', 'mother', 'parent'],
  ['grandfather', 'grandmother', 'grandparent'],
  ['son', 'daughter', 'child'],
  ['grandson', 'granddaughter', 'grandchild'],
  ['brother', 'sister', 'sibling'],
  ['uncle', 'aunt', ''],
  ['nephew', 'niece', ''],
  ['cousin', 'cousin', 'cousin'],
  ['husband', 'wife', 'spouse'],
  ['partner', 'partner', 'partner'],
  ['father-in-law', 'mother-in-law', 'parent-in-law'],
  ['brother-in-law', 'sister-in-law', 'sibling-in-law'],
  ['stepson', 'stepdaughter', 'stepchild'],
  ['son-in-law', 'daughter-in-law', 'child-in-law'],
  ['stepfather', 'stepmother', 'step-parent'],
  ['step-grandfather', 'step-grandmother', 'step-grandparent'],
  ['uncle by marriage', 'aunt by marriage', ''],
  ['related by marriage', 'related by marriage', 'related by marriage'],
  ['stepbrother', 'stepsister', 'step-sibling'],
  ['co-father-in-law', 'co-mother-in-law', 'co-parent-in-law'],
  ['foster father', 'foster mother', 'foster parent'],
  ['foster son', 'foster daughter', 'foster child'],
];

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

const COUSINS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh'];
const REMOVES = ['', 'once', 'twice'];

/** "great-", "great-great-", then "3rd great-" and on. */
function greats(n: number): string {
  if (n === 0) return '';
  if (n <= 2) return 'great-'.repeat(n);
  return `${ordinal(n)} great-`;
}

/** One form of a term. */
function enForm(term: EnTerm, form: number): string {
  let word = EN_WORDS[term.word]![form]!;
  if (term.word === EN_COUSIN) {
    word = `${COUSINS[term.cousin] ?? `${ordinal(term.cousin)}`} cousin`;
    if (term.removed > 0) word += ` ${REMOVES[term.removed] ?? `${term.removed} times`} removed`;
  }
  if (term.adoptive === ADOPTIVE_WORD) word = `${term.word === EN_PARENT ? 'adoptive' : 'adopted'} ${word}`;
  word = `${greats(term.greats)}${word}`;
  if (term.half) word = term.word === EN_COUSIN ? `half ${word}` : `half-${word}`;
  return word;
}

const GENDERS = ['m', 'f', 'n', null] as const;

/** The English term as written, with its gender (null when the sex is not recorded). */
export function spellEn(term: EnTerm): { text: string; gender: 'm' | 'f' | 'n' | null } {
  let text = term.form === 3 ? `${enForm(term, 1)} or ${enForm(term, 0)}` : enForm(term, term.form);
  if (term.adoptive === THROUGH_ADOPTION) text += ' (through adoption)';
  return { text, gender: GENDERS[term.gender] ?? null };
}
