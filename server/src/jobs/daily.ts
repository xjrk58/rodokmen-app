import { sql } from 'kysely';
import type { Db } from '../db/db.js';
import type { Mailer } from '../mail/mailer.js';
import { digestEmail } from '../mail/templates.js';
import { proposalViews } from '../proposals/service.js';
import type { ImageStorage } from '../storage/images.js';
import type { Clock } from '../tree/summaries.js';

export const TIME_ZONE = 'Europe/Prague';

/** The day and minute of the day in Prague for an instant, so jobs follow local time across DST. */
export function pragueTime(at: Date): { day: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export interface DailyJob {
  name: string;
  /** Prague local time the job runs at, as hour and minute. */
  at: { hour: number; minute: number };
  run(now: Date): Promise<string>;
}

export interface JobDeps {
  db: Db;
  clock: Clock;
  mailer: Mailer;
  images: ImageStorage;
  publicOrigin: string;
  log?: (msg: string, error?: unknown) => void;
}

/** Rejected Proposals keep their images this long, for the author and Editors (evidence-media spec). */
export const REJECTED_IMAGE_DAYS = 30;

/**
 * The Editor digest (notifications spec): each Editor gets one email listing every pending
 * Proposal, grouped by author, with links into the review queue. Nothing is sent on days
 * with none pending.
 */
export async function sendDigests(deps: JobDeps): Promise<number> {
  const pending = await deps.db.selectFrom('proposal').selectAll().where('status', '=', 'pending').orderBy('submitted_at').orderBy('id').execute();
  if (pending.length === 0) return 0;
  const views = await proposalViews(deps.db, pending);
  const editors = await deps.db.selectFrom('account').selectAll().where('role', 'in', ['editor', 'owner']).where('disabled_at', 'is', null).orderBy('id').execute();
  for (const editor of editors) {
    const groups = new Map<string, { author: string; isAgent: boolean; items: Array<{ submittedAt: Date; summary: string; changes: number; link: string }> }>();
    for (const v of views) {
      const g = groups.get(v.author.id) ?? { author: v.author.displayName, isAgent: v.author.isAgent, items: [] };
      g.items.push({
        submittedAt: new Date(v.submittedAt),
        summary: v.note?.trim() || v.operations[0]?.summary[editor.language] || '',
        changes: v.operations.length,
        link: `${deps.publicOrigin}/#work/review/${v.id}`,
      });
      groups.set(v.author.id, g);
    }
    await deps.mailer.send(digestEmail({ to: editor.email, language: editor.language, displayName: editor.display_name, groups: [...groups.values()], queueLink: `${deps.publicOrigin}/#work/review` }));
  }
  return editors.length;
}

/**
 * Deletes the images of Proposals rejected more than 30 days ago, and uploads never used in a
 * Proposal after as long. Their rows stay, marked deleted.
 */
export async function deleteRejectedImages(deps: JobDeps, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - REJECTED_IMAGE_DAYS * 86_400_000);
  const uploads = await deps.db
    .selectFrom('upload as u')
    .leftJoin('proposal as p', 'p.id', 'u.proposal_id')
    .select(['u.id', 'u.storage_key', 'u.display_key'])
    .where('u.status', '!=', 'deleted')
    .where('u.image_id', 'is', null)
    .where((eb) =>
      eb.or([
        eb.and([eb('p.status', '=', 'rejected'), eb('p.decided_at', '<', cutoff)]),
        eb.and([eb('u.proposal_id', 'is', null), eb('u.created_at', '<', cutoff)]),
      ]),
    )
    .execute();
  for (const u of uploads) {
    await deps.images.delete(u.storage_key);
    await deps.images.delete(u.display_key);
    await deps.db.updateTable('upload').set({ status: 'deleted', deleted_at: now }).where('id', '=', u.id).execute();
  }
  return uploads.length;
}

export function dailyJobs(deps: JobDeps): DailyJob[] {
  return [
    { name: 'editor-digest', at: { hour: 18, minute: 0 }, run: async () => `sent to ${await sendDigests(deps)} Editors` },
    { name: 'delete-rejected-images', at: { hour: 3, minute: 30 }, run: async (now) => `deleted ${await deleteRejectedImages(deps, now)} uploads` },
  ];
}

/**
 * Runs each daily job once per Prague day, at or after its time. Called every minute; which
 * day each job ran is kept in the database, so a restart or a second server does not repeat it.
 */
export class DailyScheduler {
  constructor(
    private readonly deps: JobDeps,
    private readonly jobs: DailyJob[] = dailyJobs(deps),
  ) {}

  async tick(): Promise<string[]> {
    const now = this.deps.clock.now();
    const { day, minutes } = pragueTime(now);
    const ran: string[] = [];
    for (const job of this.jobs) {
      if (minutes < job.at.hour * 60 + job.at.minute) continue;
      const claimed = await this.deps.db.insertInto('job_run').values({ job: job.name, day, ran_at: sql`now()` as never }).onConflict((oc) => oc.doNothing()).returning('job').executeTakeFirst();
      if (!claimed) continue;
      try {
        const detail = await job.run(now);
        await this.deps.db.updateTable('job_run').set({ detail }).where('job', '=', job.name).where('day', '=', day).execute();
        ran.push(job.name);
      } catch (error) {
        // Give the job another chance on the next tick.
        await this.deps.db.deleteFrom('job_run').where('job', '=', job.name).where('day', '=', day).execute();
        this.deps.log?.(`daily job ${job.name} failed`, error);
      }
    }
    return ran;
  }

  start(intervalMs = 60_000): () => void {
    const timer = setInterval(() => void this.tick().catch((e) => this.deps.log?.('daily jobs failed', e)), intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}
