// The tree, the home screen of a signed-in Member (family-tree spec): an SVG hourglass around
// the focus Person, 3 generations up and 2 down unless the Member changes it (1 to 6), with pan
// and pinch-zoom. Tapping a Person makes them the focus; a second tap on the focus Person, or a
// long press on anyone, opens their person page. Moving the focus slides every box to its new
// place, so the Member keeps their bearings.

import { getHourglass } from './api.js';
import { chooseFocus, MAX_DEPTH, MIN_DEPTH, rememberDepth, rememberedDepth, rememberedFocus, rememberFocus } from './focus.js';
import { BOX, layoutHourglass, lifeYears } from './hourglass-layout.js';
import { t } from './i18n.js';
import { PeopleSearch } from './people-screen.js';
import { familyRoots, isShown, relationKnown, relationOf } from './relation.js';
import { personAddress, treeAddress } from './routes.js';
import { AsOf, ErrorLine, useCachedLoad } from './screen-parts.js';
import { html, useEffect, useMemo, useRef, useState } from './ui.js';

/** @typedef {import('./types.js').Me} Me */
/** @typedef {import('./types.js').Hourglass} Hourglass */
/** @typedef {import('./hourglass-layout.js').Layout} Layout */
/** @typedef {import('./hourglass-layout.js').LayoutNode} LayoutNode */
/** @typedef {{ x: number, y: number, k: number }} View */

const LONG_PRESS_MS = 550;
const TAP_SLOP_PX = 8;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;
/** At first the tree is shrunk to fit the screen's width, but never below this. */
const MIN_FIT = 0.72;

/** @param {number} k */
const clampZoom = (k) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/**
 * Where the tree starts: the focus Person in the middle, the ancestors and the focus row as wide
 * as the screen allows (so that 3 generations up fit a phone at full size), and the whole tree
 * in view vertically if it fits. Wider rows of descendants are a pan away.
 * @param {Layout} layout
 * @param {{ width: number, height: number }} size
 * @returns {View}
 */
export function initialView(layout, size) {
  const { minY, maxY } = layout.bounds;
  // The focus Person is centred on x = 0, so the half-width the upper part needs on either side counts.
  const upper = layout.nodes.filter((n) => n.generation >= 0);
  const half = Math.max(BOX.w / 2, ...upper.map((n) => Math.max(-n.x, n.x + BOX.w)));
  const k = Math.min(1, Math.max(MIN_FIT, (size.width - 16) / (2 * half)));
  const height = (maxY - minY) * k;
  const y = height <= size.height - 16 ? (size.height - height) / 2 - minY * k : size.height * 0.55 - (BOX.h / 2) * k;
  return { x: size.width / 2, y, k };
}

/**
 * Name lines for a box: long names are squeezed a little, very long ones cut.
 * @param {string} text
 * @param {number} px font size
 */
function fit(text, px) {
  const room = BOX.w - 12;
  const width = text.length * px * 0.56;
  if (width <= room) return { text, squeeze: null };
  if (width <= room * 1.35) return { text, squeeze: room };
  const keep = Math.floor((room * 1.3) / (px * 0.56)) - 1;
  return { text: `${text.slice(0, keep)}…`, squeeze: room };
}

/**
 * @param {{ node: LayoutNode, focus: boolean, onTap: (id: string) => void }} props
 */
