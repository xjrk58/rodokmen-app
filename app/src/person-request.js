// Asking to be linked to one's own Person (family-tree spec, "Asking to be linked to one's own
// Person"): a Member's waiting request in Settings, the Owner's confirmation or refusal of each
// Member's request, and the count of open requests on the Owner's Settings tab. The request is
// made on a person page ("This is me", src/kinship-section.js).

import { linkPerson } from './api.js';
import { t } from './i18n.js';
import { refuseRequest, withdrawRequest } from './kinship.js';
import { personAddress } from './routes.js';
import { formatTime, PersonLine } from './screen-parts.js';
import { Status, useAction } from './settings-parts.js';
import { html } from './ui.js';

/** @typedef {import('./types.js').Me} Me */
/** @typedef {import('./types.js').MemberView} MemberView */

/** A Member's own request, waiting for the Owner. @param {{ me: Me, refreshMe?: () => Promise<void> }} props */
export function MyRequest({ me, refreshMe }) {
  const [text, error, run] = useAction();
  if (me.person || !me.personRequest) return null;
  return html`<div class="person-request small" data-testid="my-request">
    ${t('kinship.waiting')} <${PersonLine} person=${me.personRequest.person} href=${personAddress(me.personRequest.person.id)} />
    <button
      type="button"
      class="link-button"
      data-testid="my-request-withdraw"
      onClick=${() => void run(async () => (await withdrawRequest(), await refreshMe?.()))}
    >
      ${t('kinship.withdraw')}
    </button>
    <${Status} text=${text} error=${error} testid="my-request-status" />
  </div>`;
}

/** The Owner's view of one Member's request: confirm (link the account) or refuse. @param {{ member: MemberView, onChange: () => void }} props */
export function MemberRequest({ member, onChange }) {
  const [text, error, run] = useAction();
  const request = member.personRequest;
  if (!request) return null;
  return html`<div class="person-request small" data-testid="member-request">
    ${t('settings.asksToBe', { when: formatTime(request.at) })}
    <${PersonLine} person=${request.person} href=${personAddress(request.person.id)} />
    <button
      type="button"
      class="button small"
      data-testid="member-request-confirm"
      onClick=${() => void run(async () => (await linkPerson(member.id, request.person.id), onChange()))}
    >
      ${t('settings.confirmRequest')}
    </button>
    <button
      type="button"
      class="link-button"
      data-testid="member-request-refuse"
      onClick=${() => void run(async () => (await refuseRequest(member.id), onChange()))}
    >
      ${t('settings.refuseRequest')}
    </button>
    <${Status} text=${text} error=${error} testid="member-request-status" />
  </div>`;
}

/** The count of open requests on the Owner's Settings tab. @param {{ count: number }} props */
export const RequestCount = ({ count }) =>
  html`<span class="tab-count" data-testid="settings-request-count" aria-label=${t('settings.requestCount', { count })}>${count}</span>`;
