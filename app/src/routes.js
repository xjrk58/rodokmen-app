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
//   #address/<token>  confirming a new address the Owner gave a Member
//   #leads, #leads/place/<id>   Research leads, all or at a Place; #leads/<id> one lead
//   #leads/new[/person/<id> | /place/<id>]   writing a lead
//   #work/…          the work panel (Propose, Drafts, review, history; src/work.js)
//   #chart/descendants/person/<id>, #chart/descendants/family/<id>, #chart/house/<id>
//                    a Chart, with its options after ? (tree-charts spec, "Charts in the app")

const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TOKEN = '[A-Za-z0-9_-]{20,200}';

/**
 * @typedef {{ screen: 'home' } | { screen: 'tree', focus: string | null } | { screen: 'people' }
 *   | { screen: 'person', id: string } | { screen: 'settings' } | { screen: 'map', life: string | null }
 *   | { screen: 'sign-in' } | { screen: 'invite', token: string } | { screen: 'link', token: string } | { screen: 'address', token: string }
 *   | { screen: 'work', view: string } | { screen: 'leads', place: string | null } | { screen: 'lead', id: string }
 *   | { screen: 'lead-new', person: string | null, place: string | null } | { screen: 'chart', chart: ChartRoute }} Route
 */

/**
 * A Chart's address: its kind, start and options. Options at their default are left out of the
 * address, so that each Chart has one address.
 * @typedef {object} ChartRoute
 * @property {'descendants' | 'house'} kind
 * @property {'person' | 'family' | 'house'} start
 * @property {string} id
 * @property {number} generations 2 to 8
 * @property {'tree' | 'line'} form
 * @property {string | null} line the end of the Direct line
 * @property {number | null} from House chart: the period's first year
 * @property {number | null} to House chart: the period's last year
 * @property {boolean} unrelated House chart: also the rows of Unrelated people
 * @property {string} title the Member's own title; '' for the default
 * @property {'a3-landscape' | 'a3-portrait' | 'a4-landscape' | 'a4-portrait'} paper
 * @property {'reduced' | 'nameless'} living how a Sheet shows Living people
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
  if (h === 'leads' || h.startsWith('leads/')) return parseLeadsRoute(h);
  if (h === 'map' || h.startsWith('map=')) return { screen: 'map', life: null };
  if ((m = new RegExp(`^life/(${ID})$`, 'i').exec(h))) return { screen: 'map', life: m[1].toLowerCase() };
  if (h === 'sign-in') return { screen: 'sign-in' };
  if ((m = new RegExp(`^invite/(${TOKEN})$`).exec(h))) return { screen: 'invite', token: m[1] };
  if ((m = new RegExp(`^link/(${TOKEN})$`).exec(h))) return { screen: 'link', token: m[1] };
  if ((m = new RegExp(`^address/(${TOKEN})$`).exec(h))) return { screen: 'address', token: m[1] };
  if ((m = /^work(?:\/([a-z]+))?/.exec(h))) return { screen: 'work', view: m[1] ?? 'propose' };
  if (h.startsWith('chart/')) return parseChartRoute(h);
  return { screen: 'home' };
}

/**
 * The Research lead addresses: #leads, #leads/place/<id>, #leads/<id>, #leads/new[/person|place/<id>].
 * @param {string} h
 * @returns {Route}
 */
function parseLeadsRoute(h) {
  let m;
  if (h === 'leads') return { screen: 'leads', place: null };
  if ((m = new RegExp(`^leads/place/(${ID})$`, 'i').exec(h))) return { screen: 'leads', place: m[1].toLowerCase() };
  if (h === 'leads/new') return { screen: 'lead-new', person: null, place: null };
  if ((m = new RegExp(`^leads/new/(person|place)/(${ID})$`, 'i').exec(h))) {
    const id = m[2].toLowerCase();
    return m[1].toLowerCase() === 'person' ? { screen: 'lead-new', person: id, place: null } : { screen: 'lead-new', person: null, place: id };
  }
  if ((m = new RegExp(`^leads/(${ID})$`, 'i').exec(h))) return { screen: 'lead', id: m[1].toLowerCase() };
  return { screen: 'home' };
}

const PAPERS = ['a3-landscape', 'a3-portrait', 'a4-landscape', 'a4-portrait'];
/** @type {Omit<ChartRoute, 'kind' | 'start' | 'id'>} */
const CHART_DEFAULTS = {
  generations: 4,
  form: 'tree',
  line: null,
  from: null,
  to: null,
  unrelated: false,
  title: '',
  paper: 'a3-landscape',
  living: 'reduced',
};

/**
 * A Chart's address: #chart/descendants/person|family/<id> or #chart/house/<id>, then its options.
 * @param {string} h
 * @returns {Route}
 */