function PersonBox({ node, focus, onTap }) {
  const p = node.person;
  const given = fit(p.given || p.displayName, 12);
  const surname = fit(p.surname, 12);
  const years = [lifeYears(p), p.living ? t('tree.living') : ''].filter(Boolean).join(' · ');
  const possible = relationOf(p) === 'possible';
  const label = [
    p.displayName,
    lifeYears(p),
    p.living ? t('person.living') : '',
    possible ? t('person.possible') : '',
    focus ? t('tree.openPage') : t('tree.makeFocus'),
  ]
    .filter(Boolean)
    .join(', ');
  const classes = ['tree-node', node.kind, p.sex, p.living ? 'living' : '', possible ? 'possible' : '', focus ? 'is-focus' : ''].filter(Boolean).join(' ');
  return html`<g
    class=${classes}
    data-person=${node.id}
    data-testid="tree-person"
    style=${`transform: translate(${node.x}px, ${node.y}px)`}
    role="button"
    tabindex="0"
    aria-label=${label}
    onKeyDown=${(/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onTap(node.id);
      }
    }}
  >
    <rect class="box" width=${BOX.w} height=${BOX.h} rx="8" />
    <text x="6" y="16" class="given" textLength=${given.squeeze ?? undefined} lengthAdjust="spacingAndGlyphs">${given.text}</text>
    <text x="6" y="30" class="surname" textLength=${surname.squeeze ?? undefined} lengthAdjust="spacingAndGlyphs">${surname.text}</text>
    <text x="6" y="44" class="years">${years}</text>
    ${node.moreAbove ? html`<path class="more" data-testid="more-above" d=${`M${BOX.w - 15} 11l5 -5l5 5`} />` : null}
    ${node.moreBelow ? html`<path class="more" data-testid="more-below" d=${`M${BOX.w - 15} ${BOX.h - 11}l5 5l5 -5`} />` : null}
  </g>`;
}

/**
 * Pan with one finger or the mouse, pinch or wheel to zoom; a tap or a long press on a box.
 * @param {{ view: View, setView: (v: View | ((v: View) => View)) => void, onTap: (id: string) => void, onLongPress: (id: string) => void }} o
 */
function useGestures(o) {
  const ref = useRef(
    /** @type {{ pointers: Map<number, { x: number, y: number }>, start: { x: number, y: number } | null, moved: boolean, target: string | null, timer: ReturnType<typeof setTimeout> | undefined, long: boolean, pinch: number | null }} */ ({
      pointers: new Map(),
      start: null,
      moved: false,
      target: null,
      timer: undefined,
      long: false,
      pinch: null,
    }),
  );
  const g = ref.current;
  const { setView } = o;

  /** @param {PointerEvent} e */
  const down = (e) => {
    const svg = /** @type {SVGSVGElement} */ (e.currentTarget);
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      // a pointer the browser no longer tracks: nothing to capture
    }
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.pointers.size === 1) {
      const el = e.target instanceof Element ? e.target.closest('[data-person]') : null;
      g.target = el?.getAttribute('data-person') ?? null;
      g.start = { x: e.clientX, y: e.clientY };
      g.moved = false;
      g.long = false;
      clearTimeout(g.timer);
      if (g.target) {
        const id = g.target;
        g.timer = setTimeout(() => {
          if (!g.moved) {
            g.long = true;
            o.onLongPress(id);
          }
        }, LONG_PRESS_MS);
      }
    } else {
      g.moved = true;
      clearTimeout(g.timer);
      const [a, b] = [...g.pointers.values()];
      g.pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  /** @param {PointerEvent} e */
  const move = (e) => {
    const last = g.pointers.get(e.pointerId);
    if (!last) return;
    const box = /** @type {SVGSVGElement} */ (e.currentTarget).getBoundingClientRect();
    if (g.pointers.size === 1) {
      if (g.start && Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) > TAP_SLOP_PX) {
        g.moved = true;
        clearTimeout(g.timer);
      }
      if (g.moved) {
        const dx = e.clientX - last.x;
        const dy = e.clientY - last.y;
        setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
      }
      g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      return;
    }
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...g.pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const ratio = g.pinch ? distance / g.pinch : 1;
    g.pinch = distance;
    const cx = (a.x + b.x) / 2 - box.left;
    const cy = (a.y + b.y) / 2 - box.top;
    setView((v) => zoomAt(v, v.k * ratio, cx, cy));
  };

  /** @param {PointerEvent} e */
  const up = (e) => {
    g.pointers.delete(e.pointerId);
    if (g.pointers.size > 0) return;
    clearTimeout(g.timer);
    g.pinch = null;
    if (!g.moved && !g.long && g.target) o.onTap(g.target);
    g.target = null;
  };

  /** @param {PointerEvent} e */
  const cancel = (e) => {
    g.pointers.delete(e.pointerId);
    clearTimeout(g.timer);
    g.target = null;
  };

  /** @param {WheelEvent} e */
  const wheel = (e) => {
    e.preventDefault();
    const box = /** @type {SVGSVGElement} */ (e.currentTarget).getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * 0.0015);
    setView((v) => zoomAt(v, v.k * factor, e.clientX - box.left, e.clientY - box.top));
  };

  return { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: cancel, onWheel: wheel };
}

