// Checks app/data/archives.json against the list of district names, and the
// URLs of app/data/layers.json. Both files are edited by hand, so they are
// read as unknown JSON and every field is checked.

/**
 * A property of a JSON value, unchecked.
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown}
 */
const prop = (value, key) => (typeof value === 'object' && value !== null ? /** @type {Record<string, unknown>} */ (value)[key] : undefined);

/** @param {unknown} value @returns {value is string} */
const isText = (value) => typeof value === 'string' && value !== '';

/** @param {unknown} value */
const isHttps = (value) => typeof value === 'string' && /^https:\/\//.test(value);

/** @param {unknown} value @returns {unknown[]} */
const list = (value) => (Array.isArray(value) ? value : []);

/**
 * How an entry is named in messages.
 * @param {unknown} entry
 * @param {string} fallback
 */
const labelOf = (entry, fallback) => {
  const name = prop(entry, 'name');
  const id = prop(entry, 'id');
  return isText(name) ? name : isText(id) ? id : fallback;
};

/**
 * Returns one message per problem; an empty list means every district has
 * exactly one archive and every archive entry is complete.
 * @param {unknown} data parsed archives.json
 * @param {string[]} districtNames
 * @returns {string[]}
 */
export function checkArchiveCoverage(data, districtNames) {
  const archives = prop(data, 'archives');
  if (!Array.isArray(archives)) return ['archives.json has no "archives" list'];
  /** @type {string[]} */
  const errors = [];
  const known = new Set(districtNames);
  /** @type {Map<string, string>} */
  const owner = new Map();
  /** @type {Set<string>} */
  const ids = new Set();
  for (const archive of archives) {
    const label = labelOf(archive, '(unnamed archive)');
    errors.push(...checkArchive(archive, label, ids));
    const districts = prop(archive, 'districts');
    if (!Array.isArray(districts) || districts.length === 0) {
      errors.push(`${label}: no districts`);
      continue;
    }
    for (const district of districts) {
      const name = String(district);
      if (!known.has(name)) errors.push(`${label}: unknown district "${name}"`);
      const previous = owner.get(name);
      if (previous !== undefined) errors.push(`District ${name} is listed under both ${previous} and ${label}`);
      else owner.set(name, label);
    }
  }
  for (const district of districtNames) {
    if (!owner.has(district)) errors.push(`District ${district} has no archive`);
  }
  if (prop(data, 'municipalityOverrides') !== undefined) errors.push(...checkOverrides(data));
  const jewish = prop(data, 'jewishRegisters');
  if (!jewish) errors.push('archives.json has no "jewishRegisters" entry');
  else errors.push(...checkPortal(jewish, labelOf(jewish, 'jewishRegisters')));
  return errors;
}

/**
 * The fields of one archive entry other than its districts.
 * @param {unknown} archive
 * @param {string} label
 * @param {Set<string>} ids ids seen so far; this one is added
 */
function checkArchive(archive, label, ids) {
  const errors = [];
  const id = prop(archive, 'id');
  if (!isText(id)) errors.push(`${label}: missing id`);
  else if (ids.has(id)) errors.push(`${label}: duplicate id ${id}`);
  else ids.add(id);
  if (!isText(prop(archive, 'name'))) errors.push(`${label}: missing name`);
  errors.push(...checkPortal(archive, label));
  const color = prop(archive, 'color');
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) errors.push(`${label}: color must be #rrggbb`);
  return errors;
}

/**
 * @param {unknown} entry
 * @param {string} label
 */
function checkPortal(entry, label) {
  const errors = [];
  const portal = prop(entry, 'portal');
  if (!isHttps(prop(portal, 'url'))) errors.push(`${label}: portal.url must be an https URL`);
  if (typeof prop(portal, 'name') !== 'string') errors.push(`${label}: missing portal.name`);
  const search = prop(entry, 'placeSearchUrl');
  if (search !== null && (typeof search !== 'string' || !search.includes('{name}'))) {
    errors.push(`${label}: placeSearchUrl must be null or a URL containing {name}`);
  }
  return errors;
}

/**
 * Each override names an archive id and a district of that archive.
 * @param {unknown} data
 */
function checkOverrides(data) {
  const overrides = prop(data, 'municipalityOverrides');
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return ['municipalityOverrides must be an object keyed by municipality code'];
  const errors = [];
  /** @type {Map<unknown, unknown>} */
  const byId = new Map(list(prop(data, 'archives')).map((a) => [prop(a, 'id'), a]));
  for (const [code, o] of Object.entries(overrides)) {
    const name = prop(o, 'name');
    const label = `Override ${code} (${isText(name) ? name : '?'})`;
    if (!/^\d+$/.test(code)) errors.push(`${label}: key must be a municipality code`);
    const archiveId = prop(o, 'archive');
    const archive = byId.get(archiveId);
    const district = String(prop(o, 'district'));
    if (!archive) errors.push(`${label}: unknown archive "${String(archiveId)}"`);
    else if (!list(prop(archive, 'districts')).includes(district))
      errors.push(`${label}: district "${district}" is not a district of ${labelOf(archive, '?')}`);
    if (!isText(prop(o, 'reason'))) errors.push(`${label}: missing reason`);
  }
  return errors;
}

/**
 * The URLs of layers.json: the base map, every overlay and every viewer must
 * be https (the app is served over https, and a page must not load map images
 * or open viewers over plain http).
 * @param {unknown} data parsed layers.json
 * @returns {string[]}
 */
export function checkLayers(data) {
  const errors = [];
  if (!isHttps(prop(prop(data, 'base'), 'url'))) errors.push('base.url must be an https URL');
  for (const kind of ['overlay', 'viewer']) {
    const entries = prop(data, `${kind}s`);
    if (!Array.isArray(entries)) {
      errors.push(`layers.json has no "${kind}s" list`);
      continue;
    }
    for (const entry of entries) if (!isHttps(prop(entry, 'url'))) errors.push(`${kind} ${labelOf(entry, '(no id)')}: url must be an https URL`);
  }
  return errors;
}
