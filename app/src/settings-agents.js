// The Agents in Owner settings (agent-access spec, "Agent accounts belong to the Owner";
// family-view spec, "Owner settings in the app"): the Owner sees each Agent with its tokens and
// this hour's use of its limits, creates Agents, issues and revokes tokens, and disables and
// enables Agents, all through /api/agents. The screen adds nothing the API does not do.
//
// A token is in full only in the answer that issues it. It lives in this screen's state alone:
// never in IndexedDB, localStorage or a Draft, so it is gone once the Owner closes it or leaves
// Settings, and a reload shows only its prefix.

import * as API from './api.js';
import { language, t } from './i18n.js';
import { ErrorLine, formatTime } from './screen-parts.js';
import { Status, useAction, useLoad } from './settings-parts.js';
import { html, useEffect, useRef, useState } from './ui.js';

/** @typedef {import('./types.js').AgentView} AgentView */
/** @typedef {import('./types.js').AgentTokenView} AgentTokenView */
/** @typedef {import('./types.js').IssuedAgentToken} IssuedAgentToken */
/** @typedef {AgentView['usage']['proposals']} WindowUsage */
/** @typedef {(action: () => Promise<unknown>, done?: string) => Promise<void>} Run */

/** Names and labels are at most this long (shared/src/schemas/accounts.ts). */
const MAX_TEXT = 100;

/** @param {number} n */
const number = (n) => new Intl.NumberFormat(language()).format(n);

/** @param {string} iso */
const timeOf = (iso) => new Intl.DateTimeFormat(language(), { timeStyle: 'short' }).format(new Date(iso));

/** @param {Event} e */
const valueOf = (e) => /** @type {HTMLInputElement} */ (e.currentTarget).value;

/** Facts on one line, between dots. @param {(string | null)[]} parts */
const dotted = (...parts) => parts.filter((p) => p !== null).join(' · ');

/** A token label, or none when the field is empty. @param {string} label */
const labelOf = (label) => (label.trim() ? label.trim() : undefined);

/**
 * A token just issued, in full for the only time, with a copy button.
 * @param {{ token: IssuedAgentToken, title: string, onDone: () => void }} props
 */
function TokenOnce({ token, title, onDone }) {
  const box = useRef(/** @type {HTMLDivElement | null} */ (null));
  const value = useRef(/** @type {HTMLElement | null} */ (null));
  const copyButton = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const [status, setStatus] = useState({ text: '', error: false });
  useEffect(() => {
    box.current?.scrollIntoView({ block: 'center' });
    copyButton.current?.focus({ preventScroll: true });
  }, [token.id]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token.token);
      setStatus({ text: t('settings.agents.copied'), error: false });
    } catch {
      // No clipboard here (or it was refused): select the token, so it can be copied by hand.
      if (value.current) window.getSelection()?.selectAllChildren(value.current);
      setStatus({ text: t('settings.agents.copyByHand'), error: true });
    }
  };
  return html`<div class="token-once" role="group" aria-label=${title} data-testid="token-once" ref=${box}>
    <h4>${title}</h4>
    <p class="small"><strong>${t('settings.agents.onlyOnce')}</strong> ${t('settings.agents.likePassword')}</p>
    <code class="token-value" data-testid="token-value" ref=${value}>${token.token}</code>
    <div class="token-actions">
      <button type="button" class="button primary" data-testid="token-copy" ref=${copyButton} onClick=${() => void copy()}>${t('settings.agents.copy')}</button>
      <button type="button" class="button" data-testid="token-done" onClick=${onDone}>${t('settings.agents.saved')}</button>
    </div>
    <${Status} text=${status.text} error=${status.error} testid="token-copy-status" />
  </div>`;
}

/**
 * The question before a token is revoked, in the page: revoking cannot be undone.
 * @param {{ token: AgentTokenView, onRevoke: () => void, onKeep: () => void }} props
 */
function ConfirmRevoke({ token, onRevoke, onKeep }) {
  const keep = useRef(/** @type {HTMLButtonElement | null} */ (null));
  useEffect(() => keep.current?.focus(), []);
  const id = `revoke-${token.id}`;
  return html`<div class="confirm" role="group" aria-labelledby=${id} data-testid="revoke-confirm">
    <p class="small" id=${id}>${t('settings.agents.revokeConfirm', { prefix: token.prefix })}</p>
    <div class="token-actions">
      <button type="button" class="button danger" data-testid="revoke-yes" onClick=${onRevoke}>${t('settings.agents.revokeYes')}</button>
      <button type="button" class="button" data-testid="revoke-no" ref=${keep} onClick=${onKeep}>${t('settings.agents.keep')}</button>
    </div>
  </div>`;
}

