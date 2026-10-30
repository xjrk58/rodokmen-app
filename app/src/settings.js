// Settings: language, "Check map layers" and about.

import { h, required } from './dom.js';
import { LANGUAGES, language, setLanguage, t } from './i18n.js';
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
    this.results = required(dialog, '#check-results', HTMLUListElement);
    this.checkButton = required(dialog, '#check-layers', HTMLButtonElement);
    this.version = required(dialog, '#app-version', HTMLElement);
    this.radios = [...dialog.querySelectorAll('input[name="language"]')].filter((el) => el instanceof HTMLInputElement);
    /** @type {{ overlay: OverlayConfig, working: boolean }[] | null} */
    this.lastCheck = null;

    openButton.addEventListener('click', () => {
      this.syncLanguage();
      dialog.showModal();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    for (const radio of this.radios) {
      radio.addEventListener('change', () => {
        const lang = LANGUAGES.find((l) => l === radio.value);
        if (!lang) return;
        setLanguage(lang, { remember: true }).catch((error) => {
          // The strings did not load: the page stays in its language, and so do the radios.
          console.error(error);
          this.syncLanguage();
        });
      });
    }
    this.checkButton.addEventListener('click', () => void this.check());
    this.render();
  }

  syncLanguage() {
    for (const radio of this.radios) radio.checked = radio.value === language();
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
    this.version.textContent = t('settings.version', { version: APP_VERSION });
    if (!this.lastCheck) return;
    this.results.replaceChildren(
      ...this.lastCheck.map(({ overlay, working }) =>
        h(
          'li',
          { 'data-overlay': overlay.id, 'data-working': String(working) },
          h('span', {}, t(`overlay.${overlay.id}`), overlay.enabled ? null : h('span', { class: 'status off' }, ` (${t('settings.switchedOff')})`)),
          h('span', { class: `status ${working ? 'ok' : 'bad'}` }, working ? t('settings.working') : t('settings.notWorking')),
        ),
      ),
    );
  }
}
