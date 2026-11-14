// SVG as a string, for the files a Member downloads and for the golden files (tree-charts spec,
// "Charts follow fixed rules"): an `h` for htm that builds plain nodes, and a writer that puts
// attributes in one fixed order (alphabetical, xmlns first) and escapes text one way, so the same
// Chart gives the same bytes on every device. The template (src/chart-sheet.js) is the one the
// screen draws with Preact's `h`.

/** @typedef {{ tag: string, props: Record<string, unknown>, children: unknown[] }} SvgNode */

/**
 * @param {string} tag
 * @param {Record<string, unknown> | null} props
 * @param {...unknown} children
 * @returns {SvgNode}
 */
export function h(tag, props, ...children) {
  return { tag, props: props ?? {}, children: children.flat(Infinity) };
}

/** @param {string} s */
const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** @param {string} s */
const escapeAttr = (s) => escapeText(s).replace(/"/g, '&quot;');

/** @param {unknown} node @returns {node is SvgNode} */
const isNode = (node) => typeof node === 'object' && node !== null && 'tag' in node && 'props' in node && 'children' in node;

/**
 * Writes a node and everything in it.
 * @param {unknown} node
 * @returns {string}
 */
export function renderSvg(node) {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string') return escapeText(node);
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(renderSvg).join('');
  if (!isNode(node)) return '';
  const names = Object.keys(node.props)
    .filter((k) => k !== 'key' && !k.startsWith('on') && node.props[k] !== null && node.props[k] !== undefined && node.props[k] !== false)
    .sort((a, b) => (a === 'xmlns' ? -1 : b === 'xmlns' ? 1 : a < b ? -1 : a > b ? 1 : 0));
  const attrs = names.map((k) => {
    const v = node.props[k];
    return v === true ? ` ${k}=""` : ` ${k}="${escapeAttr(typeof v === 'number' ? String(v) : String(v))}"`;
  });
  const inner = node.children.map(renderSvg).join('');
  return inner === '' ? `<${node.tag}${attrs.join('')}/>` : `<${node.tag}${attrs.join('')}>${inner}</${node.tag}>`;
}
