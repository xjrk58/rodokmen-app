// The Chart screen (tree-charts spec, "Charts in the app", "Printing and downloading a Sheet"):
// a Descendant chart or a House chart, drawn from the server's model by the layouts and the one
// template of src/chart-sheet.js, with pan and zoom by touch, mouse and keyboard. A tap on a card
// opens the person page; the mark under a Person whose descendants are left out, or a long press,
// opens a Chart from them. The address holds the kind, start and options, so a link opens the
// same Chart for another Member. Both variants are kept on the device: the screen's, and the
// Sheet's for printing and downloads, so a Chart viewed before prints offline.

import { api, ApiError } from './api.js';
import { loadFontCss, loadMetrics } from './chart-fonts.js';
import { layoutHouse } from './chart-house-layout.js';
import { layoutLine } from './chart-line-layout.js';
import { paginate, paperSize } from './chart-pages.js';
import { chartBody, naturalSize, sheet, sheetFile } from './chart-sheet.js';
import { chartLabels, defaultTitle } from './chart-text.js';
import { layoutTree } from './chart-tree-layout.js';
import { rememberedFocus } from './focus.js';
import { currentTexts, language, t } from './i18n.js';
import { panZoomKey, useGestures, zoomAt } from './pan-zoom.js';
import { chartAddress, chartQuery, personAddress } from './routes.js';
import { AsOf, ErrorLine, useCachedLoad } from './screen-parts.js';
import { h, html, mount, useEffect, useMemo, useRef, useState } from './ui.js';

/** @typedef {import('./routes.js').ChartRoute} ChartRoute */
/** @typedef {import('./types.js').ChartModel} ChartModel */
/** @typedef {import('./types.js').Me} Me */
/** @typedef {import('./pan-zoom.js').View} View */
/** @typedef {import('./chart-cards.js').FontMetrics} FontMetrics */
/** @typedef {import('./chart-tree-layout.js').ChartLayout} ChartLayout */

/** Preact's `h`, for the template that also writes strings (src/chart-sheet.js). */
const svgH = /** @type {import('./chart-sheet.js').H} */ (/** @type {unknown} */ (h));

/** Names on screen are at least this many pixels high when the whole Chart is in view. */
const READABLE_PX = 9;
/** A PNG: at most 16 megapixels and 8,192 pixels on the longer side (phone canvas limits), 150 dpi at best. */
const PNG = { pixels: 16_000_000, side: 8192, perUnit: 150 / 254 };

/**
 * The layout of a whole Chart, unsplit.
 * @param {ChartModel} model
 * @param {FontMetrics} metrics
 * @param {import('./chart-text.js').ChartLabels} labels
 * @returns {ChartLayout}
 */
export function layoutChart(model, metrics, labels) {
  if (model.kind === 'house') return layoutHouse(model, metrics, labels);
  return model.form === 'line' ? layoutLine(model, metrics, labels) : layoutTree(model, metrics, labels);
}

/**
 * Where the Chart starts on screen: the whole Chart when its names stay readable, else the top
 * rows across the screen's width at a readable size, the top in view.
 * @param {ChartLayout} layout
 * @param {{ width: number, height: number }} size
 * @returns {View}
 */
export function firstView(layout, size) {
  const whole = Math.min((size.width - 16) / Math.max(1, layout.width), (size.height - 16) / Math.max(1, layout.height));
  if (whole * 32 >= READABLE_PX) return { k: Math.min(1, whole), x: (size.width - layout.width * Math.min(1, whole)) / 2, y: 8 };
  // The first row: its cards across the screen's width, at a readable size at least.
  const top = layout.cards.filter((c) => c.y < 300);
  const left = Math.min(...top.map((c) => c.x));
  const topWidth = Math.max(1, Math.max(...top.map((c) => c.x + c.w)) - left);
  const k = Math.max(READABLE_PX / 32, Math.min(1, (size.width - 16) / topWidth));
  return { k, x: (size.width - topWidth * k) / 2 - left * k, y: 8 };
}

