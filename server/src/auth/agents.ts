import { randomBytes } from 'node:crypto';
import { AGENT_TOKEN_PATTERN, type AgentTokenView, type AgentView, type IssuedAgentToken } from '@rodokmen/shared';
import type { Db } from '../db/db.js';
import type { Account, AgentTokenTable } from '../db/types.js';
import type { Clock } from '../clock.js';
import type { Selectable } from 'kysely';
import { usageOf } from './limits.js';
import { ApiProblem } from './problem.js';
import { hashToken } from './sessions.js';

/**
 * Agent accounts and their tokens (agent-access spec, "Agent accounts belong to the Owner").
 * Only the Owner creates Agents (the routes ask the role-and-action rule). A token is a random
 * 256-bit value written as `rdk_ag_` and 64 hex digits; it is returned once, when issued, and
 * only its SHA-256 hash is stored, with a short prefix the Owner can read in the token list.
 */
export interface AgentDeps {
  db: Db;
  clock: Clock;
}

/** Visible characters of a token: `rdk_ag_` and the first 8 hex digits (32 of its 256 bits). */
const PREFIX_LENGTH = 'rdk_ag_'.length + 8;
/** A token's last use is written at most this often. */
const TOUCH_MS = 60_000;

export function newAgentToken(): { token: string; hash: Buffer; prefix: string } {
  const token = `rdk_ag_${randomBytes(32).toString('hex')}`;
  return { token, hash: hashToken(token), prefix: token.slice(0, PREFIX_LENGTH) };
}

const iso = (d: Date | string | null): string | null => (d === null ? null : new Date(d).toISOString());

function tokenView(t: Selectable<AgentTokenTable>): AgentTokenView {
  return { id: t.id, prefix: t.prefix, label: t.label, createdAt: iso(t.created_at)!, lastUsedAt: iso(t.last_used_at), revokedAt: iso(t.revoked_at) };
}

async function agentViews(deps: AgentDeps, agents: Account[]): Promise<AgentView[]> {
  if (agents.length === 0) return [];
  const ids = agents.map((a) => a.id);
  const tokens = await deps.db
    .selectFrom('agent_token')
    .selectAll()
    .where('account_id', 'in', ids)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const usage = await usageOf(deps.db, deps.clock, ids);
  return agents.map((a) => ({
    id: a.id,
    name: a.display_name,
    disabled: a.disabled_at !== null,
    createdAt: iso(a.created_at)!,
    lastSeenAt: iso(a.last_seen_at),
    tokens: tokens.filter((t) => t.account_id === a.id).map(tokenView),
    usage: usage.get(a.id)!,
  }));
}

async function loadAgent(db: Db, id: string): Promise<Account> {
  const a = await db.selectFrom('account').selectAll().where('id', '=', id).where('role', '=', 'agent').executeTakeFirst();
  if (!a) throw new ApiProblem(404, 'not_found', 'No Agent with this id.');
  return a;
}

export async function listAgents(deps: AgentDeps): Promise<AgentView[]> {
  const rows = await deps.db.selectFrom('account').selectAll().where('role', '=', 'agent').orderBy('display_name').orderBy('id').execute();
  return agentViews(deps, rows);
}

export async function getAgent(deps: AgentDeps, id: string): Promise<AgentView> {
  return (await agentViews(deps, [await loadAgent(deps.db, id)]))[0]!;
}

async function insertToken(tx: Db, now: Date, owner: Account, agentId: string, label: string | null): Promise<IssuedAgentToken> {
  const { token, hash, prefix } = newAgentToken();
  const row = await tx
    .insertInto('agent_token')
    .values({ account_id: agentId, token_hash: hash, prefix, label, created_by: owner.id, created_at: now })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { ...tokenView(row), token };
}

/** Creates an Agent with its first token, which this answer shows in full for the only time. */
export async function createAgent(
  deps: AgentDeps,
  owner: Account,
  name: string,
  tokenLabel: string | null,
): Promise<{ agent: AgentView; token: IssuedAgentToken }> {
  const now = deps.clock.now();
  const { account, token } = await deps.db.transaction().execute(async (tx) => {
    const account = await tx
      .insertInto('account')
      .values({ email: null, display_name: name.trim(), language: owner.language, role: 'agent', invited_by: owner.id, outcome_emails: false, created_at: now })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { account, token: await insertToken(tx, now, owner, account.id, tokenLabel) };
  });
  return { agent: (await agentViews(deps, [account]))[0]!, token };
}

/** Issues another token for an Agent, shown in full only in this answer. */
export async function issueAgentToken(deps: AgentDeps, owner: Account, agentId: string, label: string | null): Promise<IssuedAgentToken> {
  await loadAgent(deps.db, agentId);
  return insertToken(deps.db, deps.clock.now(), owner, agentId, label);
}

/** Revokes a token at once: the next request with it is refused with 401. Revoking twice changes nothing. */
export async function revokeAgentToken(deps: AgentDeps, agentId: string, tokenId: string): Promise<void> {
  const row = await deps.db
    .updateTable('agent_token')
    .set((eb) => ({ revoked_at: eb.fn.coalesce('revoked_at', eb.val(deps.clock.now())) }))
    .where('id', '=', tokenId)
    .where('account_id', '=', agentId)
    .returning('id')
    .executeTakeFirst();
  if (!row) throw new ApiProblem(404, 'not_found', 'No token of this Agent with this id.');
}

/** Stops an Agent at once: none of its tokens works while it is disabled. */
export async function setAgentDisabled(deps: AgentDeps, agentId: string, disabled: boolean): Promise<AgentView> {
  const agent = await loadAgent(deps.db, agentId);
  const updated = await deps.db
    .updateTable('account')
    .set({ disabled_at: disabled ? (agent.disabled_at ?? deps.clock.now()) : null })
    .where('id', '=', agent.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  return (await agentViews(deps, [updated]))[0]!;
}

export interface ResolvedAgent {
  account: Account;
  tokenId: string;
}

/**
 * The Agent a bearer token belongs to: the token is known and not revoked, and its Agent is
 * not disabled. Read on every request, so revoking and disabling apply at once.
 */
export async function resolveAgentToken(db: Db, clock: Clock, token: string): Promise<ResolvedAgent | null> {
  if (!AGENT_TOKEN_PATTERN.test(token)) return null;
  const row = await db
    .selectFrom('agent_token as t')
    .innerJoin('account as a', 'a.id', 't.account_id')
    .selectAll('a')
    .select(['t.id as token_id', 't.last_used_at as token_used_at'])
    .where('t.token_hash', '=', hashToken(token))
    .where('t.revoked_at', 'is', null)
    .where('a.role', '=', 'agent')
    .where('a.disabled_at', 'is', null)
    .executeTakeFirst();
  if (!row) return null;
  const { token_id, token_used_at, ...account } = row;
  const now = clock.now();
  if (token_used_at === null || now.getTime() - new Date(token_used_at).getTime() > TOUCH_MS) {
    await db.updateTable('agent_token').set({ last_used_at: now }).where('id', '=', token_id).execute();
    await db.updateTable('account').set({ last_seen_at: now }).where('id', '=', account.id).execute();
  }
  return { account, tokenId: token_id };
}
