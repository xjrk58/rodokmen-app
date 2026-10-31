// The app shell for the family screens (family-tree spec, "The tree is the home screen"): it
// knows who is signed in and which screen the address names, renders the Preact screens and,
// for a signed-in Member, the tabs Tree, Map, People, Review (Editors) and Settings. Without
// sign-in the home screen is the public map, and family addresses ask to sign in first.

import { ApiError, getMe, signOut as apiSignOut, updateMe } from './api.js';
import { clearCache, readCached, writeCached } from './cache.js';
import { forgetFocus } from './focus.js';
import { language, onLanguageChange, setLanguage, storedLanguage, t } from './i18n.js';
import { PeopleScreen } from './people-screen.js';
import { PersonScreen } from './person-screen.js';
import { setFamilyRoots } from './relation.js';
import { needsMember, parseRoute } from './routes.js';
import { SettingsScreen } from './settings-screen.js';
import { SignInScreen } from './sign-in-screen.js';
import { TreeScreen } from './tree-screen.js';
import { html, mount } from './ui.js';

/** @typedef {import('./types.js').Me} Me */
/** @typedef {import('./routes.js').Route} Route */

/** Tab icons: 24 × 24 stroked paths. */
const ICONS = {
  tree: ['M12 3v6', 'M6 9h12', 'M6 9v4', 'M18 9v4', 'M3 13h6v4H3z', 'M15 13h6v4h-6z', 'M10 3h4'],
  map: ['M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z', 'M9 4v14', 'M15 6v14'],
  people: ['M8 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M2 20c.5-3.5 3-5.5 6-5.5s5.5 2 6 5.5', 'M16 4.5a3 3 0 0 1 0 6', 'M17.5 14.6c2.2.6 3.8 2.5 4.2 5.4'],
  review: ['M9 12l2 2 4-4', 'M5 4h14v16H5z'],
  settings: [
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8',
  ],
};

/** @param {{ name: keyof typeof ICONS }} props */
const TabIcon = ({ name }) => html`<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name].map((d) => html`<path d=${d} />`)}</svg>`;

/**
 * The screen the address names, for this visitor or Member.
 * @param {Route} route
 * @param {Me | null} me
 */
export function screenFor(route, me) {
  if (route.screen === 'home') return me ? 'tree' : 'map';
  if (needsMember(route) && !me) return 'required';
  return route.screen;
}

/** @param {{ route: Route, me: Me }} props */
function TabBar({ route, me }) {
  const current = screenFor(route, me);
  const active = current === 'person' ? 'people' : current === 'work' && route.screen === 'work' && route.view === 'review' ? 'review' : current;
  /** @type {[keyof typeof ICONS, string, string][]} */
  const tabs = [
    ['tree', '#tree', 'tabs.tree'],
    ['map', '#map', 'tabs.map'],
    ['people', '#people', 'tabs.people'],
    ...(me.permissions.review ? /** @type {[keyof typeof ICONS, string, string][]} */ ([['review', '#work/review', 'tabs.review']]) : []),
    ['settings', '#settings', 'tabs.settings'],
  ];
  return html`<nav class="tabbar" aria-label=${t('tabs.label')} data-testid="tabbar">
    ${tabs.map(
      ([id, href, key]) =>
        html`<a href=${href} class="tabbar-item" data-testid=${`tabbar-${id}`} aria-current=${active === id ? 'page' : undefined}>
          <${TabIcon} name=${id} /><span>${t(key)}</span>
        </a>`,
    )}
  </nav>`;
}

export class Shell {
  /**
   * @param {{ root: HTMLElement, onMember: (me: Me | null) => void, onRoute: (route: Route, screen: string) => void }} o
   */
  constructor(o) {
    this.o = o;
    /** @type {Me | null} */
    this.me = null;
    /** Whether `me` comes from the device because the server could not be reached. */
    this.offline = false;
    /** @type {Route} */
    this.route = parseRoute(location.hash);
    window.addEventListener('hashchange', () => {
      this.route = parseRoute(location.hash);
      this.update();
    });
    onLanguageChange(() => this.render());
  }

