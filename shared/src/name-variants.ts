/**
 * The unverified shell of name matching (shared/src/matching.ts holds the proved rule): how a
 * read name is folded into the variants it may match, and which birth years a role allows.
 * Regular expressions and tables, which LemmaScript cannot model; tested in test/reading.test.ts.
 */
import { foldForSearch } from './text.js';

/** Given names that registers write in Latin, German or Czech forms, folded; each group is one name. */
const GIVEN_GROUPS: readonly (readonly string[])[] = [
  ['jan', 'joannes', 'johannes', 'johann', 'hans', 'ioannes'],
  ['josef', 'joseph', 'josephus', 'iosephus'],
  ['jiri', 'georgius', 'georg'],
  ['vaclav', 'wenceslaus', 'wenzel', 'wenzl'],
  ['frantisek', 'franciscus', 'franz'],
  ['tomas', 'thomas'],
  ['jakub', 'jacobus', 'jakob'],
  ['matej', 'mathias', 'matthias', 'matthaeus'],
  ['martin', 'martinus'],
  ['petr', 'petrus', 'peter'],
  ['pavel', 'paulus', 'paul'],
  ['karel', 'carolus', 'karl'],
  ['antonin', 'antonius', 'anton'],
  ['vojtech', 'adalbertus', 'adalbert'],
  ['marie', 'maria', 'marye'],
  ['anna', 'anne'],
  ['katerina', 'catharina', 'katharina'],
  ['alzbeta', 'elisabetha', 'elisabeth'],
  ['dorota', 'dorothea'],
  ['barbora', 'barbara'],
  ['magdalena', 'magdalene'],
  ['ludmila', 'ludmilla'],
  ['terezie', 'theresia', 'theresa'],
  ['rozalie', 'rosalia'],
  ['veronika', 'veronica'],
];

/** Spelling a Kurrent or Latin register uses where Czech writes otherwise, folded: applied left to right. */
const SPELLINGS: ReadonlyArray<readonly [RegExp, string]> = [
  [/w/g, 'v'],
  [/th/g, 't'],
  [/ph/g, 'f'],
  [/ck/g, 'k'],
  [/y/g, 'i'],
  [/tz/g, 'c'],
  // Old Czech spelling: rz for ř, cz for č.
  [/rz/g, 'r'],
  [/cz/g, 'c'],
  [/sch/g, 's'],
  [/sz/g, 's'],
  [/ss/g, 's'],
];

/** A folded name with the register spellings made Czech, so "Nowak" and "Novák" meet. */
export function spellingKey(name: string): string {
  let key = foldForSearch(name);
  for (const [from, to] of SPELLINGS) key = key.replace(from, to);
  return key;
}

/** Feminine surname endings: Nováková, Nowakowa (and Novákovna, a daughter) meet Novák at "novak". */
function surnameStem(key: string): string {
  if (key.endsWith('ova') && key.length > 5) return key.slice(0, -3);
  if (key.endsWith('ovna') && key.length > 6) return key.slice(0, -4);
  return key;
}

/** The other forms of a given name: Latin, German and Czech forms of the same name, with register spellings made Czech. */
function givenForms(word: string, key: string): string[] {
  const group = GIVEN_GROUPS.find((g) => g.includes(word) || g.map(spellingKey).includes(key));
  return group ? group.map(spellingKey) : [];
}

/** The variants a name may match, folded: each word, its register spelling and, for given names, its other forms. */
export function nameVariants(name: string, kind: 'given' | 'surname'): string[] {
  const out = new Set<string>();
  for (const word of foldForSearch(name)
    .split(' ')
    .filter((w) => w.length > 1)) {
    const key = spellingKey(word);
    out.add(word);
    out.add(key);
    if (kind === 'surname') out.add(surnameStem(key));
    else for (const form of givenForms(word, key)) out.add(form);
  }
  return [...out].sort();
}

/**
 * The years a person in a role may have been born in, for an entry of a year: a child in that
 * year, parents 15 to 60 years before, godparents and witnesses 12 to 80, a priest 24 to 90,
 * partners 14 to 80, the deceased 0 to 110. Null when the role gives no window.
 */
export function birthWindow(role: string, year: number): { from: number; to: number } | null {
  switch (role) {
    case 'child':
      return { from: year - 1, to: year };
    case 'father':
    case 'mother':
      return { from: year - 60, to: year - 15 };
    case 'godparent':
    case 'witness':
    case 'informant':
      return { from: year - 80, to: year - 12 };
    case 'priest':
      return { from: year - 90, to: year - 24 };
    case 'partner':
      return { from: year - 80, to: year - 14 };
    case 'deceased':
      return { from: year - 110, to: year };
    default:
      return null;
  }
}
