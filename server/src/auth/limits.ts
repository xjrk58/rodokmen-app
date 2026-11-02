import { AGENT_BATCH_REQUESTS_PER_HOUR, AGENT_PROPOSALS_PER_HOUR, AGENT_READS_PER_HOUR, fixedWindow } from '@rodokmen/shared';
import { sql } from 'kysely';
import type { Db } from '../db/db.js';
import type { AgentRateWindowTable } from '../db/types.js';
import type { Clock } from '../clock.js';

/**
 * Hourly limits for Agents (agent-access spec, "Rate limits"): 60 submitted Proposals, and
 * 1,000 other requests (reads, and uploads of images for Proposals). One fixed window per
 * Agent and kind, shared by all of the Agent's tokens, kept in PostgreSQL. The decision is
 * fixedWindow (shared/src/rules.ts, proved); this shell reads and writes the window under a
 * lock per Agent and kind, so simultaneous requests cannot all see room under the limit.
 */
export type LimitKind = AgentRateWindowTable['kind'];

export const WINDOW_MS = 3_600_000;
/** The batch window counts an Agent's requests to its Import batches (agent-access spec, "Import batches have their own limit"). */
export const LIMITS: Record<LimitKind, number> = { proposal: AGENT_PROPOSALS_PER_HOUR, read: AGENT_READS_PER_HOUR, batch: AGENT_BATCH_REQUESTS_PER_HOUR };

export type Slot = { allowed: true } | { allowed: false; retryAt: Date };

/** Counts one request of an Agent, or refuses it with the time the current window ends. */
export async function takeSlot(db: Db, clock: Clock, accountId: string, kind: LimitKind): Promise<Slot> {
  const now = clock.now().getTime();
  return db.transaction().execute(async (tx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`agent-limit:${accountId}:${kind}`}))`.execute(tx);
    const row = await tx
      .selectFrom('agent_rate_window')
      .select(['window_start', 'count'])
      .where('account_id', '=', accountId)
      .where('kind', '=', kind)
      .executeTakeFirst();
    // No window yet: a fresh one, opening now, with nothing counted.
    const decision = fixedWindow(row ? new Date(row.window_start).getTime() : now, row?.count ?? 0, LIMITS[kind], WINDOW_MS, now);
    if (!decision.allowed) return { allowed: false, retryAt: new Date(decision.retryAt) };
    const values = { window_start: new Date(decision.windowStart), count: decision.count };
    await tx
      .insertInto('agent_rate_window')
      .values({ account_id: accountId, kind, ...values })
      .onConflict((oc) => oc.columns(['account_id', 'kind']).doUpdateSet(values))
      .execute();
    return { allowed: true };
  });
}

export interface WindowUsage {
  count: number;
  limit: number;
  windowEndsAt: string | null;
}

/** What each Agent used in its current windows, for the Owner's Agent list. */
export async function usageOf(db: Db, clock: Clock, accountIds: readonly string[]): Promise<Map<string, { proposals: WindowUsage; reads: WindowUsage }>> {
  const now = clock.now().getTime();
  const rows = accountIds.length
    ? await db
        .selectFrom('agent_rate_window')
        .selectAll()
        .where('account_id', 'in', [...accountIds])
        .execute()
    : [];
  const usage = (id: string, kind: LimitKind): WindowUsage => {
    const r = rows.find((x) => x.account_id === id && x.kind === kind);
    const ends = r ? new Date(r.window_start).getTime() + WINDOW_MS : 0;
    if (!r || ends <= now) return { count: 0, limit: LIMITS[kind], windowEndsAt: null };
    return { count: r.count, limit: LIMITS[kind], windowEndsAt: new Date(ends).toISOString() };
  };
  return new Map(accountIds.map((id) => [id, { proposals: usage(id, 'proposal'), reads: usage(id, 'read') }]));
}
