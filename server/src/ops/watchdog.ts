import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Clock } from '../clock.js';
import { messageOf, stringField } from '../errors.js';

/**
 * Alerts for the Owner (operations spec, "Health and alerts"):
 * - the health check has failed for more than 5 minutes (one alert, and one on recovery);
 * - a nightly Backup failed (one alert per failed run), or none has succeeded for 26 hours
 *   (the job did not run or hung).
 * The watchdog runs next to the API on the VPS and checks the public URL, so it notices
 * Caddy, certificate and API failures alike. An alert counts as given only once it has been
 * sent: if sending fails (the mail service is down), the next tick tries again.
 */
export const HEALTH_ALERT_AFTER_MS = 5 * 60_000;
export const BACKUP_MAX_AGE_MS = 26 * 3_600_000;

/** Written by deploy/backup/backup.sh at the end of every run, successful or not. */
export const BackupStatus = z.object({
  ok: z.boolean(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  snapshot: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});
export type BackupStatus = z.infer<typeof BackupStatus>;

export interface WatchdogOptions {
  checkHealth: () => Promise<{ ok: boolean; detail: string }>;
  readBackupStatus?: () => Promise<BackupStatus | null>;
  alert: (subject: string, details: string) => Promise<void>;
  clock: Clock;
  healthAlertAfterMs?: number;
  backupMaxAgeMs?: number;
}

export class Watchdog {
  private failingSince: Date | null = null;
  private lastFailure = '';
  private healthAlerted = false;
  private readonly startedAt: Date;
  private readonly backupAlerts = new Set<string>();

  constructor(private readonly o: WatchdogOptions) {
    this.startedAt = o.clock.now();
  }

  /** One round of checks. Throws if an alert could not be sent, after running every check. */
  async tick(): Promise<void> {
    const failed: unknown[] = [];
    await this.tickHealth().catch((error: unknown) => failed.push(error));
    if (this.o.readBackupStatus) await this.tickBackup().catch((error: unknown) => failed.push(error));
    if (failed.length) throw new AggregateError(failed, 'an alert could not be sent; it is tried again on the next tick');
  }

  private async tickHealth(): Promise<void> {
    const now = this.o.clock.now();
    let result: { ok: boolean; detail: string };
    try {
      result = await this.o.checkHealth();
    } catch (error) {
      result = { ok: false, detail: messageOf(error) };
    }
    if (result.ok) {
      if (this.healthAlerted) {
        await this.o.alert('Health check recovered', `The health check passes again since ${now.toISOString()}.\nIt had been failing since ${this.failingSince?.toISOString()}.`);
      }
      this.failingSince = null;
      this.healthAlerted = false;
      return;
    }
    this.failingSince ??= now;
    this.lastFailure = result.detail;
    const failingFor = now.getTime() - this.failingSince.getTime();
    if (!this.healthAlerted && failingFor >= (this.o.healthAlertAfterMs ?? HEALTH_ALERT_AFTER_MS)) {
      await this.o.alert(
        `Health check failing for ${Math.round(failingFor / 60_000)} minutes`,
        `The health check has failed since ${this.failingSince.toISOString()}.\nLast answer: ${this.lastFailure}`,
      );
      this.healthAlerted = true;
    }
  }

  private async tickBackup(): Promise<void> {
    const now = this.o.clock.now();
    const maxAge = this.o.backupMaxAgeMs ?? BACKUP_MAX_AGE_MS;
    const once = async (key: string, subject: string, details: string) => {
      if (this.backupAlerts.has(key)) return;
      await this.o.alert(subject, details);
      this.backupAlerts.add(key);
    };
    let status: BackupStatus | null;
    try {
      status = (await this.o.readBackupStatus?.()) ?? null;
    } catch (error) {
      // Once per stretch of unreadable files: a good read in between allows the next alert.
      await once('unreadable', 'Backup status unreadable', `The status file of the nightly Backup could not be read: ${messageOf(error)}`);
      return;
    }
    this.backupAlerts.delete('unreadable');
    if (status === null) {
      if (now.getTime() - this.startedAt.getTime() >= maxAge) await once('missing', 'No Backup recorded', `No Backup has reported since the watchdog started at ${this.startedAt.toISOString()}.`);
      return;
    }
    if (!status.ok) {
      await once(`failed:${status.finishedAt}`, 'Nightly Backup failed', `The Backup started at ${status.startedAt} failed at ${status.finishedAt}.\n${status.error ?? ''}`);
      return;
    }
    const age = now.getTime() - new Date(status.finishedAt).getTime();
    if (age >= maxAge) await once(`stale:${status.finishedAt}`, 'Nightly Backup missing', `The last successful Backup finished at ${status.finishedAt}, ${Math.round(age / 3_600_000)} hours ago.`);
  }
}

export async function httpHealthCheck(url: string, timeoutMs = 10_000): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    const body = (await res.text()).slice(0, 300);
    return { ok: res.status === 200, detail: `HTTP ${res.status} ${body}` };
  } catch (error) {
    return { ok: false, detail: `no answer: ${messageOf(error)}` };
  }
}

export function backupStatusReader(path: string): () => Promise<BackupStatus | null> {
  return async () => {
    try {
      const parsed = BackupStatus.safeParse(JSON.parse(await readFile(path, 'utf8')));
      if (!parsed.success) throw new Error(`not a Backup status: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      return parsed.data;
    } catch (error) {
      if (stringField(error, 'code') === 'ENOENT') return null;
      throw error;
    }
  };
}
