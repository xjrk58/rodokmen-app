// Search and nearest-neighbour over the Municipalities in app/data/municipalities.json.

import { haversineKm } from './geo.js';
import { czechCollator, normalize } from './text.js';

/** @typedef {import('./types.js').Municipality} Municipality */

export const MAX_RESULTS = 50;

export class Gazetteer {
  /** @param {Municipality[]} municipalities */
  constructor(municipalities) {
    this.municipalities = municipalities;
  }

  /**
   * Municipalities whose name contains the query, ignoring case and
   * diacritics. Whole-name matches come first, then names that start with
   * the query, then names with a word that starts with it, then the rest.
   * @param {string} query
   * @param {number} [limit]
   * @returns {{ results: Municipality[], total: number }}
   */
  search(query, limit = MAX_RESULTS) {
    const q = normalize(query);
    if (!q) return { results: [], total: 0 };
    /** @type {{ m: Municipality, rank: number }[]} */
    const hits = [];
    for (const m of this.municipalities) {
      const at = m.norm.indexOf(q);
      if (at < 0) continue;
      const rank = m.norm === q ? 0 : at === 0 ? 1 : m.norm[at - 1] === ' ' ? 2 : 3;
      hits.push({ m, rank });
    }
    hits.sort((a, b) => a.rank - b.rank || czechCollator.compare(a.m.name, b.m.name) || czechCollator.compare(a.m.district, b.m.district));
    return { results: hits.slice(0, limit).map((h) => h.m), total: hits.length };
  }

  /**
   * @param {number} lat
   * @param {number} lon
   * @returns {{ municipality: Municipality, km: number } | null}
   */
  nearest(lat, lon) {
    const kx = Math.cos((lat * Math.PI) / 180);
    let best = null;
    let bestD = Infinity;
    for (const m of this.municipalities) {
      const dx = (m.lon - lon) * kx;
      const dy = m.lat - lat;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best ? { municipality: best, km: haversineKm(lat, lon, best.lat, best.lon) } : null;
  }
}
