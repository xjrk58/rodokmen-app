/**
 * Kinship on Chart cards (tree-charts spec, "Kinship on Chart cards"; add-kinship design.md,
 * "Where it is shown", Charts): when the cards of a Chart carry each Person's kinship to the
 * caller's own Person. Only the screen variant does, only when the Member switched it on
 * (`kinship=1`), and only for a caller with an own Person. A Sheet never does, whatever was
 * asked, so neither its print nor its SVG and PNG files can show kinship.
 *
 * The server asks this before it fills the short forms (server/src/charts/service.ts); the
 * route also refuses `sheet` with `kinship` (400), the Sheet variant's schema has no kinship
 * field, and the app's Sheet writer refuses a model with one.
 */
export function chartShowsKinship(sheet: boolean, asked: boolean, hasOwnPerson: boolean): boolean {
  //@ verify
  //@ contract tree-charts: Kinship on Chart cards
  // Scenario "Printing": a Sheet shows no kinship, switched on or off.
  //@ ensures sheet ==> !\result
  // Off by default: nothing unless the Member switched it on.
  //@ ensures !asked ==> !\result
  // A Member with no own Person, and every Agent, gets no kinship.
  //@ ensures !hasOwnPerson ==> !\result
  // Scenario "Switched on": on screen, switched on, with an own Person.
  //@ ensures !sheet && asked && hasOwnPerson ==> \result
  return !sheet && asked && hasOwnPerson;
}