  /** Who is signed in: the server's answer, else (offline) the Member last signed in on this device. */
  async start() {
    try {
      this.setMe(await getMe());
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 404)) {
        // Not signed in, or the session has ended (perhaps from another device): nothing stays on this device.
        if (await readCached('me')) await this.forget();
        this.setMe(null);
      } else {
        const cached = await readCached('me');
        this.offline = Boolean(cached);
        this.setMe(cached ? /** @type {Me} */ (cached.data) : null);
      }
    }
    await this.applyAccountLanguage();
    this.update();
  }

  /** @param {Me | null} me */
  setMe(me) {
    this.me = me;
    // The relation to the family means something once the Owner marked a Family root (src/relation.js).
    setFamilyRoots(me?.familyRoots ?? []);
    document.body.classList.toggle('signed-in', me !== null);
    if (me && !this.offline) void writeCached('me', me);
    this.o.onMember(me);
  }

  /** The account's language, unless the reader chose one on this device (default-to-czech). */
  async applyAccountLanguage() {
    const lang = this.me?.language;
    if (lang && !storedLanguage() && lang !== language()) await setLanguage(lang).catch((error) => console.error(error));
  }

  /** @param {Me} me */
  async onSignedIn(me) {
    this.offline = false;
    this.setMe(me);
    await this.applyAccountLanguage();
    this.update();
  }

  async refreshMe() {
    this.setMe(await getMe());
    this.render();
  }

  /** Language chosen in Settings: for this device, and for a signed-in Member also the account (emails). @param {'cs' | 'en'} lang */
  async chooseLanguage(lang) {
    await setLanguage(lang, { remember: true });
    if (this.me && !this.offline) this.setMe(await updateMe({ language: lang }));
    this.render();
  }

  async forget() {
    await clearCache();
    forgetFocus();
  }

  async signOut() {
    await apiSignOut().catch((error) => {
      // Offline the session cannot be ended on the server; this device forgets it all the same.
      if (!(error instanceof ApiError && error.offline)) throw error;
    });
    await this.forget();
    this.offline = false;
    this.setMe(null);
    this.go('');
  }

  /** Goes to an address; "" is the home screen. @param {string} hash */
  go(hash) {
    if (hash === '' || hash === '#') {
      history.pushState(null, '', `${location.pathname}${location.search}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } else {
      location.hash = hash;
    }
  }

  update() {
    const screen = screenFor(this.route, this.me);
    document.body.dataset.screen = screen;
    this.o.onRoute(this.route, screen);
    this.render();
  }

  render() {
    const me = this.me;
    const route = this.route;
    const screen = screenFor(route, me);
    const cache = me !== null;
    /** @type {import('./ui.js').Children} */
    let content = null;
    if (screen === 'tree' && me) content = html`<${TreeScreen} me=${me} focus=${route.screen === 'tree' ? route.focus : null} cache=${cache} />`;
    else if (screen === 'people') content = html`<${PeopleScreen} cache=${cache} />`;
    else if (screen === 'person' && route.screen === 'person')
      content = html`<${PersonScreen} key=${route.id} id=${route.id} cache=${cache} me=${me} refreshMe=${() => this.refreshMe()} />`;
    else if (screen === 'settings' && me)
      content = html`<${SettingsScreen}
        me=${me}
        chooseLanguage=${(/** @type {'cs' | 'en'} */ l) => this.chooseLanguage(l)}
        signOut=${() => this.signOut()}
        refreshMe=${() => this.refreshMe()}
      />`;
    else if (screen === 'sign-in' || screen === 'required') content = html`<${SignInScreen} mode=${screen} shell=${this} />`;
    else if ((screen === 'invite' || screen === 'link') && (route.screen === 'invite' || route.screen === 'link'))
      content = html`<${SignInScreen} key=${route.token} mode=${screen} token=${route.token} shell=${this} />`;
    mount(
      html`${content ? html`<main class="screen" data-testid="screen" data-screen=${screen}>${this.offline ? html`<p class="offline-note" role="status">${t('family.offlineMode')}</p>` : null}${content}</main>` : null}
      ${me ? html`<${TabBar} route=${route} me=${me} />` : null}`,
      this.o.root,
    );
  }
}
