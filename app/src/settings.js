// Settings: language, "Check map layers" and about.

import { h } from './dom.js';
import { language, setLanguage, t } from './i18n.js';
import { checkOverlays } from './layer-check.js';
import { APP_VERSION } from './version.js';

/** @typedef {import('./types.js').OverlayConfig} OverlayConfig */
/** @typedef {import('./i18n.js').Language} Language */

export class Settings {
  /**
   * @param {HTMLDialogElement} dialog
   * @param {HTMLButtonElement} openButton
   * @param {{ overlays: OverlayConfig[] }} deps
   */
  constructor(dialog, openButton, deps) {
    this.dialog = dialog;
    this.deps = deps;
    this.results = /** @type {HTMLUListElement} */ (dialog.querySelector('#check-results'));
    this.checkButton = /** @type {HTMLButtonElement} */ (dialog.querySelector('#check-layers'));
    /** @type {{ overlay: OverlayConfig, working: boolean }[] | null} */
    this.lastCheck = null;

    openButton.addEventListener('click', () => {
      this.syncLanguage();
      dialog.showModal();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    for (const radio of dialog.querySelectorAll('input[name="language"]')) {
      radio.addEventListener('change', (event) => {
        const lang = /** @type {Language} */ (/** @type {HTMLInputElement} */ (event.target).value);
        setLanguage(lang, { remember: true });
      });
    }
    this.checkButton.addEventListener('click', () => this.check());
    this.render();
  }

  syncLanguage() {
    for (const radio of this.dialog.querySelectorAll('input[name="language"]')) {
      const input = /** @type {HTMLInputElement} */ (radio);
      input.checked = input.value === language();
    }
  }

  async check() {
    this.checkButton.disabled = true;
    this.results.replaceChildren(h('li', {}, t('settings.checking')));
    this.lastCheck = await checkOverlays(this.deps.overlays);
    this.checkButton.disabled = false;
    this.render();
  }

  render() {
    this.syncLanguage();
    const version = /** @type {HTMLElement} */ (this.dialog.querySelector('#app-version'));
    version.textContent = t('settings.version', { version: APP_VERSION });
    if (!this.lastCheck) return;
    this.results.replaceChildren(
      ...this.lastCheck.map(({ overlay, working }) =>
        h('li', { 'data-overlay': overlay.id, 'data-working': String(working) },
          h('span', {}, t(`overlay.${overlay.id}`), overlay.enabled ? null : h('span', { class: 'status off' }, ` (${t('settings.switchedOff')})`)),
          h('span', { class: `status ${working ? 'ok' : 'bad'}` }, working ? t('settings.working') : t('settings.notWorking')))),
    );
  }
}
