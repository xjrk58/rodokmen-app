import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { SmtpMailer } from '../src/mail/mailer.js';
import { signInLinkEmail } from '../src/mail/templates.js';
import { backupStatusReader, BACKUP_MAX_AGE_MS, HEALTH_ALERT_AFTER_MS, Watchdog } from '../src/ops/watchdog.js';
import { createImageStorage, IMAGE_LINK_SECONDS } from '../src/storage/images.js';
import { MINUTE, TestClock } from './helpers.js';

describe('presigned image links (no network)', () => {
  const clock = new TestClock(new Date('2026-10-29T10:00:00Z'));
  const s3 = loadConfig({
    NODE_ENV: 'test',
    S3_ENDPOINT: 'https://fsn1.your-objectstorage.com',
    S3_REGION: 'fsn1',
    S3_BUCKET: 'rodokmen-images',
    S3_ACCESS_KEY_ID: 'AKEXAMPLE',
    S3_SECRET_ACCESS_KEY: 'secret',
  }).s3;
  const storage = createImageStorage(s3, clock);

  it('signs a GET for the private bucket, valid for 5 minutes', async () => {
    const { url, expiresAt } = await storage.link('citations/abc/page-1.jpg', 'image/jpeg');
    const u = new URL(url);
    expect(u.origin).toBe('https://fsn1.your-objectstorage.com');
    expect(u.pathname).toBe('/rodokmen-images/citations/abc/page-1.jpg');
    expect(u.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(u.searchParams.get('X-Amz-Credential')).toBe('AKEXAMPLE/20261029/fsn1/s3/aws4_request');
    expect(u.searchParams.get('X-Amz-Date')).toBe('20261029T100000Z');
    expect(u.searchParams.get('X-Amz-Expires')).toBe(String(IMAGE_LINK_SECONDS));
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(u.searchParams.get('response-content-type')).toBe('image/jpeg');
    expect(expiresAt.toISOString()).toBe('2026-10-29T10:05:00.000Z');
  });

  it('shared image link: opened 30 minutes later, the link has expired (the spec allows at most 10)', async () => {
    const { url } = await storage.link('portraits/x.webp', 'image/webp');
    const u = new URL(url);
    const signed = u.searchParams.get('X-Amz-Date')!.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
    const validUntil = new Date(signed).getTime() + Number(u.searchParams.get('X-Amz-Expires')) * 1000;
    expect(validUntil - clock.now().getTime()).toBeLessThanOrEqual(10 * MINUTE);
    expect(clock.now().getTime() + 30 * MINUTE).toBeGreaterThan(validUntil);
  });

  it('signs differently for each key and each moment', async () => {
    const a = (await storage.link('a.jpg', 'image/jpeg')).url;
    const b = (await storage.link('b.jpg', 'image/jpeg')).url;
    clock.advance(1000);
    const a2 = (await storage.link('a.jpg', 'image/jpeg')).url;
    expect(new Set([a, b, a2]).size).toBe(3);
  });
});

describe('watchdog alerts for the Owner', () => {
  function setup(health: boolean[], backup: Array<ReturnType<typeof okBackup> | null> = []) {
    const clock = new TestClock(new Date('2026-10-29T02:00:00Z'));
    const alerts: Array<{ subject: string; details: string; at: string }> = [];
    let h = 0;
    let bk = 0;
    const watchdog = new Watchdog({
      clock,
      checkHealth: async () => ({ ok: health[Math.min(h++, health.length - 1)]!, detail: 'HTTP 503 {"status":"degraded"}' }),
      readBackupStatus: backup.length ? async () => backup[Math.min(bk++, backup.length - 1)]! : undefined,
      alert: async (subject, details) => void alerts.push({ subject, details, at: clock.now().toISOString() }),
    });
    return { clock, alerts, watchdog };
  }
  const okBackup = (finishedAt: string, ok = true) => ({ ok, startedAt: finishedAt, finishedAt, snapshot: ok ? 'abc123' : null, error: ok ? null : 'restic: wrong password' });

  it('alerts once when the health check fails for more than 5 minutes, and once on recovery', async () => {
    const { clock, alerts, watchdog } = setup([...Array(13).fill(false), true]);
    for (let i = 0; i < 13; i++) {
      await watchdog.tick();
      clock.advance(30_000);
    }
    expect(HEALTH_ALERT_AFTER_MS).toBe(5 * MINUTE);
    expect(alerts.map((a) => [a.subject, a.at])).toEqual([['Health check failing for 5 minutes', '2026-10-29T02:05:00.000Z']]);
    expect(alerts[0]!.details).toContain('HTTP 503');
    await watchdog.tick();
    expect(alerts.map((a) => a.subject)).toEqual(['Health check failing for 5 minutes', 'Health check recovered']);
  });

  it('does not alert for a failure shorter than 5 minutes', async () => {
    const { clock, alerts, watchdog } = setup([false, false, false, false, false, false, false, false, false, true]);
    for (let i = 0; i < 10; i++) {
      await watchdog.tick();
      clock.advance(30_000);
    }
    expect(alerts).toEqual([]);
  });

  it('failed Backup: alerts the same night, once per failed run', async () => {
    const failed = okBackup('2026-10-29T02:31:00Z', false);
    const { alerts, watchdog } = setup([true], [okBackup('2026-10-28T02:30:00Z'), failed, failed, failed]);
    await watchdog.tick();
    await watchdog.tick();
    await watchdog.tick();
    expect(alerts.map((a) => a.subject)).toEqual(['Nightly Backup failed']);
    expect(alerts[0]!.details).toContain('restic: wrong password');
  });

  it('alerts when no Backup has succeeded for 26 hours (the job did not run or hung)', async () => {
    const { clock, alerts, watchdog } = setup([true], [okBackup('2026-10-28T02:30:00Z')]);
    await watchdog.tick();
    expect(alerts).toEqual([]);
    clock.advance(BACKUP_MAX_AGE_MS);
    await watchdog.tick();
    await watchdog.tick();
    expect(alerts.map((a) => a.subject)).toEqual(['Nightly Backup missing']);
  });

  it('reads the status file written by the backup script', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rdk-status-'));
    const file = join(dir, 'backup.json');
    expect(await backupStatusReader(file)()).toBeNull();
    await writeFile(file, JSON.stringify(okBackup('2026-10-29T02:31:00Z', false)));
    expect(await backupStatusReader(file)()).toMatchObject({ ok: false, error: 'restic: wrong password' });
    await rm(dir, { recursive: true });
  });
});

