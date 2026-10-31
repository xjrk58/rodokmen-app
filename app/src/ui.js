// Preact with htm (vendored, no build step) for the family screens: the tree, People, the
// person page, Settings and signing in (add-family-view design). `html` is Preact's `h` bound
// to htm's tagged templates, so components are written as html`<div class=${x}>…</div>`.
// The map, the place sheet and the work panel stay plain DOM (src/dom.js).

import htm from '../vendor/htm/htm.module.js';
import { Fragment, h, render } from '../vendor/preact/preact.module.js';

export { Fragment, h };
export { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from '../vendor/preact/hooks.module.js';

/** @typedef {import('../vendor/preact/preact.module.js').ComponentChildren} Children */
/** @typedef {import('../vendor/preact/preact.module.js').VNode} VNode */

export const html = htm.bind(h);

/**
 * Renders a component tree into a container, replacing what Preact rendered there before.
 * @param {import('../vendor/preact/preact.module.js').ComponentChild} vnode
 * @param {HTMLElement} container
 */
export function mount(vnode, container) {
  render(vnode, container);
}