/** @param {string} name */
function download(name, /** @type {Blob} */ blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** A file name from a title. @param {string} title */
const fileName = (title) =>
  title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'chart';

/**
 * Draws an SVG file into a PNG within the canvas limits; says when it had to shrink below 150 dpi.
 * @param {string} svg
 * @param {{ w: number, h: number }} size in tenths of a millimetre
 * @returns {Promise<{ blob: Blob, shrunk: boolean }>}
 */
async function pngOf(svg, size) {
  const k = Math.min(PNG.perUnit, PNG.side / Math.max(size.w, size.h), Math.sqrt(PNG.pixels / (size.w * size.h)));
  const width = Math.floor(size.w * k);
  const height = Math.floor(size.h * k);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No canvas');
    ctx.drawImage(img, 0, 0, width, height);
    /** @type {Blob} */
    const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No PNG'))), 'image/png'));
    return { blob, shrunk: k < PNG.perUnit };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * @param {{ layout: ChartLayout, onTap: (id: string, branch: boolean) => void, onLongPress: (id: string) => void, viewKey: string }} props
 */
function ChartCanvas({ layout, onTap, onLongPress, viewKey }) {
  const svgRef = useRef(/** @type {SVGSVGElement | null} */ (null));
  const [view, setView] = useState(/** @type {View} */ ({ x: 0, y: 0, k: 1 }));
  const size = () => {
    const r = svgRef.current?.getBoundingClientRect();
    return { width: r?.width ?? 390, height: r?.height ?? 600 };
  };
  useEffect(() => setView(firstView(layout, size())), [viewKey, layout]);
  // The fit button shows the whole Chart, however small.
  const fitView = () => {
    const s = size();
    const k = Math.min(1, (s.width - 16) / Math.max(1, layout.width), (s.height - 16) / Math.max(1, layout.height));
    setView({ k, x: (s.width - layout.width * k) / 2, y: (s.height - layout.height * k) / 2 });
  };
  const gestures = useGestures({ view, setView, onTap, onLongPress });
  const zoomBy = (/** @type {number} */ f) => {
    const s = size();
    setView((v) => zoomAt(v, v.k * f, s.width / 2, s.height / 2));
  };
  return html`<div class="chart-area">
    <svg
      ref=${svgRef}
      class="chart-canvas"
      data-testid="chart"
      tabindex="0"
      aria-label=${t('chart.label')}
      onKeyDown=${(/** @type {KeyboardEvent} */ e) => {
        if (panZoomKey(e, setView, size())) e.preventDefault();
      }}
      ...${gestures}
    >
      <g class="chart-view" style=${`transform: translate(${view.x}px, ${view.y}px) scale(${view.k})`}>${chartBody(svgH, layout)}</g>
    </svg>
    <div class="zoom-buttons">
      <button type="button" class="round-button" aria-label=${t('tree.zoomIn')} data-testid="zoom-in" onClick=${() => zoomBy(1.25)}>+</button>
      <button type="button" class="round-button" aria-label=${t('tree.zoomOut')} data-testid="zoom-out" onClick=${() => zoomBy(0.8)}>−</button>
      <button type="button" class="round-button" aria-label=${t('tree.fit')} data-testid="zoom-fit" onClick=${fitView}>⤢</button>
    </div>
  </div>`;
}

/**
 * The options of a Chart; each change is a new address.
 * @param {{ chart: ChartRoute, model: ChartModel | null, me: Me, title: string }} props
 */
function Options({ chart, model, me, title }) {
  const go = (/** @type {Partial<ChartRoute>} */ change) => (location.hash = chartAddress({ ...chart, ...change }));
  const value = (/** @type {Event} */ e) => /** @type {HTMLInputElement | HTMLSelectElement} */ (e.currentTarget).value;
  const [from, setFrom] = useState(chart.from === null ? '' : String(chart.from));
  const [to, setTo] = useState(chart.to === null ? '' : String(chart.to));
  const persons = model?.persons ?? [];
  const nameOf = (/** @type {string} */ id) => {
    const p = persons.find((x) => x.id === id);
    return p ? `${p.given} ${p.surname}`.trim() : '';
  };
  const focus = rememberedFocus();
  const own = me.person?.id ?? null;
  const offered = [
    own ? { id: own, label: t('chart.line.me', { name: nameOf(own) || me.person?.displayName || '…' }) } : null,
    focus && focus !== own ? { id: focus, label: t('chart.line.focus', { name: nameOf(focus) || '…' }) } : null,
  ].filter((o) => o !== null);
  const descendants = model?.kind === 'descendants' ? model.nodes.filter((n) => !n.pointer && n.followed && n.generation > 1).map((n) => n.personId) : [];
  return html`<details class="chart-options" data-testid="chart-options">
    <summary>${t('chart.options')}</summary>
    ${
      chart.kind === 'descendants'
        ? html`<div class="field-row">
              <span>${t('chart.form')}</span>
              <label
                ><input type="radio" name="form" checked=${chart.form === 'tree'} data-testid="form-tree" onChange=${() => go({ form: 'tree' })} />
                ${t('chart.form.tree')}</label
              >
              <label
                ><input
                  type="radio"
                  name="form"
                  checked=${chart.form === 'line'}
                  disabled=${chart.line === null}
                  data-testid="form-line"
                  onChange=${() => go({ form: 'line' })}
                />
                ${t('chart.form.line')}</label
              >
            </div>
            ${
              chart.form === 'tree'
                ? html`<div class="field-row" role="group" aria-label=${t('chart.generations')}>
                    <span>${t('chart.generations')}</span>
                    <button
                      type="button"
                      class="icon-button small"
                      disabled=${chart.generations <= 2}
                      data-testid="generations-less"
                      onClick=${() => go({ generations: chart.generations - 1 })}
                    >
                      −
                    </button>
                    <output data-testid="generations-value">${chart.generations}</output>
                    <button
                      type="button"
                      class="icon-button small"
                      disabled=${chart.generations >= 8}
                      data-testid="generations-more"
                      onClick=${() => go({ generations: chart.generations + 1 })}
                    >
                      +
                    </button>
                  </div>`
                : null
            }
            <label class="field"
              >${t('chart.line')}
              <select data-testid="line-picker" onChange=${(/** @type {Event} */ e) => go({ line: value(e) || null, form: value(e) ? chart.form : 'tree' })}>
                <option value="" selected=${chart.line === null}>${t('chart.line.none')}</option>
                ${offered.map((o) => html`<option value=${o.id} selected=${chart.line === o.id} data-testid="line-offered">${o.label}</option>`)}
                ${descendants
                  .filter((id) => !offered.some((o) => o.id === id))
                  .map((id) => html`<option value=${id} selected=${chart.line === id}>${nameOf(id)}</option>`)}
              </select></label
            >`
        : html`<label class="switch-row"
              ><input type="checkbox" checked=${chart.unrelated} data-testid="chart-unrelated" onChange=${() => go({ unrelated: !chart.unrelated })} /><span
                >${t('chart.unrelated')}</span
              ></label
            >
            <div class="field-row">
              <span>${t('chart.period')}</span>
              <input
                type="number"
                inputmode="numeric"
                aria-label=${t('chart.period.from')}
                placeholder=${t('chart.period.from')}
                value=${from}
                data-testid="period-from"
                onInput=${(/** @type {Event} */ e) => setFrom(value(e))}
              />
              <input
                type="number"
                inputmode="numeric"
                aria-label=${t('chart.period.to')}
                placeholder=${t('chart.period.to')}
                value=${to}
                data-testid="period-to"
                onInput=${(/** @type {Event} */ e) => setTo(value(e))}
              />
              <button
                type="button"
                class="button"
                data-testid="period-apply"
                onClick=${() => go({ from: from ? Number(from) : null, to: to ? Number(to) : null })}
              >
                ${t('chart.period.apply')}
              </button>
            </div>`
    }
    <label class="field"
      >${t('chart.title')}
      <input
        type="text"
        maxlength="200"
        value=${chart.title}
        placeholder=${title}
        data-testid="chart-title-input"
        onChange=${(/** @type {Event} */ e) => go({ title: value(e).trim() })}
    /></label>
    <label class="field"
      >${t('chart.paper')}
      <select data-testid="paper" onChange=${(/** @type {Event} */ e) => go({ paper: /** @type {ChartRoute['paper']} */ (value(e)) })}>
        ${['a3-landscape', 'a3-portrait', 'a4-landscape', 'a4-portrait'].map((p) => html`<option value=${p} selected=${chart.paper === p}>${t(`chart.paper.${p}`)}</option>`)}
      </select></label
    >
    <div class="field-row">
      <span>${t('chart.sheetLiving')}</span>
      <label
        ><input type="radio" name="living" checked=${chart.living === 'reduced'} data-testid="living-reduced" onChange=${() => go({ living: 'reduced' })} />
        ${t('chart.sheetLiving.reduced')}</label
      >
      <label
        ><input type="radio" name="living" checked=${chart.living === 'nameless'} data-testid="living-nameless" onChange=${() => go({ living: 'nameless' })} />
        ${t('chart.sheetLiving.nameless')}</label
      >
    </div>
  </details>`;
}

/** What the server said about a Chart, above it. @param {{ model: ChartModel, chart: ChartRoute, labels: import('./chart-text.js').ChartLabels }} props */
function Notes({ model, chart, labels }) {
  if (model.kind === 'house') {
    return html`${
      model.needsPeriod
        ? html`<p class="notice" data-testid="needs-period">
            ${t('chart.needsPeriod', { count: model.total, first: model.firstYear ?? '?', last: model.lastYear ?? '?' })}
          </p>`
        : null
    }
    ${model.hiddenUnrelated > 0 ? html`<p class="small muted" data-testid="hidden-unrelated">${t('chart.hiddenUnrelated', { count: model.hiddenUnrelated })}</p>` : null}`;
  }
  return html`${
    model.shown < model.generations && model.form === 'tree'
      ? html`<p class="notice" data-testid="chart-cut">
          ${t('chart.cut', { shown: model.shown, generations: model.generations })}
          ${t('chart.leftOutTotal', { count: labels.count('chart.leftOut', model.leftOut) })}
        </p>`
      : null
  }
  ${
    model.lineBeyond
      ? html`<p class="notice" data-testid="line-beyond">
          ${t('chart.lineBeyond')} <a href=${chartAddress({ ...chart, form: 'line' })} data-testid="show-line">${t('chart.showLine')}</a>
        </p>`
      : null
  }`;
}

/**
 * @param {{ me: Me, chart: ChartRoute, cache: boolean }} props
 */
export function ChartScreen({ me, chart, cache }) {
  const query = chartQuery(chart, null);
  const sheetQuery = chartQuery(chart, chart.living);
  const loaded = useCachedLoad(`chart:${query}`, (signal) => /** @type {Promise<ChartModel>} */ (api(query, { signal })), cache);
  // The Sheet's variant, loaded with the Chart so that it prints offline later.
  const sheetLoaded = useCachedLoad(`chart-sheet:${sheetQuery}`, (signal) => /** @type {Promise<ChartModel>} */ (api(sheetQuery, { signal })), cache);
  const [metrics, setMetrics] = useState(/** @type {FontMetrics | null} */ (null));
  const [status, setStatus] = useState(/** @type {string | null} */ (null));
  useEffect(() => {
    loadMetrics().then(setMetrics, (/** @type {unknown} */ e) => setStatus(String(e)));
  }, []);
  const model = /** @type {ChartModel | null} */ (loaded.data);
  const sheetModel = /** @type {ChartModel | null} */ (sheetLoaded.data);
  const labels = chartLabels(currentTexts(), language());
  const layout = useMemo(() => (model && metrics ? layoutChart(model, metrics, labels) : null), [model, metrics, labels.lang]);
  const title = chart.title || (model ? defaultTitle(labels, model) : '');

  const tap = (/** @type {string} */ id, /** @type {boolean} */ branch) => {
    location.hash = branch ? chartAddress({ ...chart, start: 'person', kind: 'descendants', id, line: null, form: 'tree' }) : personAddress(id);
  };
  const fromHere = (/** @type {string} */ id) =>
    (location.hash = chartAddress({ ...chart, start: 'person', kind: 'descendants', id, line: null, form: 'tree' }));

  // The Sheet of these very options: while another one loads, the last one stays on screen but is not printed.
  const sheetCurrent = sheetModel !== null && sheetLoaded.key === `chart-sheet:${sheetQuery}`;
  const sheetReady = () => {
    if (!sheetModel || !metrics || !sheetCurrent) {
      setStatus(t(sheetLoaded.error instanceof ApiError && sheetLoaded.error.offline ? 'chart.sheetOffline' : 'chart.preparing'));
      return null;
    }
    setStatus(null);
    const sheetLabels = chartLabels(currentTexts(), language());
    return { model: sheetModel, metrics, labels: sheetLabels, title: chart.title || defaultTitle(sheetLabels, sheetModel) };
  };
  const print = () => {
    const s = sheetReady();
    if (!s) return;
    const all = paginate(s.model, s.metrics, s.labels, chart.paper);
    const size = paperSize(chart.paper);
    // The pages go into a container of their own at the end of the page; in print, only it shows.
    let root = document.getElementById('chart-print-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'chart-print-root';
      root.dataset.testid = 'chart-print-pages';
      document.body.append(root);
    }
    const container = root;
    mount(
      html`${all.map(
        (p) =>
          html`<div class=${`chart-page ${chart.paper}`} key=${p.number} data-testid="print-page">
            ${sheet(svgH, { model: s.model, layout: p.layout, metrics: s.metrics, labels: s.labels, title: s.title, size, scale: p.scale, number: p.number, of: all.length })}
          </div>`,
      )}`,
      container,
    );
    document.body.classList.add('chart-printing');
    window.addEventListener(
      'afterprint',
      () => {
        document.body.classList.remove('chart-printing');
        mount(null, container);
      },
      { once: true },
    );
    window.print();
  };
  const svgFile = async () => {
    const s = sheetReady();
    if (!s) return null;
    const fontCss = await loadFontCss();
    const layoutOfSheet = layoutChart(s.model, s.metrics, s.labels);
    return { svg: sheetFile({ ...s, layout: layoutOfSheet, fontCss }), size: naturalSize(layoutOfSheet), name: fileName(s.title) };
  };
  const downloadSvg = async () => {
    const f = await svgFile();
    if (f) download(`${f.name}.svg`, new Blob([f.svg], { type: 'image/svg+xml' }));
  };
  const downloadPng = async () => {
    const f = await svgFile();
    if (!f) return;
    const png = await pngOf(f.svg, f.size);
    if (png.shrunk) setStatus(t('chart.pngTooLarge'));
    download(`${f.name}.png`, png.blob);
  };

  // A Sheet asked for before its variant has loaded is made as soon as it is there.
  const [pending, setPending] = useState(/** @type {'print' | 'svg' | 'png' | null} */ (null));
  const run = (/** @type {'print' | 'svg' | 'png'} */ what) => {
    if (what === 'print') print();
    else void (what === 'svg' ? downloadSvg() : downloadPng());
  };
  const ask = (/** @type {'print' | 'svg' | 'png'} */ what) => {
    if (sheetCurrent && metrics) run(what);
    else {
      setPending(what);
      sheetReady();
    }
  };
  useEffect(() => {
    if (pending === null || !sheetCurrent || !metrics) return;
    setPending(null);
    run(pending);
  }, [pending, sheetCurrent, metrics]);

  return html`<section
    class="screen-body chart-screen"
    data-testid="chart-screen"
    data-kind=${chart.kind}
    data-sheet-ready=${String(sheetCurrent && metrics !== null)}
  >
    <header class="chart-head">
      <h1 data-testid="chart-title">${title || t('chart.label')}</h1>
      <${AsOf} asOf=${loaded.asOf} />
    </header>
    <${ErrorLine} error=${loaded.error instanceof ApiError && loaded.error.status === 422 ? new Error(t('chart.notDescendant')) : loaded.error} />
    ${model ? html`<${Notes} model=${model} chart=${chart} labels=${labels} />` : null}
    <${Options} chart=${chart} model=${model} me=${me} title=${title} />
    <div class="chart-actions">
      <button type="button" class="button primary" data-testid="chart-print" onClick=${() => ask('print')}>${t('chart.print')}</button>
      <button type="button" class="button" data-testid="chart-svg" onClick=${() => ask('svg')}>${t('chart.downloadSvg')}</button>
      <button type="button" class="button" data-testid="chart-png" onClick=${() => ask('png')}>${t('chart.downloadPng')}</button>
    </div>
    ${status ? html`<p class="small muted" role="status" data-testid="chart-status">${status}</p>` : null}
    ${
      layout
        ? layout.cards.length === 0
          ? html`<p class="muted">${t('chart.empty')}</p>`
          : html`<${ChartCanvas} layout=${layout} onTap=${tap} onLongPress=${fromHere} viewKey=${query} />`
        : null
    }
  </section>`;
}