describe('SMTP transport', () => {
  const received: Array<{ from: string; to: string[]; data: string; secure: boolean; user: string | undefined }> = [];
  let server: SMTPServer;
  let port: number;

  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: false,
      allowInsecureAuth: false,
      onAuth: (auth, _session, cb) => cb(null, { user: auth.username }),
      onData: (stream, session, cb) => {
        let data = '';
        stream.on('data', (chunk: Buffer) => (data += chunk.toString('utf8')));
        stream.on('end', () => {
          received.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '', to: session.envelope.rcptTo.map((r) => r.address), data, secure: session.secure, user: session.user as string | undefined });
          cb();
        });
      },
      logger: false,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    port = (server.server.address() as { port: number }).port;
  });
  afterAll(async () => new Promise<void>((resolve) => server.close(() => resolve())));

  it('sends over STARTTLS with authentication, from the configured address', async () => {
    const mailer = new SmtpMailer('Rodokmen <noreply@rodokmen.example>', { host: '127.0.0.1', port, secure: false, user: 'rodokmen', password: 'secret', insecureTls: true }, { rejectUnauthorized: false });
    await mailer.send(signInLinkEmail({ to: 'jana@example.test', language: 'cs', displayName: 'Jana', link: 'https://rodokmen.example/auth/link#token=abc', minutes: 15 }));
    expect(received).toHaveLength(1);
    const m = received[0]!;
    expect(m).toMatchObject({ from: 'noreply@rodokmen.example', to: ['jana@example.test'], secure: true, user: 'rodokmen' });
    // Decode the (folded) RFC 2047 subject.
    const raw = /^Subject: (.*(?:\r?\n[ \t].*)*)/m.exec(m.data)![1]!;
    const subject = [...raw.matchAll(/=\?UTF-8\?Q\?([^?]*)\?=/g)]
      .map((x) => Buffer.from(x[1]!.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/g, (_s, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8'))
      .join('');
    expect(subject).toBe('Přihlášení do Rodokmenu');
    expect(m.data).toContain('multipart/alternative');
  });
});
