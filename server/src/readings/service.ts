import { mayRead, ReadingContext, ReadingCrop, ReadingResult, type CreateReadingBody, type ReadingStatusView, type ReadingView } from '@rodokmen/shared';
import { sql } from 'kysely';
import { ApiProblem } from '../auth/problem.js';
import type { Clock } from '../clock.js';
import type { Db } from '../db/db.js';
import type { Account, Reading } from '../db/types.js';
import { authorRef, canReview } from '../proposals/views.js';
import type { ImageStorage } from '../storage/images.js';
import { housesFor, matchesFor } from './candidates.js';
import type { ReadingJobs } from './jobs.js';
import { leadsFor } from './leads.js';
import type { Reader } from './reader.js';
import { endOfPragueDay, readingDay, readingsOn, scanSettings } from './settings.js';

/**
 * Asking for readings and reading them back (scan-reading spec). Scan reading answers 404 while
 * it is switched off (or the server has no API key), so the app hides it; a Member at their
 * daily limit is refused with 429 until the next day in Prague, and can still fill in the forms
 * by hand. The decision is mayRead (shared/src/reading.ts, proved); this shell counts the day's
 * readings under a lock per Member and day, so two requests at once cannot both pass the limit.
 */
export interface ReadingDeps {
  db: Db;
  clock: Clock;
  images: ImageStorage;
  reader: Reader | null;
  jobs: ReadingJobs;
  /** The configured model, shown to the Owner even without a key. */
  model: string;
  log?: (msg: string, error?: unknown) => void;
}

export const SWITCHED_OFF_MESSAGE = 'Scan reading is not switched on.';

/** 404 while scan reading is off: to the app it does not exist. */
export async function assertSwitchedOn(deps: Pick<ReadingDeps, 'db' | 'reader'>): Promise<{ dailyLimit: number }> {
  const settings = await scanSettings(deps.db);
  if (!settings.enabled || !deps.reader) throw new ApiProblem(404, 'not_found', SWITCHED_OFF_MESSAGE);
  return settings;
}

export async function readingStatus(deps: ReadingDeps, member: Account): Promise<ReadingStatusView> {
  const { dailyLimit } = await assertSwitchedOn(deps);
  const usedToday = await readingsOn(deps.db, member.id, readingDay(deps.clock));
  return { dailyLimit, usedToday, remaining: Math.max(0, dailyLimit - usedToday) };
}

/**
 * The scans a Member may have read (scan-reading spec, "Only scans the Member supplies";
 * evidence-media spec, "Images sent for reading"): their own finished uploads, and images
 * already attached to a Citation. Never portraits, and never anything fetched from elsewhere.
 */
async function assertReadable(db: Db, member: Account, uploadIds: readonly string[]): Promise<void> {
  const rows = await db
    .selectFrom('upload as u')
    .leftJoin('image as i', 'i.id', 'u.image_id')
    .select(['u.id', 'u.author_id', 'u.status', 'u.image_id', 'i.kind', 'i.citation_id'])
    .where('u.id', 'in', [...uploadIds])
    .execute();
  for (const id of uploadIds) {
    const u = rows.find((r) => r.id === id);
    const attached = u?.image_id !== null && u?.image_id !== undefined && u.citation_id !== null;
    if (!u || u.status === 'deleted' || (u.author_id !== member.id && !attached))
      throw new ApiProblem(404, 'not_found', 'No image of yours, or of a Citation, with this id.');
    if (u.status !== 'ready') throw new ApiProblem(409, 'not_ready', 'This image is still being uploaded. Finish the upload first.');
    if (u.kind === 'portrait') throw new ApiProblem(400, 'not_a_scan', 'Portraits are never sent for reading.');
  }
}

/** Queues a reading of the Member's scans, within their daily limit. */
export async function requestReading(deps: ReadingDeps, member: Account, body: CreateReadingBody): Promise<ReadingView> {
  const { db, clock } = deps;
  await assertSwitchedOn(deps);
  await assertReadable(db, member, body.uploadIds);
  const day = readingDay(clock);
  const row = await db.transaction().execute(async (tx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`reading-limit:${member.id}:${day}`}))`.execute(tx);
    const settings = await scanSettings(tx);
    const decision = mayRead(settings.enabled && deps.reader !== null, await readingsOn(tx, member.id, day), settings.dailyLimit);
    if (!decision.allowed && decision.reason === 'off') throw new ApiProblem(404, 'not_found', SWITCHED_OFF_MESSAGE);
    if (!decision.allowed) {
      const retryAt = endOfPragueDay(day);
      throw new ApiProblem(
        429,
        'daily_limit',
        `You have used today’s ${settings.dailyLimit} readings. Reading works again tomorrow; until then, fill in the form by hand.`,
        { retryAt: retryAt.toISOString() },
      );
    }
    return tx
      .insertInto('reading')
      .values({
        author_id: member.id,
        upload_ids: body.uploadIds,
        crops: JSON.stringify(body.crops),
        context: JSON.stringify(body.context),
        day,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  });
  deps.jobs.enqueue(row.id);
  return readingView(deps, row, member);
}

export async function getReadingRow(db: Db, member: Account, id: string): Promise<Reading> {
  const row = await db.selectFrom('reading').selectAll().where('id', '=', id).executeTakeFirst();
  // Like a Proposal before it is accepted: its author and the Editors.
  if (!row || (row.author_id !== member.id && !canReview(member))) throw new ApiProblem(404, 'not_found', 'No reading of yours with this id.');
  return row;
}

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

/** A reading as the app and Agents see it: once done, with match candidates, Houses and suggested leads from the Tree as it is now. */
export async function readingView(deps: Pick<ReadingDeps, 'db' | 'clock'>, row: Reading, viewer?: Account): Promise<ReadingView> {
  const { db, clock } = deps;
  const author =
    viewer && viewer.id === row.author_id ? viewer : await db.selectFrom('account').selectAll().where('id', '=', row.author_id).executeTakeFirstOrThrow();
  const context = ReadingContext.parse(row.context);
  const result = row.status === 'done' && row.result ? ReadingResult.parse(row.result) : null;
  return {
    id: row.id,
    status: row.status,
    author: authorRef(author),
    uploadIds: row.upload_ids,
    crops: ReadingCrop.array().parse(row.crops),
    context,
    model: row.model,
    createdAt: iso(row.created_at)!,
    finishedAt: iso(row.finished_at),
    result,
    error: row.status === 'failed' ? { code: row.error_code ?? 'failed', message: row.error_message ?? 'The reading failed.' } : null,
    matches: result ? await matchesFor(db, clock, result, context.placeId) : [],
    houses: result ? await housesFor(db, result, context.placeId) : [],
    leads: result ? await leadsFor(db, result, context.placeId) : [],
  };
}
