// Loads the public reference data from app/data/.

/** @typedef {import('./types.js').DistrictCollection} DistrictCollection */
/** @typedef {import('./types.js').CountryCollection} CountryCollection */
/** @typedef {import('./types.js').Municipality} Municipality */
/** @typedef {import('./types.js').ArchiveData} ArchiveData */
/** @typedef {import('./types.js').LayersConfig} LayersConfig */

/**
 * @typedef {object} AppData
 * @property {DistrictCollection} districts
 * @property {CountryCollection} country
 * @property {Municipality[]} municipalities
 * @property {ArchiveData} archives
 * @property {LayersConfig} layers
 */

/** @param {string} path */
async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return response.json();
}

/** @returns {Promise<AppData>} */
export async function loadData() {
  const [districts, country, municipalities, archives, layers] = await Promise.all([
    fetchJson('data/districts.geojson'),
    fetchJson('data/country.geojson'),
    fetchJson('data/municipalities.json'),
    fetchJson('data/archives.json'),
    fetchJson('data/layers.json'),
  ]);
  return { districts, country, municipalities, archives, layers };
}
