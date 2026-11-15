// Kinship on the screens (kinship spec; family-view "Kinship on the person page", family-tree
// "Kinship in the tree"): the section "How you are related" of a person page with every path, the
// strip above the tree, and for a Member with no own Person the prompt and "This is me". Every
// word comes from the server's answer (src/kinship.js) or an i18n key.

import { askToBeLinked, getKinship, isForMe, kinshipText, lineAndDegree, termText, withdrawRequest } from './kinship.js';
import { t } from './i18n.js';
import { personAddress } from './routes.js';
import { errorText, PersonLine, useCachedLoad } from './screen-parts.js';
import { html, useState } from './ui.js';

/** @typedef {import('./types.js').Kinship} Kinship */
/** @typedef {import('./types.js').KinshipPath} KinshipPath */
/** @typedef {import('./types.js').KinshipStep} KinshipStep */
/** @typedef {import('./types.js').Me} Me */
/** @typedef {import('./types.js').PersonSummary} PersonSummary */
/** @typedef {import('./types.js').Hourglass} Hourglass */

/** The "?" of a Possible relative, beside a possible path. @param {{ possible: boolean }} props */
const PossibleMark = ({ possible }) =>
  possible ? html` <span class="mark possible" data-testid="kinship-possible" title=${t('kinship.possibleNote')}>?</span>` : null;

/** A Person of the answer, as a link to their page. @param {{ id: string, names: Map<string, PersonSummary> }} props */
function PersonLink({ id, names }) {
  return html`<a href=${personAddress(id)} data-testid="kinship-person">${names.get(id)?.displayName ?? id}</a>`;
}

/** Every Person on the way, each with the step to it ("otec: …"). @param {{ steps: KinshipStep[], names: Map<string, PersonSummary> }} props */
function Steps({ steps, names }) {
  return html`<ol class="kinship-steps" data-testid="kinship-steps">
    ${steps.map(
      (s, i) =>
        html`<li key=${i} data-testid="kinship-step">
          ${t('kinship.step', { word: termText(s.term) })} <${PersonLink} id=${s.person} names=${names} /><${PossibleMark} possible=${s.weak} />
        </li>`,
    )}
  </ol>`;
}

/** One path: its term and marks, line and degree, common ancestors. @param {{ path: KinshipPath, names: Map<string, PersonSummary>, steps?: boolean }} props */
function PathView({ path, names, steps = false }) {
  const degree = lineAndDegree(path);
  return html`<div class="kinship-path" data-testid="kinship-path">
    <p class="kinship-term" data-testid="kinship-term">${kinshipText(path)}<${PossibleMark} possible=${path.possible} /></p>
    ${degree ? html`<p class="muted small" data-testid="kinship-degree">${degree}</p>` : null}
    ${
      path.commonAncestors.length
        ? html`<p class="small" data-testid="kinship-ancestors">
            ${t('kinship.commonAncestors')} ${path.commonAncestors.map((id, i) => html`${i ? ' & ' : ''}<${PersonLink} id=${id} names=${names} />`)}
          </p>`
        : null
    }
    ${steps ? html`<${Steps} steps=${path.steps} names=${names} />` : null}
  </div>`;
}

/** The answer: the closest path, how many more, and every path on request. @param {{ k: Kinship }} props */
function Answer({ k }) {
  const [open, setOpen] = useState(false);
  const names = new Map(k.persons.map((p) => [p.id, p]));
  const [first] = k.paths;
  if (!first) {
    if (!k.connection) return html`<p data-testid="kinship-none">${t('kinship.none')}</p>`;
    return html`<p data-testid="kinship-connected">${t('kinship.connected', { count: k.connection.marriages })}</p>
      <${Steps} steps=${k.connection.steps} names=${names} />`;
  }
  if (first.kind === 'self') return html`<p class="kinship-term" data-testid="kinship-self">${t('kinship.thisIsYou')}</p>`;
  return html`<${PathView} path=${first} names=${names} /> ${
      k.paths.length > 1
        ? html`<button type="button" class="link-button" data-testid="kinship-more" aria-expanded=${open ? 'true' : 'false'} onClick=${() => setOpen(!open)}>
            ${open ? t('kinship.hidePaths') : t('kinship.morePaths', { count: k.paths.length - 1 })}
          </button>`
        : html`<${Steps} steps=${first.steps} names=${names} />`
    }
    ${
      open
        ? html`<ol class="kinship-paths" data-testid="kinship-paths">
            ${k.paths.map((p, i) => html`<li key=${i}><${PathView} path=${p} names=${names} steps=${true} /></li>`)}
          </ol>`
        : null
    }
    ${k.more ? html`<p class="muted small" data-testid="kinship-may-be-more">${t('kinship.mayBeMore')}</p>` : null}`;
}

