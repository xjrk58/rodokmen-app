// People: the list of Persons and the search by any Name, ignoring case and diacritics
// (family-view spec, "People list and search"). Each result shows the primary Name and life
// years, the Name that matched when it is another one, and "Show in tree". Unrelated people
// are left out until the Member switches them on ("Unrelated people hidden by default").

import { listPersons } from './api.js';
import { t } from './i18n.js';
import { isShown, relationFilter, rootsKnown } from './relation.js';
import { personAddress, treeAddress } from './routes.js';
import { AsOf, ErrorLine, PersonLine, useCachedLoad, useDebounced } from './screen-parts.js';
import { html, useState } from './ui.js';

/** @typedef {import('./types.js').PersonSearchHit} PersonSearchHit */

const PAGE = 50;
const SEARCH_DELAY_MS = 250;
/** The search kept while the Member looks at a person page and comes back. */
let lastQuery = '';

/**
 * @param {{ hit: PersonSearchHit }} props
 */
function Result({ hit }) {
  const p = hit.person;
  const other = hit.matchedName && hit.matchedName !== p.displayName ? hit.matchedName : null;
  return html`<li class="person-result" data-testid="person-result" data-id=${p.id}>
    <div>
      <${PersonLine} person=${p} href=${personAddress(p.id)} />
      ${other ? html`<span class="matched small muted" data-testid="matched">${t('people.matched', { name: other })}</span>` : null}
    </div>
    <a class="button small" href=${treeAddress(p.id)} data-testid="show-in-tree">${t('people.showInTree')}</a>
  </li>`;
}

/**
 * The search box with its results; the People screen, and the tree's start when it has no focus.
 * @param {{ cache: boolean }} props
 */
export function PeopleSearch({ cache }) {
  const [query, setQuery] = useState(lastQuery);
  const [pages, setPages] = useState(1);
  const [includeUnrelated, setIncludeUnrelated] = useState(false);
  const settled = useDebounced(query.trim(), SEARCH_DELAY_MS);
  const limit = PAGE * pages;
  // Unrelated people are left out by the server, so that a page holds as many as it can.
  const relation = relationFilter(includeUnrelated);
  const loaded = useCachedLoad(
    `people:${settled}:${relation ?? 'all'}:${limit}`,
    (signal) => listPersons({ q: settled, offset: 0, limit, relation }, signal),
    cache,
  );
  const items = loaded.data?.items ?? [];
  const shown = items.filter((hit) => isShown(hit.person, includeUnrelated));
  const showSwitch = rootsKnown();

  return html`<div class="people-search">
    <form class="search people-box" role="search" onSubmit=${(/** @type {Event} */ e) => e.preventDefault()}>
      <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m15.5 15.5 5 5" />
      </svg>
      <input
        type="search"
        inputmode="search"
        enterkeyhint="search"
        spellcheck="false"
        autocomplete="off"
        placeholder=${t('people.placeholder')}
        aria-label=${t('people.label')}
        data-testid="people-search"
        value=${query}
        onInput=${(/** @type {Event} */ e) => {
          lastQuery = /** @type {HTMLInputElement} */ (e.currentTarget).value;
          setQuery(lastQuery);
          setPages(1);
        }}
      />
    </form>
    ${
      showSwitch
        ? html`<label class="switch-row"
            ><input
              type="checkbox"
              data-testid="include-unrelated"
              checked=${includeUnrelated}
              onChange=${(/** @type {Event} */ e) => setIncludeUnrelated(/** @type {HTMLInputElement} */ (e.currentTarget).checked)}
            /><span>${t('people.includeUnrelated')}</span></label
          >`
        : null
    }
    <${AsOf} asOf=${loaded.asOf} />
    <${ErrorLine} error=${loaded.error} />
    <ul class="person-results" data-testid="person-results" aria-busy=${loaded.loading ? 'true' : 'false'}>
      ${shown.map((hit) => html`<${Result} key=${hit.person.id} hit=${hit} />`)}
    </ul>
    ${!loaded.loading && !loaded.error && shown.length === 0 ? html`<p class="empty" data-testid="no-people">${settled ? t('people.none') : t('people.empty')}</p>` : null}
    ${items.length >= limit ? html`<button type="button" class="button" data-testid="more-people" onClick=${() => setPages(pages + 1)}>${t('people.more')}</button>` : null}
  </div>`;
}

/** @param {{ cache: boolean }} props */
export function PeopleScreen({ cache }) {
  return html`<section class="screen-body" data-testid="people-screen">
    <h1>${t('people.title')}</h1>
    <${PeopleSearch} cache=${cache} />
  </section>`;
}
