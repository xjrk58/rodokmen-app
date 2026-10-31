// The app's addresses (the part after #). Pure, so it is unit-tested without a browser.
//
//   (empty)          home: the tree for a signed-in Member, the map for everyone else
//   #tree            the tree on the remembered focus
//   #person-<id>     the tree with that Person as the focus (family-tree spec)
//   #people          People: list and search
//   #people/<id>     a person page
//   #settings        Settings
//   #map, #map=z/lat/lon   the map; #life/<id> the map with that Person's life path
//   #sign-in, #invite/<token>, #link/<token>   signing in
//   #work/…          the work panel (Propose, Drafts, review, history; src/work.js)

const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TOKEN = '[A-Za-z0-9_-]{20,200}';

/**
 * @typedef {{ screen: 'home' } | { screen: 'tree', focus: string | null } | { screen: 'people' }
 *   | { screen: 'person', id: string } | { screen: 'settings' } | { screen: 'map', life: string | null }
 *   | { screen: 'sign-in' } | { screen: 'invite', token: string } | { screen: 'link', token: string }
 *   | { screen: 'work', view: string }} Route
 */

/**
 * @param {string} hash location.hash, with or without the leading #
 * @returns {Route}
 */
export function parseRoute(hash) {
  const h = hash.replace(/^#/, '');
  let m;
  if (h === '') return { screen: 'home' };
  if (h === 'tree') return { screen: 'tree', focus: null };
  if ((m = new RegExp(`^person-(${ID})$`, 'i').exec(h))) return { screen: 'tree', focus: m[1].toLowerCase() };
  if (h === 'people') return { screen: 'people' };
  if ((m = new RegExp(`^people/(${ID})$`, 'i').exec(h))) return { screen: 'person', id: m[1].toLowerCase() };
  if (h === 'settings') return { screen: 'settings' };
  if (h === 'map' || h.startsWith('map=')) return { screen: 'map', life: null };
  if ((m = new RegExp(`^life/(${ID})$`, 'i').exec(h))) return { screen: 'map', life: m[1].toLowerCase() };
  if (h === 'sign-in') return { screen: 'sign-in' };
  if ((m = new RegExp(`^invite/(${TOKEN})$`).exec(h))) return { screen: 'invite', token: m[1] };
  if ((m = new RegExp(`^link/(${TOKEN})$`).exec(h))) return { screen: 'link', token: m[1] };
  if ((m = /^work(?:\/([a-z]+))?/.exec(h))) return { screen: 'work', view: m[1] ?? 'propose' };
  return { screen: 'home' };
}

/**
 * Whether a route shows family data, so that only a signed-in Member may open it; anyone else
 * is asked to sign in first and then brought back (family-tree spec, "Shared link").
 * @param {Route} route
 */
export function needsMember(route) {
  return (
    route.screen === 'tree' ||
    route.screen === 'people' ||
    route.screen === 'person' ||
    route.screen === 'settings' ||
    (route.screen === 'map' && route.life !== null)
  );
}

/** The address of the tree focused on a Person. @param {string} id */
export const treeAddress = (id) => `#person-${id}`;
/** The address of a person page. @param {string} id */
export const personAddress = (id) => `#people/${id}`;
/** The address of a Person's life path on the map. @param {string} id */
export const lifeAddress = (id) => `#life/${id}`;