/** The section for a Member with an own Person. @param {{ id: string, me: Me, cache: boolean }} props */
function KinshipAnswer({ id, me, cache }) {
  const loaded = useCachedLoad(`kinship:${id}`, (signal) => getKinship(id, signal), cache);
  // An answer kept on the device for another own Person is not shown.
  const k = loaded.data && loaded.data.to === id && isForMe(loaded.data, me) ? loaded.data : null;
  // With no answer, online or saved, the page goes without the section: it shows the page's own "as of" and errors.
  if (!k && loaded.error) return null;
  return html`<${Section}>${k ? html`<${Answer} k=${k} />` : html`<p class="muted small">${t('work.loading')}</p>`}</${Section}>`;
}

/** The section's frame. @param {{ children?: import('./ui.js').Children }} props */
const Section = ({ children }) =>
  html`<section class="card kinship" data-testid="kinship" aria-labelledby="kinship-title">
    <h2 id="kinship-title">${t('kinship.title')}</h2>
    ${children}
  </section>`;

/** For a Member with no own Person: what kinship needs, and "This is me" or the waiting request. @param {{ id: string, me: Me, refreshMe?: () => Promise<void> }} props */
function LinkPrompt({ id, me, refreshMe }) {
  const [status, setStatus] = useState({ text: '', error: false });
  const run = async (/** @type {() => Promise<unknown>} */ action) => {
    setStatus({ text: '', error: false });
    try {
      await action();
      await refreshMe?.();
    } catch (error) {
      setStatus({ text: errorText(error), error: true });
    }
  };
  let body;
  if (me.role === 'owner') {
    body = html`<p>${t('kinship.ownerPrompt')}</p>
      <a class="button" href="#settings" data-testid="kinship-settings">${t('kinship.goSettings')}</a>`;
  } else if (me.personRequest) {
    body = html`<p data-testid="kinship-waiting">
        ${t('kinship.waiting')} <${PersonLine} person=${me.personRequest.person} href=${personAddress(me.personRequest.person.id)} />
      </p>
      <button type="button" class="link-button" data-testid="kinship-withdraw" onClick=${() => void run(withdrawRequest)}>${t('kinship.withdraw')}</button>`;
  } else {
    body = html`<p>${t('kinship.prompt')}</p>
      <button type="button" class="button" data-testid="this-is-me" onClick=${() => void run(() => askToBeLinked(id))}>${t('kinship.thisIsMe')}</button>`;
  }
  return html`${body}
    <p class=${`form-status${status.error ? ' error' : ''}`} role="status" data-testid="kinship-status">${status.text}</p>`;
}

/**
 * "How you are related" on a person page, near its top.
 * @param {{ id: string, me: Me | null, cache: boolean, refreshMe?: () => Promise<void> }} props
 */
export function KinshipSection({ id, me, cache, refreshMe }) {
  if (!me) return null;
  if (me.person) return html`<${KinshipAnswer} key=${id} id=${id} me=${me} cache=${cache} />`;
  return html`<${Section}><${LinkPrompt} id=${id} me=${me} refreshMe=${refreshMe} /></${Section}>`;
}

/**
 * The strip above the tree: the Focus Person's kinship to the Member's own Person, leading to the
 * paths on their page. Nothing for a Member with no own Person, or no kinship.
 * @param {{ me: Me, data: Hourglass }} props
 */
export function KinshipStrip({ me, data }) {
  const focus = data.persons.find((p) => p.relation === 'focus')?.person;
  const k = me.person && focus?.kinship ? focus.kinship : null;
  if (!focus || !k) return null;
  const degree = lineAndDegree(k);
  return html`<a class="kinship-strip" href=${personAddress(focus.id)} data-testid="kinship-strip">
    <span class="kinship-strip-term">${kinshipText(k)}</span
    ><${PossibleMark} possible=${k.possible} />${degree ? html` <span class="muted">· ${degree}</span>` : null}
  </a>`;
}
