// Scan reading in Owner settings (scan-reading spec, "The Owner switches it on"; ADR 0011): the
// switch, which says plainly that pages then go to Anthropic's API, the daily limit per Member,
// and the readings made per Member and day, all through /api/settings/scan-reading.

import * as API from './api.js';
import { t } from './i18n.js';
import { Status, useAction, useLoad } from './settings-parts.js';
import { html, useState } from './ui.js';

/**
 * Scan reading (scan-reading spec, "The Owner switches it on"): off until the Owner switches it
 * on, saying plainly that scans then go to Anthropic's API; the daily limit per Member; and the
 * readings made per Member and day.
 */
export function ScanReadingSection() {
  const settings = useLoad((signal) => API.scanReadingSettings(signal));
  const [limit, setLimit] = useState('');
  const [text, error, run] = useAction();
  const s = settings.data;
  if (!s) return html`<section class="card" data-testid="settings-scan-reading"><h2>${t('settings.scanReading')}</h2></section>`;
  const dailyLimit = Number(limit || s.dailyLimit);
  const save = (/** @type {boolean} */ enabled) =>
    run(async () => {
      await API.setScanReadingSettings({ enabled, dailyLimit });
      settings.reload();
    }, t('settings.saved'));
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = s.usage.filter((u) => u.day === today).reduce((n, u) => n + u.readings, 0);
  return html`<section class="card" data-testid="settings-scan-reading">
    <h2>${t('settings.scanReading')}</h2>
    <p class="note small" data-testid="scan-reading-notice">${t('settings.scanReadingNotice')}</p>
    ${s.configured ? null : html`<p class="warning small" data-testid="scan-reading-no-key">${t('settings.scanReadingNoKey')}</p>`}
    <label class="switch-row">
      <input
        type="checkbox"
        data-testid="scan-reading-switch"
        checked=${s.enabled}
        disabled=${!s.configured && !s.enabled}
        onChange=${(/** @type {Event} */ e) => void save(/** @type {HTMLInputElement} */ (e.currentTarget).checked)}
      />
      <span>${t('settings.scanReadingSwitch')}</span>
    </label>
    <label class="field"
      ><span>${t('settings.scanReadingLimit')}</span
      ><input
        type="number"
        min="1"
        max="200"
        inputmode="numeric"
        data-testid="scan-reading-limit"
        value=${limit || String(s.dailyLimit)}
        onInput=${(/** @type {Event} */ e) => setLimit(/** @type {HTMLInputElement} */ (e.currentTarget).value)}
    /></label>
    <button type="button" class="button" data-testid="scan-reading-save" onClick=${() => void save(s.enabled)}>${t('settings.save')}</button>
    <p class="muted small" data-testid="scan-reading-model">${t('settings.scanReadingModel', { model: s.model, today: usedToday })}</p>
    <${Status} text=${text} error=${error} testid="scan-reading-status" />
    <h3>${t('settings.scanReadingUsage')}</h3>
    ${s.usage.length === 0 ? html`<p class="muted small">${t('settings.scanReadingNone')}</p>` : null}
    <ul class="plain-list" data-testid="scan-reading-usage">
      ${s.usage.map(
        (u) =>
          html`<li key=${`${u.day}-${u.author.id}`} data-testid="usage">
            <span>${u.day}</span> ·
            <span>${u.author.displayName}</span>${u.author.isAgent ? html` <span class="badge agent">${t('review.agent')}</span>` : null}
            <span class="muted small"> · ${t('settings.scanReadingCount', { count: u.readings, failed: u.failed })}</span>
          </li>`,
      )}
    </ul>
  </section>`;
}
