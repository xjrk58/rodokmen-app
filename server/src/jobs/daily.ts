import { permissionsFor } from '@rodokmen/shared';
import type { Db } from '../db/db.js';
import type { Mailer } from '../mail/mailer.js';
import { digestEmail } from '../mail/templates.js';
import { proposalDigestLines } from '../proposals/service.js';
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

export interface JobResult {
  detail: string;
  /** False when part of the work failed and the job should run again on a later tick. */
  complete: boolean;
}

export interface DailyJob {
  name: string;
  /** Prague local time the job runs at, as hour and minute. */
  at: { hour: number; minute: number };
  run(now: Date, day: string): Promise<JobResult>;
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
/** How often one recipient's daily email is tried before it is given up for the day. */
export const MAX_DELIVERY_ATTEMPTS = 3;
/** How often a failing job is tried on one day. */
export const MAX_JOB_ATTEMPTS = 5;
/** A running claim older than this was left by a crash and may be taken over. */
export const STALE_CLAIM_MS = 15 * 60_000;

/**
 * The Editor digest (notifications spec): each Editor gets one email listing every pending
 * Proposal, grouped by author, with links into the review queue. Nothing is sent on days with
 * none pending. Each recipient's delivery is recorded, so a retry sends only to those not yet
 * reached, and a recipient that keeps failing is given up after MAX_DELIVERY_ATTEMPTS.
 */
export async function sendDigests(deps: JobDeps, day: string, job = 'editor-digest'): Promise<JobResult> {
  const pending = await deps.db.selectFrom('proposal').selectAll().where('status', '=', 'pending').orderBy('submitted_at').orderBy('id').execute();
  if (pending.length === 0) return { detail: 'nothing pending', complete: true };
  const lines = await proposalDigestLines(deps.db, pending);
  const accounts = await deps.db.selectFrom('account').selectAll().where('disabled_at', 'is', null).orderBy('id').execute();
  const editors = accounts.filter((a) => permissionsFor(a.role).review);
  const deliveries = new Map(
    (await deps.db.selectFrom('job_delivery').selectAll().where('job', '=', job).where('day', '=', day).execute()).map((d) => [d.account_id, d]),
  );
  let sent = 0;
  let retry = 0;
  for (const editor of editors) {
    const done = deliveries.get(editor.id);
    if (done?.sent_at || (done?.attempts ?? 0) >= MAX_DELIVERY_ATTEMPTS) continue;
    const groups = new Map<string, { author: string; isAgent: boolean; items: Array<{ submittedAt: Date; summary: string; changes: number; link: string }> }>();
    for (const l of lines) {
      const g = groups.get(l.author.id) ?? { author: l.author.displayName, isAgent: l.author.isAgent, items: [] };
      g.items.push({ submittedAt: l.submittedAt, summary: l.note ?? l.first[editor.language], changes: l.changes, link: `${deps.publicOrigin}/#work/review/${l.id}` });
      groups.set(l.author.id, g);
    }
    try {
      await deps.mailer.send(digestEmail({ to: editor.email, language: editor.language, displayName: editor.display_name, groups: [...groups.values()], queueLink: `${deps.publicOrigin}/#work/review` }));
      await deps.db
        .insertInto('job_delivery')
        .values({ job, day, account_id: editor.id, sent_at: deps.clock.now(), attempts: 1 })
        .onConflict((oc) => oc.columns(['job', 'day', 'account_id']).doUpdateSet((eb) => ({ sent_at: deps.clock.now(), attempts: eb('job_delivery.attempts', '+', 1), last_error: null })))
        .execute();
      sent += 1;
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      const row = await deps.db
        .insertInto('job_delivery')
        .values({ job, day, account_id: editor.id, attempts: 1, last_error: message })
        .onConflict((oc) => oc.columns(['job', 'day', 'account_id']).doUpdateSet((eb) => ({ attempts: eb('job_delivery.attempts', '+', 1), last_error: message })))
        .returning('attempts')
        .executeTakeFirstOrThrow();
      if (row.attempts >= MAX_DELIVERY_ATTEMPTS) deps.log?.(`giving up the ${job} email to ${editor.email} for ${day}`, error);
      else retry += 1;
    }
  }
  return { detail: `sent to ${sent} Editors${retry ? `, ${retry} to retry` : ''}`, complete: retry === 0 };
}

/**
 * Deletes image files nobody needs any more: those of Proposals rejected more than 30 days
 * ago, uploads never used in a Proposal after as long, and accepted images that an undo
 * removed 30 days ago (kept until then in case the undo itself is undone). Rows stay, marked deleted.
 */
export async function deleteUnusedImages(deps: JobDeps, now: Date): Promise<JobResult> {
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
        eb('u.orphaned_at', '<', cutoff),
      ]),
    )
    .execute();
  for (const u of uploads) {
    await deps.images.delete(u.storage_key);
    await deps.images.delete(u.display_key);
    await deps.db.updateTable('upload').set({ status: 'deleted', deleted_at: now }).where('id', '=', u.id).execute();
  }
  return { detail: `deleted ${uploads.length} uploads`, complete: true };
}

