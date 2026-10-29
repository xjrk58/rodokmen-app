// Formats JSON for hand-edited data files: objects one key per line, but
// arrays of plain values, and objects of plain values that fit in WIDTH
// columns, on one line. Keeps app/data/archives.json readable when
// build-data.mjs rewrites its generated part.

const WIDTH = 160;

/** @param {unknown} value */
const isPlain = (value) => value === null || typeof value !== 'object';

/**
 * @param {unknown} value
 * @param {string} [indent]
 * @returns {string}
 */
export function formatJson(value, indent = '') {
  if (isPlain(value)) return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.every(isPlain)) return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
    return `[\n${value.map((v) => inner + formatJson(v, inner)).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(/** @type {Record<string, unknown>} */ (value));
  if (entries.length === 0) return '{}';
  if (entries.every(([, v]) => isPlain(v))) {
    const line = `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`;
    if (indent.length + line.length <= WIDTH) return line;
  }
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${formatJson(v, inner)}`).join(',\n')}\n${indent}}`;
}