/** @param {{ agentId: string, token: AgentTokenView, run: Run, onChange: () => void }} props */
function TokenRow({ agentId, token, run, onChange }) {
  const [confirming, setConfirming] = useState(false);
  const revoke = () =>
    void run(async () => {
      await API.revokeAgentToken(agentId, token.id);
      setConfirming(false);
      onChange();
    }, t('settings.agents.revokedNow'));
  const revoked = token.revokedAt !== null;
  return html`<li class=${revoked ? 'revoked' : ''} data-testid="agent-token" data-id=${token.id} data-prefix=${token.prefix}>
    <div class="token-head">
      <code class="token-prefix">${token.prefix}…</code>
      ${token.label ? html`<span data-testid="token-label">${token.label}</span>` : null}
      ${revoked ? html`<span class="chip status-rejected" data-testid="token-revoked">${t('settings.agents.revoked')}</span>` : null}
    </div>
    <p class="muted small" data-testid="token-times">
      ${dotted(
        t('settings.created', { time: formatTime(token.createdAt) }),
        token.lastUsedAt ? t('settings.lastUsed', { time: formatTime(token.lastUsedAt) }) : t('settings.agents.notUsed'),
        token.revokedAt ? t('settings.agents.revokedAt', { time: formatTime(token.revokedAt) }) : null,
      )}
    </p>
    ${
      revoked
        ? null
        : confirming
          ? html`<${ConfirmRevoke} token=${token} onRevoke=${revoke} onKeep=${() => setConfirming(false)} />`
          : html`<button type="button" class="link-button" data-testid="token-revoke" onClick=${() => setConfirming(true)}>
              ${t('settings.agents.revoke')}
            </button>`
    }
  </li>`;
}

/** This hour's use of the Agent's limits. @param {{ usage: AgentView['usage'] }} props */
function Usage({ usage }) {
  const line = (/** @type {WindowUsage} */ use, /** @type {string} */ text, /** @type {string} */ testid) =>
    html`<span class=${use.count >= use.limit ? 'warning' : ''} data-testid=${testid}>
      ${text}${use.windowEndsAt ? `, ${t('settings.agents.resets', { time: timeOf(use.windowEndsAt) })}` : ''}
    </span>`;
  const { proposals, reads } = usage;
  return html`<p class="small agent-usage" data-testid="agent-usage">
    ${line(proposals, t('settings.agents.proposals', { count: number(proposals.count), limit: number(proposals.limit) }), 'usage-proposals')}
    ${line(reads, t('settings.agents.reads', { count: number(reads.count), limit: number(reads.limit) }), 'usage-reads')}
  </p>`;
}

