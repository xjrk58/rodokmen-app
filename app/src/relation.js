// The relation to the family: Relative, Possible relative or Unrelated person (GLOSSARY).
//
// It is computed from the Family roots by add-vault-import (its tree-model delta, tasks 1.3 and
// 1.4), which is not built yet: no Person carries a relation, and no Family root exists. Until
// then everyone counts as shown, the switch for Unrelated people stays hidden, nobody is marked
// as a Possible relative, and an unlinked Member's tree opens on search. This module is the one
// place that reads the relation; wiring it in later means filling in relationOf() and
// familyRoots() from the API and nothing else.

/** @typedef {'relative' | 'possible' | 'unrelated'} Relation */
/** @typedef {import('./types.js').PersonSummary} PersonSummary */

/**
 * A Person's relation to the family, or null while the Tree does not compute one.
 * @param {PersonSummary | object} person
 * @returns {Relation | null}
 */
export function relationOf(person) {
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
 * The Family roots the Owner marked: none until add-vault-import adds them.
 * @param {import('./types.js').Me | null} _me
 * @returns {string[]} Person ids
 */
export function familyRoots(_me) {
  return [];
}
