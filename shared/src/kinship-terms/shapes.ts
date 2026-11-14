/**
 * What a kinship term is chosen from (kinship spec, "Kinship terms by birth", "Kinship terms by
 * marriage", "Half, step, adoptive and foster kinship"): the shape of the path, its generations up
 * and down, the Person's sex and the path's marks. Plain numbers, so that the proved term rules of
 * each language (cs.ts, en.ts) need nothing from another file.
 */

/** The shapes of a path, as a term names it. */
export const SHAPE_SELF = 0;
export const SHAPE_PARTNER = 1;
export const SHAPE_BIRTH = 2;
/** The kin of the reader's partner: across to the partner, then by birth. */
export const SHAPE_PARTNER_KIN = 3;
/** The partner of the reader's kin: by birth, then across to the partner. */
export const SHAPE_KIN_PARTNER = 4;
export const SHAPE_STEP_SIBLING = 5;
export const SHAPE_CO_PARENT_IN_LAW = 6;
export const SHAPE_FOSTER = 7;

/** The Person's sex (`person.sex`). */
export const MALE = 0;
export const FEMALE = 1;
export const UNKNOWN_SEX = 2;

/** The grammatical gender of a term; COMBINED for a form such as "bratranec/sestřenice". */
export const MASCULINE = 0;
export const FEMININE = 1;
export const NEUTER = 2;
export const COMBINED = 3;

/** How a term says adoption: not at all, as a word ("adoptivní otec"), or after it ("(přes osvojení)"). */
export const NOT_ADOPTIVE = 0;
export const ADOPTIVE_WORD = 1;
export const THROUGH_ADOPTION = 2;

/**
 * A path as its term sees it. `up` and `down` are the generations of the part by birth (for a
 * foster pair, 1 up for a foster parent and 1 down for a foster child). `half`, `adoptive` and
 * `married` are the path's marks: half kinship, an adoptive link on the way, and for partners a
 * recorded marriage.
 */
export interface TermInput {
  readonly shape: number;
  readonly up: number;
  readonly down: number;
  readonly sex: number;
  readonly half: boolean;
  readonly adoptive: boolean;
  readonly married: boolean;
}