/** @param {{ agent: AgentView, onChange: () => void }} props */
function AgentRow({ agent, onChange }) {
  const [issuing, setIssuing] = useState(false);
  const [label, setLabel] = useState('');
  const [issued, setIssued] = useState(/** @type {IssuedAgentToken | null} */ (null));
  const [text, error, run] = useAction();
  const issue = (/** @type {Event} */ e) => {
    e.preventDefault();
    void run(async () => {
      setIssued(await API.issueAgentToken(agent.id, { label: labelOf(label) }));
      setIssuing(false);
      setLabel('');
      onChange();
    });
  };
  return html`<li class="agent" data-testid="agent" data-id=${agent.id} data-name=${agent.name}>
    <div class="member-head">
      <strong>${agent.name}</strong>
      ${agent.disabled ? html`<span class="chip status-rejected" data-testid="agent-disabled">${t('settings.disabled')}</span>` : null}
    </div>
    ${agent.disabled ? html`<p class="small warning">${t('settings.agents.disabledText')}</p>` : null}
    <p class="muted small" data-testid="agent-times">
      ${dotted(
        t('settings.created', { time: formatTime(agent.createdAt) }),
        agent.lastSeenAt ? t('settings.lastSeen', { time: formatTime(agent.lastSeenAt) }) : t('settings.agents.notUsed'),
      )}
    </p>
    <${Usage} usage=${agent.usage} />
    <h4>${t('settings.agents.tokens')}</h4>
    <ul class="plain-list agent-tokens" data-testid="agent-tokens">
      ${agent.tokens.map((tok) => html`<${TokenRow} key=${tok.id} agentId=${agent.id} token=${tok} run=${run} onChange=${onChange} />`)}
    </ul>
    ${issued ? html`<${TokenOnce} token=${issued} title=${t('settings.agents.newToken', { name: agent.name })} onDone=${() => setIssued(null)} />` : null}
    ${
      issuing
        ? html`<form class="agent-form" data-testid="issue-form" onSubmit=${issue}>
            <label class="field"
              ><span>${t('settings.agents.tokenLabel')}</span
              ><input data-testid="issue-label" maxlength=${MAX_TEXT} value=${label} onInput=${(/** @type {Event} */ e) => setLabel(valueOf(e))}
            /></label>
            <div class="token-actions">
              <button type="submit" class="button primary" data-testid="issue-submit">${t('settings.agents.issue')}</button>
              <button type="button" class="button" onClick=${() => setIssuing(false)}>${t('settings.agents.cancel')}</button>
            </div>
          </form>`
        : null
    }
    <div class="member-controls">
      ${
        issuing
          ? null
          : html`<button type="button" class="link-button" data-testid="agent-issue" onClick=${() => (setIssued(null), setIssuing(true))}>
              ${t('settings.agents.issueAnother')}
            </button>`
      }
      <button
        type="button"
        class="link-button"
        data-testid="agent-disable"
        onClick=${() => void run(async () => (await API.setAgentDisabled(agent.id, !agent.disabled), onChange()))}
      >
        ${agent.disabled ? t('settings.enable') : t('settings.disable')}
      </button>
    </div>
    <${Status} text=${text} error=${error} testid="agent-status" />
  </li>`;
}

/** Creates an Agent with its first token, and shows that token once. @param {{ onCreated: () => void }} props */
function CreateAgent({ onCreated }) {
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [created, setCreated] = useState(/** @type {import('./types.js').CreatedAgent | null} */ (null));
  const [text, error, run] = useAction();
  const submit = (/** @type {Event} */ e) => {
    e.preventDefault();
    void run(async () => {
      setCreated(null);
      setCreated(await API.createAgent({ name: name.trim(), tokenLabel: labelOf(label) }));
      setName('');
      setLabel('');
      onCreated();
    });
  };
  return html`<h3>${t('settings.agents.add')}</h3>
    <form class="agent-form" data-testid="agent-create" onSubmit=${submit}>
      <label class="field"
        ><span>${t('settings.agents.name')}</span
        ><input
          required
          data-testid="agent-name"
          maxlength=${MAX_TEXT}
          placeholder=${t('settings.agents.namePlaceholder')}
          value=${name}
          onInput=${(/** @type {Event} */ e) => setName(valueOf(e))}
      /></label>
      <label class="field"
        ><span>${t('settings.agents.tokenLabel')}</span
        ><input data-testid="agent-token-label" maxlength=${MAX_TEXT} value=${label} onInput=${(/** @type {Event} */ e) => setLabel(valueOf(e))}
      /></label>
      <button type="submit" class="button primary" data-testid="agent-create-submit">${t('settings.agents.create')}</button>
    </form>
    <${Status} text=${text} error=${error} testid="agent-create-status" />
    ${
      created
        ? html`<${TokenOnce} token=${created.token} title=${t('settings.agents.firstToken', { name: created.agent.name })} onDone=${() => setCreated(null)} />`
        : null
    }`;
}

/** The Owner's Agents. Settings renders it only for the Owner; the API refuses everyone else. */
export function AgentsSection() {
  const agents = useLoad((signal) => API.listAgents(signal));
  const items = agents.data?.items ?? [];
  return html`<section class="card" data-testid="settings-agents">
    <h2>${t('settings.agents.title')}</h2>
    <p class="muted small">${t('settings.agents.text')}</p>
    <${ErrorLine} error=${agents.error} />
    ${agents.data && items.length === 0 ? html`<p class="muted small" data-testid="no-agents">${t('settings.agents.none')}</p>` : null}
    <ul class="plain-list agents" data-testid="agents">
      ${items.map((a) => html`<${AgentRow} key=${a.id} agent=${a} onChange=${agents.reload} />`)}
    </ul>
    <${CreateAgent} onCreated=${agents.reload} />
  </section>`;
}
