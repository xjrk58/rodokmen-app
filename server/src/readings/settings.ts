import type { ReadingUsage, ScanReadingSettings, UpdateScanReadingBody } from '@rodokmen/shared';
import { sql } from 'kysely';
import { ApiProblem } from '../auth/problem.js';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import type { Account } from '../db/types.js';
import { pragueTime, TIME_ZONE } from '../jobs/daily.js';
import { authorRef } from '../proposals/views.js';

/**
 * The Owner's switch and daily limit of scan reading (scan-reading spec, "The Owner switches it
 * on"), and the usage the Owner sees. Kept in the database, so a switch takes effect at once for
 * every request and for readings still in the queue.
 */
export interface ScanSettings {
  enabled: boolean;
  dailyLimit: number;
  changedAt: Date | null;
  changedBy: string | null;
}

export const DEFAULT_DAILY_LIMIT = 10;
export const USAGE_DAYS = 30;

export async function scanSettings(db: Db): Promise<ScanSettings> {
  const row = await db
    .selectFrom('scan_reading_setting as s')
    .leftJoin('account as a', 'a.id', 's.changed_by')
    .select(['s.enabled', 's.daily_limit', 's.changed_at', 'a.display_name'])
    .executeTakeFirst();
  if (!row) return { enabled: false, dailyLimit: DEFAULT_DAILY_LIMIT, changedAt: null, changedBy: null };
  return { enabled: row.enabled, dailyLimit: row.daily_limit, changedAt: row.changed_at ? new Date(row.changed_at) : null, changedBy: row.display_name };
}

/** The day a reading counts for: today in Prague. */
export const readingDay = (clock: Clock): string => pragueTime(clock.now()).day;

/** When a day in Prague ends: the next day's midnight there, as an instant. */
export function endOfPragueDay(day: string): Date {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextDay = next.toISOString().slice(0, 10);
  // Prague is one or two hours ahead of UTC: the instant whose Prague time is 00:00 of the next day.
  for (const offsetHours of [1, 2, 0, 3]) {
    const at = new Date(next.getTime() - offsetHours * 3_600_000);
    const prague = pragueTime(at);
    if (prague.day === nextDay && prague.minutes === 0) return at;
  }
  throw new Error(`no midnight found in ${TIME_ZONE} after ${day}`);
}

/** Readings an account asked for on a day, failed ones included: each was a request to the reading service, or meant to be. */
export async function readingsOn(db: Db, authorId: string, day: string): Promise<number> {
  const row = await db
    .selectFrom('reading')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('author_id', '=', authorId)
    .where('day', '=', day)
    .executeTakeFirstOrThrow();
  return row.n;
}

/** Readings per Member and day, the last USAGE_DAYS days, newest first. */
export async function readingUsage(db: Db, clock: Clock): Promise<ReadingUsage[]> {
  const today = readingDay(clock);
  const rows = await db
    .selectFrom('reading as r')
    .innerJoin('account as a', 'a.id', 'r.author_id')
    .select([
      sql<string>`to_char(r.day, 'YYYY-MM-DD')`.as('day'),
      'a.id',
      'a.display_name',
      'a.role',
      (eb) => eb.fn.countAll<number>().as('readings'),
      sql<number>`count(*) filter (where r.status = 'failed')`.as('failed'),
    ])
    .where('r.day', '>', sql<string>`${today}::date - ${USAGE_DAYS}::int`)
    .groupBy(['r.day', 'a.id', 'a.display_name', 'a.role'])
    .orderBy('r.day', 'desc')
    .orderBy('a.display_name')
    .execute();
  return rows.map((r) => ({ day: r.day, author: authorRef(r), readings: r.readings, failed: r.failed }));
}

export async function settingsView(db: Db, clock: Clock, reader: { model: string } | null, model: string): Promise<ScanReadingSettings> {
  const s = await scanSettings(db);
  return {
    enabled: s.enabled,
    dailyLimit: s.dailyLimit,
    configured: reader !== null,
    model: reader?.model ?? model,
    changedAt: s.changedAt?.toISOString() ?? null,
    changedBy: s.changedBy,
    usage: await readingUsage(db, clock),
  };
}

/** The Owner switches scan reading on or off and sets the daily limit. It cannot be switched on without an API key. */
export async function updateScanSettings(db: Db, clock: Clock, owner: Account, body: UpdateScanReadingBody, configured: boolean): Promise<void> {
  if (body.enabled && !configured)
    throw new ApiProblem(409, 'not_configured', 'Scan reading needs an Anthropic API key in the server’s environment (ANTHROPIC_API_KEY, deploy/README.md).');
  await db
    .insertInto('scan_reading_setting')
    .values({ id: true, enabled: body.enabled, daily_limit: body.dailyLimit, changed_by: owner.id, changed_at: clock.now() })
    .onConflict((oc) => oc.column('id').doUpdateSet({ enabled: body.enabled, daily_limit: body.dailyLimit, changed_by: owner.id, changed_at: clock.now() }))
    .execute();
}