/**
 * Zooms the view to `k`, keeping the point (cx, cy) of the screen where it is.
 * @param {View} v
 * @param {number} k
 * @param {number} cx
 * @param {number} cy
 * @returns {View}
 */
export function zoomAt(v, k, cx, cy) {
  const next = clampZoom(k);
  return { k: next, x: cx - ((cx - v.x) * next) / v.k, y: cy - ((cy - v.y) * next) / v.k };
}

/**
 * @param {{ label: string, value: number, testid: string, onChange: (n: number) => void }} props
 */
function Stepper({ label, value, testid, onChange }) {
  return html`<div class="stepper" role="group" aria-label=${label}>
    <span class="stepper-label" aria-hidden="true">${label}</span>
    <button
      type="button"
      class="icon-button small"
      aria-label=${t('tree.fewer', { what: label })}
      disabled=${value <= MIN_DEPTH}
      data-testid=${`${testid}-less`}
      onClick=${() => onChange(value - 1)}
    >
      −
    </button>
    <output data-testid=${`${testid}-value`} aria-live="polite">${value}</output>
    <button
      type="button"
      class="icon-button small"
      aria-label=${t('tree.more', { what: label })}
      disabled=${value >= MAX_DEPTH}
      data-testid=${`${testid}-more`}
      onClick=${() => onChange(value + 1)}
    >
      +
    </button>
  </div>`;
}

/**
 * @param {{ data: Hourglass, depthKey: string }} props
 */
function TreeCanvas({ data, depthKey }) {
  const svgRef = useRef(/** @type {SVGSVGElement | null} */ (null));
  const [includeUnrelated, setIncludeUnrelated] = useState(false);
  const layout = useMemo(
    () => layoutHourglass({ ...data, persons: data.persons.filter((p) => p.relation === 'focus' || isShown(p.person, includeUnrelated)) }),
    [data, includeUnrelated],
  );
  const [view, setView] = useState(/** @type {View} */ ({ x: 0, y: 0, k: 1 }));
  const [ready, setReady] = useState(false);

  const fitView = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    setView(initialView(layout, { width: r.width, height: r.height }));
  };
  // A new focus or depth centres the tree again; the move animates (CSS transitions), but not the first placement.
  useEffect(() => {
    fitView();
    if (!ready) requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
  }, [data.focusId, depthKey, layout]);

  const tap = (/** @type {string} */ id) => {
    location.hash = id === data.focusId ? personAddress(id) : treeAddress(id);
  };
  const gestures = useGestures({ view, setView, onTap: tap, onLongPress: (id) => (location.hash = personAddress(id)) });
  const zoomBy = (/** @type {number} */ f) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (r) setView((v) => zoomAt(v, v.k * f, r.width / 2, r.height / 2));
  };

  return html`<div class="tree-area">
    <svg
      ref=${svgRef}
      class=${`tree-canvas${ready ? ' ready' : ''}`}
      data-testid="tree"
      data-focus=${data.focusId}
      aria-label=${t('tree.label')}
      ...${gestures}
    >
      <g class="tree-view" style=${`transform: translate(${view.x}px, ${view.y}px) scale(${view.k})`}>
        <g class="tree-lines" key=${`${data.focusId}:${depthKey}:${String(includeUnrelated)}`}>
          ${layout.lines.map(
            (l) =>
              html`<path
                key=${l.key}
                d=${l.d}
                class=${`line ${l.kind}${l.linkType && l.linkType !== 'birth' ? ' dashed' : ''}`}
                data-link=${l.linkType ?? undefined}
              />`,
          )}
        </g>
        ${layout.nodes.map((n) => html`<${PersonBox} key=${n.id} node=${n} focus=${n.id === data.focusId} onTap=${tap} />`)}
      </g>
    </svg>
    <div class="zoom-buttons">
      <button type="button" class="round-button" aria-label=${t('tree.zoomIn')} data-testid="zoom-in" onClick=${() => zoomBy(1.25)}>+</button>
      <button type="button" class="round-button" aria-label=${t('tree.zoomOut')} data-testid="zoom-out" onClick=${() => zoomBy(0.8)}>−</button>
      <button type="button" class="round-button" aria-label=${t('tree.fit')} data-testid="zoom-fit" onClick=${fitView}>⤢</button>
    </div>
    ${layout.otherParents.map(
      (o) =>
        html`<p class="other-parents" data-testid="other-parents">
          ${t(`tree.otherParents.${o.linkType}`)}: ${o.parents.map((p, i) => html`${i ? ' & ' : ''}<a href=${treeAddress(p.id)}>${p.displayName}</a>`)}
        </p>`,
    )}
    ${
      relationKnown(data.persons.map((p) => p.person))
        ? html`<label class="switch-row unrelated-switch"
            ><input
              type="checkbox"
              checked=${includeUnrelated}
              onChange=${(/** @type {Event} */ e) => setIncludeUnrelated(/** @type {HTMLInputElement} */ (e.currentTarget).checked)}
            /><span>${t('people.includeUnrelated')}</span></label
          >`
        : null
    }
  </div>`;
}

