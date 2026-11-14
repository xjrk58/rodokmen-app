// Pan and zoom for the screens that draw an SVG the Member moves around: the tree and the Chart.
// One finger or the mouse pans, two fingers pinch, the wheel zooms, and a tap or a long press on
// an element with data-person reaches the screen. The arrow keys pan and + and − zoom.

import { useRef } from './ui.js';

/** @typedef {{ x: number, y: number, k: number }} View */

const LONG_PRESS_MS = 550;
const TAP_SLOP_PX = 8;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;

/** @param {number} k */
const clampZoom = (k) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/**
 * Pan with one finger or the mouse, pinch or wheel to zoom; a tap or a long press on a box.
 * @param {{ view: View, setView: (v: View | ((v: View) => View)) => void, onTap: (id: string, branch: boolean) => void, onLongPress: (id: string) => void }} o
 */
export function useGestures(o) {
  const ref = useRef(
    /** @type {{ pointers: Map<number, { x: number, y: number }>, start: { x: number, y: number } | null, moved: boolean, target: string | null, branch: boolean, timer: ReturnType<typeof setTimeout> | undefined, long: boolean, pinch: number | null }} */ ({
      pointers: new Map(),
      start: null,
      moved: false,
      target: null,
      branch: false,
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
      g.branch = el?.getAttribute('data-branch') === 'true';
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
    if (!g.moved && !g.long && g.target) o.onTap(g.target, g.branch);
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

/** How far an arrow key pans, in screen pixels. */
const KEY_STEP = 60;

/**
 * The keyboard: the arrow keys pan, + and − zoom about the middle (tree-charts spec, "Charts in the app").
 * @param {KeyboardEvent} e
 * @param {(v: View | ((v: View) => View)) => void} setView
 * @param {{ width: number, height: number }} size
 * @returns {boolean} whether the key was used
 */
export function panZoomKey(e, setView, size) {
  const pans = /** @type {Record<string, [number, number]>} */ ({
    ArrowLeft: [KEY_STEP, 0],
    ArrowRight: [-KEY_STEP, 0],
    ArrowUp: [0, KEY_STEP],
    ArrowDown: [0, -KEY_STEP],
  });
  const pan = pans[e.key];
  if (pan) {
    setView((v) => ({ ...v, x: v.x + pan[0], y: v.y + pan[1] }));
    return true;
  }
  const factor = e.key === '+' || e.key === '=' ? 1.25 : e.key === '-' || e.key === '−' ? 0.8 : 0;
  if (factor === 0) return false;
  setView((v) => zoomAt(v, v.k * factor, size.width / 2, size.height / 2));
  return true;
}
