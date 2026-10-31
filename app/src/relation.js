// The relation to the family: Relative, Possible relative or Unrelated person (GLOSSARY). The
// server computes it from the Family roots the Owner marked and the Family links with their
// Citations (shared/src/relation.ts, proved; add-vault-import tasks 1.3 and 1.4), and states it
// with every Person. This module is the one place the app reads it.
//
// Until the Owner marks the first Family root, the server says "unrelated" for everyone, which
// says nothing yet. The app then treats the relation as unknown: everyone is shown, the switch
// for Unrelated people stays hidden, nobody is marked as a Possible relative, and an unlinked
// Member's tree opens on search. The Family roots come with the signed-in Member (`me`); the
// shell passes them in with setFamilyRoots().

/** @typedef {'relative' | 'possible' | 'unrelated'} Relation */
/** @typedef {import('./types.js').PersonSummary} PersonSummary */

/** @type {readonly string[]} */
let roots = [];

/**
 * The Family roots the Owner marked, from the signed-in Member; none when signed out.
 * @param {readonly string[]} ids
 */
export function setFamilyRoots(ids) {
  roots = [...ids];
}

/** Whether the Tree has Family roots, so that the relation means something. */
export const rootsKnown = () => roots.length > 0;

/**
 * A Person's relation to the family, or null while the Tree has no Family root.
 * @param {PersonSummary | object} person
 * @returns {Relation | null}
 */
export function relationOf(person) {
  if (!rootsKnown()) return null;
  const value = 'relation' in person ? person.relation : null;
  return value === 'relative' || value === 'possible' || value === 'unrelated' ? value : null;
}

/**
 * Whether a Person is shown: Relatives and Possible relatives always, Unrelated people only
 * when the Member switched them on, and everyone while no relation is known.
 * @param {PersonSummary | object} person
 * @param {boolean} includeUnrelated
 */
export function isShown(person, includeUnrelated) {
  return includeUnrelated || relationOf(person) !== 'unrelated';
}

/**
 * Whether any of these Persons has a relation, so the switch for Unrelated people means something.
 * @param {Iterable<PersonSummary | object>} persons
 */
export function relationKnown(persons) {
  for (const p of persons) if (relationOf(p) !== null) return true;
  return false;
}

/**
 * The relation filter for search and the map Events query: Relatives and Possible relatives,
 * unless the Member includes Unrelated people or the Tree has no Family root yet.
 * @param {boolean} includeUnrelated
 * @returns {string | null}
 */
export function relationFilter(includeUnrelated) {
  return rootsKnown() && !includeUnrelated ? 'relative,possible' : null;
}

/**
 * The Family roots the Owner marked, the first marked first.
 * @param {import('./types.js').Me | null} me
 * @returns {string[]} Person ids
 */
export function familyRoots(me) {
  return me?.familyRoots ? [...me.familyRoots] : [];
}