/**
 * @param {{ me: Me, focus: string | null, cache: boolean }} props
 */
export function TreeScreen({ me, focus, cache }) {
  const [depth, setDepth] = useState(rememberedDepth);
  const choice = chooseFocus({ address: focus, remembered: rememberedFocus(), own: me.person?.id ?? null, roots: familyRoots(me) });
  const focusId = choice.kind === 'person' ? choice.id : null;

  useEffect(() => {
    if (choice.kind !== 'person') return;
    rememberFocus(choice.id);
    // The focus is always in the address, also when it came from the device or the Member's own Person.
    if (choice.from !== 'address') history.replaceState(null, '', treeAddress(choice.id));
  }, [focusId]);

  const depthKey = `${depth.up}:${depth.down}`;
  const loaded = useCachedLoad(
    focusId ? `hourglass:${focusId}:${depthKey}` : null,
    (signal) => getHourglass(/** @type {string} */ (focusId), depth, signal),
    cache,
  );
  const changeDepth = (/** @type {'up' | 'down'} */ which, /** @type {number} */ n) => {
    const next = { ...depth, [which]: n };
    setDepth(next);
    rememberDepth(next);
  };

  const toolbar = html`<header class="screen-head tree-head">
    ${me.person ? html`<a class="button small" href=${treeAddress(me.person.id)} data-testid="me-button">${t('tree.me')}</a>` : null}
    <${Stepper} label=${t('tree.up')} value=${depth.up} testid="depth-up" onChange=${(/** @type {number} */ n) => changeDepth('up', n)} />
    <${Stepper} label=${t('tree.down')} value=${depth.down} testid="depth-down" onChange=${(/** @type {number} */ n) => changeDepth('down', n)} />
    <a class="icon-link" href="#people" aria-label=${t('tree.find')} title=${t('tree.find')} data-testid="tree-find">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m15.5 15.5 5 5" />
      </svg>
    </a>
  </header>`;

  if (choice.kind === 'search') {
    return html`<section class="screen-body tree-start" data-testid="tree-start">
      <h1>${t('tree.startTitle')}</h1>
      <p class="muted">${t('tree.startText')}</p>
      <${PeopleSearch} cache=${cache} />
    </section>`;
  }
  // While another focus loads, the tree shown stays, so that it can move to the new one.
  const data = loaded.data;
  return html`<section class="tree-screen" data-testid="tree-screen">
    ${toolbar}
    <${AsOf} asOf=${loaded.asOf} />
    <${ErrorLine} error=${loaded.error} />
    ${data ? html`<${TreeCanvas} data=${data} depthKey=${depthKey} />` : loaded.error ? null : html`<p class="empty">${t('work.loading')}</p>`}
  </section>`;
}
