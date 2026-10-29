import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/db.js';
import type { Account, SessionTable } from '../db/types.js';
import type { Clock } from '../tree/summaries.js';

export const SESSION_COOKIE = 'rdk_session';

/** A random 256-bit token for a cookie or a link. Only its SHA-256 hash is stored. */
export function newToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export interface SessionOptions {
  idleDays: number;
}

export async function createSession(
  db: Db,
  clock: Clock,
  options: SessionOptions,
  accountId: string,
  method: SessionTable['method'],
  userAgent: string | undefined,
): Promise<{ token: string; id: string; expiresAt: Date }> {
  const { token, hash } = newToken();
  const now = clock.now();
  const expiresAt = new Date(now.getTime() + options.idleDays * 86_400_000);
  const row = await db
    .insertInto('session')
    .values({ token_hash: hash, account_id: accountId, method, user_agent: userAgent?.slice(0, 400) ?? null, created_at: now, last_seen_at: now, expires_at: expiresAt })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db.updateTable('account').set({ last_seen_at: now }).where('id', '=', accountId).execute();
  return { token, id: row.id, expiresAt };
}

export interface ResolvedSession {
  sessionId: string;
  account: Account;
  refreshed: Date | null;
}

/**
 * The live session for a cookie token: not ended, not expired, and its Member not disabled.
 * The role is read from the account on every request, so role changes apply at once.
 * Sessions slide: each use (at most once an hour) extends the expiry by the idle period.
 */
export async function resolveSession(db: Db, clock: Clock, options: SessionOptions, token: string): Promise<ResolvedSession | null> {
  if (token.length < 20 || token.length > 100) return null;
  const now = clock.now();
  const row = await db
    .selectFrom('session as s')
    .innerJoin('account as a', 'a.id', 's.account_id')
    .selectAll('a')
    .select(['s.id as session_id', 's.last_seen_at as session_seen'])
    .where('s.token_hash', '=', hashToken(token))
    .where('s.ended_at', 'is', null)
    .where('s.expires_at', '>', now)
    .where('a.disabled_at', 'is', null)
    .executeTakeFirst();
  if (!row) return null;
  const { session_id, session_seen, ...account } = row;
  let refreshed: Date | null = null;
  if (now.getTime() - new Date(session_seen).getTime() > 3_600_000) {
    refreshed = new Date(now.getTime() + options.idleDays * 86_400_000);
    await db.updateTable('session').set({ last_seen_at: now, expires_at: refreshed }).where('id', '=', session_id).execute();
    await db.updateTable('account').set({ last_seen_at: now }).where('id', '=', account.id).execute();
  }
  return { sessionId: session_id, account: account as Account, refreshed };
}

export async function endSession(db: Db, clock: Clock, sessionId: string): Promise<void> {
  await db.updateTable('session').set({ ended_at: clock.now() }).where('id', '=', sessionId).where('ended_at', 'is', null).execute();
}

export async function endAllSessions(db: Db, clock: Clock, accountId: string): Promise<number> {
  const result = await db.updateTable('session').set({ ended_at: clock.now() }).where('account_id', '=', accountId).where('ended_at', 'is', null).executeTakeFirst();
  return Number(result.numUpdatedRows);
}
