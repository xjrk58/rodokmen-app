// The options of a Chart (tree-charts spec, "Charts in the app"): kind and form, generations,
// the Direct line, the Unrelated switch and the period of a House chart, the title, the paper and
// Living people on the Sheet, each in the Chart's address, so that a link opens the same Chart.
// And the switch "Kinship to me" (tree-charts spec, "Kinship on Chart cards"): off by default,
// remembered on the device and kept out of the address, because it belongs to the device and the
// terms to the reader, so a shared link shows each Member their own kinship. It changes the
// screen only: a Sheet, its print and its files never show kinship.

import { rememberedFocus } from './focus.js';
import { t } from './i18n.js';
import { chartAddress } from './routes.js';
import { html, useState } from './ui.js';

/** @typedef {import('./routes.js').ChartRoute} ChartRoute */
/** @typedef {import('./types.js').ChartModel} ChartModel */
/** @typedef {import('./types.js').Me} Me */

const KINSHIP_KEY = 'rodokmen.chartKinship';

/** Whether kinship on Chart cards is switched on on this device; off by default. */
export function rememberedKinship() {
  try {
    return localStorage.getItem(KINSHIP_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Remembers the switch on this device. @param {boolean} on */
export function rememberKinship(on) {
  try {
    if (on) localStorage.setItem(KINSHIP_KEY, 'on');
    else localStorage.removeItem(KINSHIP_KEY);
  } catch {
    // storage blocked: remembered for this visit only
  }
}

/**
 * The switch "Kinship to me", for a Member with an own Person only.
 * @param {{ me: Me, on: boolean, onChange: (on: boolean) => void }} props
 */
function KinshipSwitch({ me, on, onChange }) {
  if (!me.person) return null;
  return html`<label class="switch-row"
      ><input type="checkbox" checked=${on} data-testid="chart-kinship" onChange=${() => onChange(!on)} /><span>${t('chart.kinship')}</span></label
    >
    <p class="small muted">${t('chart.kinship.screenOnly')}</p>`;
}

/**
 * The options of a Chart; each change is a new address, but for kinship, which the device keeps.
 * @param {{ chart: ChartRoute, model: ChartModel | null, me: Me, title: string, kinship: boolean, onKinship: (on: boolean) => void }} props
 */
export function Options({ chart, model, me, title, kinship, onKinship }) {
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
    <${KinshipSwitch} me=${me} on=${kinship} onChange=${onKinship} />
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
