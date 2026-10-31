// Which Person the tree is centred on (the focus Person), and what the device remembers about
// the tree: the last focus and the depth (family-tree spec, "Focus in the address and
// remembered", "The Member's own Person", "Hourglass layout").

const FOCUS_KEY = 'rodokmen.focus';
const DEPTH_KEY = 'rodokmen.depth';
export const DEFAULT_DEPTH = /** @type {const} */ ({ up: 3, down: 2 });
export const MIN_DEPTH = 1;
export const MAX_DEPTH = 6;

/**
 * @typedef {{ kind: 'person', id: string, from: 'address' | 'remembered' | 'own' | 'root' } | { kind: 'search' }} FocusChoice
 */

/**
 * The focus Person, in this order: the one in the address, the one remembered on the device,
 * the Member's own Person, a Family root; with none of these, the tree opens on search.
 * @param {{ address: string | null, remembered: string | null, own: string | null, roots: readonly string[] }} o
 * @returns {FocusChoice}
 */
export function chooseFocus(o) {
  if (o.address) return { kind: 'person', id: o.address, from: 'address' };
  if (o.remembered) return { kind: 'person', id: o.remembered, from: 'remembered' };
  if (o.own) return { kind: 'person', id: o.own, from: 'own' };
  if (o.roots.length > 0) return { kind: 'person', id: o.roots[0], from: 'root' };
  return { kind: 'search' };
}

/**
 * A depth within 1 to 6, else the default.
 * @param {unknown} value
 * @param {number} fallback
 */
export function clampDepth(value, fallback) {
  const n = typeof value === 'number' ? value : Number.NaN;
  return Number.isInteger(n) ? Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, n)) : fallback;
}

/** @param {string} key */
function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** @param {string} key @param {string | null} value */
function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage blocked: remembered for this visit only
  }
}

/** The focus remembered on this device. */
export const rememberedFocus = () => read(FOCUS_KEY);
/** @param {string} id */
export const rememberFocus = (id) => write(FOCUS_KEY, id);

/** @returns {{ up: number, down: number }} */
export function rememberedDepth() {
  try {
    /** @type {unknown} */
    const saved = JSON.parse(read(DEPTH_KEY) ?? 'null');
    if (typeof saved !== 'object' || saved === null) return { ...DEFAULT_DEPTH };
    return { up: clampDepth('up' in saved ? saved.up : null, DEFAULT_DEPTH.up), down: clampDepth('down' in saved ? saved.down : null, DEFAULT_DEPTH.down) };
  } catch {
    return { ...DEFAULT_DEPTH };
  }
}

/** @param {{ up: number, down: number }} depth */
export const rememberDepth = (depth) => write(DEPTH_KEY, JSON.stringify(depth));

/** Forgets the tree's focus on this device (signing out). */
export const forgetFocus = () => write(FOCUS_KEY, null);