export function dailyJobs(deps: JobDeps): DailyJob[] {
  return [
    { name: 'editor-digest', at: { hour: 18, minute: 0 }, run: (_now, day) => sendDigests(deps, day) },
    { name: 'delete-unused-images', at: { hour: 3, minute: 30 }, run: (now) => deleteUnusedImages(deps, now) },
  ];
}

/**
 * Runs each daily job once per Prague day, at or after its time. Called every minute. A run is
 * claimed in the database before it starts and marked done only after it finished, so a second
 * server never runs it twice, a crash mid-run is picked up again once the claim is stale, and a
 * failed or incomplete run is retried (at most MAX_JOB_ATTEMPTS times a day).
 */
export class DailyScheduler {
  private inFlight: Promise<string[]> | null = null;

  constructor(
    private readonly deps: JobDeps,
    private readonly jobs: DailyJob[] = dailyJobs(deps),
  ) {}

  /** Runs due jobs; a tick that starts while another is running waits for it instead. */
  async tick(): Promise<string[]> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runDue().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async claim(job: string, day: string, now: Date): Promise<boolean> {
    const stale = new Date(now.getTime() - STALE_CLAIM_MS);
    const claimed = await this.deps.db
      .insertInto('job_run')
      .values({ job, day, status: 'running', claimed_at: now })
      .onConflict((oc) =>
        oc
          .columns(['job', 'day'])
          .doUpdateSet((eb) => ({ status: 'running', claimed_at: now, attempts: eb('job_run.attempts', '+', 1) }))
          .where((eb) =>
            eb.and([
              eb('job_run.status', '!=', 'done'),
              eb('job_run.attempts', '<', MAX_JOB_ATTEMPTS),
              eb.or([eb('job_run.status', '=', 'failed'), eb('job_run.claimed_at', '<', stale)]),
            ]),
          ),
      )
      .returning('job')
      .executeTakeFirst();
    return claimed !== undefined;
  }

  private async runDue(): Promise<string[]> {
    const now = this.deps.clock.now();
    const { day, minutes } = pragueTime(now);
    const ran: string[] = [];
    for (const job of this.jobs) {
      if (minutes < job.at.hour * 60 + job.at.minute) continue;
      if (!(await this.claim(job.name, day, now))) continue;
      let result: JobResult;
      try {
        result = await job.run(now, day);
      } catch (error) {
        result = { detail: (error as Error).message.slice(0, 500), complete: false };
        this.deps.log?.(`daily job ${job.name} failed`, error);
      }
      await this.deps.db
        .updateTable('job_run')
        .set({ status: result.complete ? 'done' : 'failed', finished_at: this.deps.clock.now(), detail: result.detail })
        .where('job', '=', job.name)
        .where('day', '=', day)
        .execute();
      ran.push(job.name);
    }
    return ran;
  }

  /** Ticks every minute. The returned function stops the timer and waits for a running tick. */
  start(intervalMs = 60_000): () => Promise<void> {
    const timer = setInterval(() => {
      this.tick().catch((e: unknown) => this.deps.log?.('daily jobs failed', e));
    }, intervalMs);
    timer.unref();
    return async () => {
      clearInterval(timer);
      await this.inFlight?.catch(() => undefined);
    };
  }
}
