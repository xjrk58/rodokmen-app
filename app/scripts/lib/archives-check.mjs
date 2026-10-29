// Checks app/data/archives.json against the list of district names.

/**
 * Returns one message per problem; an empty list means every district has
 * exactly one archive and every archive entry is complete.
 * @param {any} data parsed archives.json
 * @param {string[]} districtNames
 * @returns {string[]}
 */
export function checkArchiveCoverage(data, districtNames) {
  const errors = [];
  if (!data || !Array.isArray(data.archives)) return ['archives.json has no "archives" list'];
  const known = new Set(districtNames);
  /** @type {Map<string, string>} */
  const owner = new Map();
  const ids = new Set();
  for (const archive of data.archives) {
    const label = archive?.name ?? archive?.id ?? '(unnamed archive)';
    if (typeof archive.id !== 'string' || !archive.id) errors.push(`${label}: missing id`);
    else if (ids.has(archive.id)) errors.push(`${label}: duplicate id ${archive.id}`);
    else ids.add(archive.id);
    if (typeof archive.name !== 'string' || !archive.name) errors.push(`${label}: missing name`);
    errors.push(...checkPortal(archive, label));
    if (typeof archive.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(archive.color)) errors.push(`${label}: color must be #rrggbb`);
    if (!Array.isArray(archive.districts) || archive.districts.length === 0) {
      errors.push(`${label}: no districts`);
      continue;
    }
    for (const district of archive.districts) {
      if (!known.has(district)) errors.push(`${label}: unknown district "${district}"`);
      if (owner.has(district)) errors.push(`District ${district} is listed under both ${owner.get(district)} and ${label}`);
      else owner.set(district, label);
    }
  }
  for (const district of districtNames) {
    if (!owner.has(district)) errors.push(`District ${district} has no archive`);
  }
  if (!data.jewishRegisters) errors.push('archives.json has no "jewishRegisters" entry');
  else errors.push(...checkPortal(data.jewishRegisters, data.jewishRegisters.name ?? 'jewishRegisters'));
  return errors;
}

/**
 * @param {any} entry
 * @param {string} label
 */
function checkPortal(entry, label) {
  const errors = [];
  if (!entry.portal || typeof entry.portal.url !== 'string' || !/^https:\/\//.test(entry.portal.url)) {
    errors.push(`${label}: portal.url must be an https URL`);
  }
  if (!entry.portal || typeof entry.portal.name !== 'string') errors.push(`${label}: missing portal.name`);
  if (entry.placeSearchUrl !== null && (typeof entry.placeSearchUrl !== 'string' || !entry.placeSearchUrl.includes('{name}'))) {
    errors.push(`${label}: placeSearchUrl must be null or a URL containing {name}`);
  }
  return errors;
}