function parseChartRoute(h) {
  const [path, query = ''] = h.split('?');
  const m = new RegExp(`^chart/(?:descendants/(person|family)|(house))/(${ID})$`, 'i').exec(path);
  if (!m) return { screen: 'home' };
  const q = new URLSearchParams(query);
  const year = (/** @type {string | null} */ v) => (v !== null && /^\d{1,4}$/.test(v) ? Number(v) : null);
  const id = (/** @type {string | null} */ v) => (v !== null && new RegExp(`^${ID}$`, 'i').test(v) ? v.toLowerCase() : null);
  const generations = Number(q.get('generations') ?? CHART_DEFAULTS.generations);
  const paper = q.get('paper') ?? '';
  return {
    screen: 'chart',
    chart: {
      kind: m[2] ? 'house' : 'descendants',
      start: m[2] ? 'house' : m[1].toLowerCase() === 'family' ? 'family' : 'person',
      id: m[3].toLowerCase(),
      generations: Number.isInteger(generations) && generations >= 2 && generations <= 8 ? generations : CHART_DEFAULTS.generations,
      form: q.get('form') === 'line' ? 'line' : 'tree',
      line: id(q.get('line')),
      from: year(q.get('from')),
      to: year(q.get('to')),
      unrelated: q.get('unrelated') === '1',
      title: (q.get('title') ?? '').slice(0, 200),
      paper: /** @type {ChartRoute['paper']} */ (PAPERS.includes(paper) ? paper : CHART_DEFAULTS.paper),
      living: q.get('living') === 'nameless' ? 'nameless' : 'reduced',
    },
  };
}

/**
 * The address of a Chart: the options in a fixed order (sorted keys), and those at their default left out.
 * @param {Pick<ChartRoute, 'kind' | 'start' | 'id'> & Partial<ChartRoute>} c
 */
export function chartAddress(c) {
  const o = { ...CHART_DEFAULTS, ...c };
  const path = o.kind === 'house' ? `chart/house/${o.id}` : `chart/descendants/${o.start}/${o.id}`;
  /** @type {Record<string, string>} */
  const params = {};
  if (o.kind === 'descendants') {
    if (o.form === 'line') params.form = 'line';
    if (o.form === 'tree' && o.generations !== CHART_DEFAULTS.generations) params.generations = String(o.generations);
    if (o.line !== null) params.line = o.line;
  } else {
    if (o.from !== null) params.from = String(o.from);
    if (o.to !== null) params.to = String(o.to);
    if (o.unrelated) params.unrelated = '1';
  }
  if (o.title !== '') params.title = o.title;
  if (o.paper !== CHART_DEFAULTS.paper) params.paper = o.paper;
  if (o.living !== CHART_DEFAULTS.living) params.living = o.living;
  const keys = Object.keys(params).sort();
  const query = keys.map((k) => `${k}=${encodeURIComponent(params[k])}`).join('&');
  return `#${path}${query ? `?${query}` : ''}`;
}

/**
 * The API query of a Chart: what decides its model, without the title and the paper.
 * @param {ChartRoute} c
 * @param {'reduced' | 'nameless' | null} sheet
 */
export function chartQuery(c, sheet) {
  /** @type {string[]} */
  const q = [];
  if (c.kind === 'house') {
    if (c.from !== null) q.push(`from=${c.from}`);
    if (c.to !== null) q.push(`to=${c.to}`);
    if (c.unrelated) q.push('unrelated=true');
  } else {
    q.push(`${c.start}=${c.id}`);
    if (c.form === 'line') q.push('form=line');
    else if (c.generations !== CHART_DEFAULTS.generations) q.push(`generations=${c.generations}`);
    if (c.line !== null) q.push(`line=${c.line}`);
  }
  if (sheet !== null) q.push(`sheet=${sheet}`);
  const path = c.kind === 'house' ? `charts/house/${c.id}` : 'charts/descendants';
  return q.length > 0 ? `${path}?${q.join('&')}` : path;
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
    route.screen === 'leads' ||
    route.screen === 'lead' ||
    route.screen === 'lead-new' ||
    route.screen === 'chart' ||
    (route.screen === 'map' && route.life !== null)
  );
}

/** The address of the tree focused on a Person. @param {string} id */
export const treeAddress = (id) => `#person-${id}`;
/** The address of a person page. @param {string} id */
export const personAddress = (id) => `#people/${id}`;
/** The address of a Research lead. @param {string} id */
export const leadAddress = (id) => `#leads/${id}`;
/** The address of a Person's life path on the map. @param {string} id */
export const lifeAddress = (id) => `#life/${id}`;
