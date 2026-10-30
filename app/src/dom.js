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

/**
 * The element `selector` finds in `root`, checked to be of `type`; throws when
 * index.html has no such element (a broken page should fail loudly at start).
 * @template {Element} E
 * @param {ParentNode} root
 * @param {string} selector
 * @param {new () => E} type
 * @returns {E}
 */
export function required(root, selector, type) {
  const el = root.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`${selector} (${type.name}) is missing from index.html`);
  return el;
}

/**
 * Reports a failure in a status line.
 * @param {HTMLElement} status
 * @returns {(error: unknown) => void}
 */
export function showError(status) {
  return (error) => {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.classList.add('error');
  };
}

/**
 * An event listener that runs an async action and hands any failure to
 * `report`, so a failed action is never silent.
 * @param {(error: unknown) => void} report
 * @param {() => Promise<unknown>} action
 * @returns {() => void}
 */
export function guarded(report, action) {
  return () => {
    action().catch(report);
  };
}
