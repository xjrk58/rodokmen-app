// Small DOM helpers; all text goes in as text nodes, never as HTML.

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, string | boolean | null | undefined>} [attrs]
 * @param {...(Node | string | null | undefined | false)} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    el.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A stroked 24×24 icon from path data.
 * @param {string[]} paths
 */
export function icon(...paths) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export const externalIcon = () => icon('M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5');
export const closeIcon = () => icon('M6 6l12 12M18 6 6 18');

/**
 * A link that opens outside the app (a new browser context), so the map keeps its state.
 * @param {string} href
 * @param {string} text
 * @param {Record<string, string>} [attrs]
 */
export function externalLink(href, text, attrs = {}) {
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer', ...attrs }, h('span', {}, text), externalIcon());
}
