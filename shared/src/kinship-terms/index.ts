/**
 * The kinship term of a path in every Interface language. The server writes every language into
 * each answer, as it writes the Sentences of the app, so the app holds no kinship rules. A new
 * Interface language must add its terms here: the Record refuses a language without them.
 */
import type { UiLanguage } from '../schemas/common.js';
import { spellCs, termCs } from './cs.js';
import { spellEn, termEn } from './en.js';
import type { TermInput } from './shapes.js';

/** A term as written, with its grammatical gender (null for a combined form, or when the language has none to say). */
export interface KinshipTermText {
  text: string;
  gender: 'm' | 'f' | 'n' | null;
}

/** The term rules of each Interface language: the proved choice, then the spelling. */
export const kinshipTerms: Record<UiLanguage, (t: TermInput) => KinshipTermText> = {
  cs: (t) => spellCs(termCs(t)),
  en: (t) => spellEn(termEn(t)),
};

/** The term of a path in every Interface language. */
export function termsOf(t: TermInput): Record<UiLanguage, KinshipTermText> {
  return { cs: kinshipTerms.cs(t), en: kinshipTerms.en(t) };
}
