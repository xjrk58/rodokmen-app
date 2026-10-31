import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { SmtpMailer } from '../src/mail/mailer.js';
import { sendAlert } from '../src/ops/alerts.js';
import { signInLinkEmail } from '../src/mail/templates.js';
import { backupStatusReader, BACKUP_MAX_AGE_MS, HEALTH_ALERT_AFTER_MS, Watchdog } from '../src/ops/watchdog.js';
import { createImageStorage, createS3Client, IMAGE_LINK_SECONDS } from '../src/storage/images.js';
import { MINUTE, portOf, TestClock } from './helpers.js';

describe('presigned image links (no network)', () => {
  const clock = new TestClock(new Date('2026-10-29T10:00:00Z'));
  // As in deploy/docker-compose.yml: the server reaches Garage on the Docker network, browsers
  // reach it at the files host through Caddy.
  const s3 = loadConfig({
    NODE_ENV: 'test',
    S3_ENDPOINT: 'http://garage:3900',
    S3_PUBLIC_ENDPOINT: 'https://files.rodokmen.dev',
    S3_REGION: 'garage',
    S3_BUCKET: 'rodokmen-images',
    S3_ACCESS_KEY_ID: 'AKEXAMPLE',
    S3_SECRET_ACCESS_KEY: 'secret',
  }).s3;
  // The server's own requests are recorded where they would be sent, and never sent.
  const client = createS3Client(s3);
  const sent: unknown[] = [];
  client.middlewareStack.add(
    () => async (args) => {
      const r = args.request;
      if (typeof r !== 'object' || r === null || !('protocol' in r && 'hostname' in r && 'port' in r && 'method' in r && 'path' in r))
        throw new Error('not an HTTP request');
      sent.push({ protocol: r.protocol, hostname: r.hostname, port: r.port, method: r.method, path: r.path });
      return { response: {}, output: { $metadata: {} } };
    },
    { step: 'finalizeRequest', name: 'captureInsteadOfSending' },
  );
  const storage = createImageStorage(s3, clock, client);

  it('signs a GET for the private bucket on the files host, valid for 5 minutes', async () => {
    const { url, expiresAt } = await storage.link('citations/abc/page-1.jpg', 'image/jpeg');
    const u = new URL(url);
    expect(u.origin).toBe('https://files.rodokmen.dev');
    expect(u.pathname).toBe('/rodokmen-images/citations/abc/page-1.jpg');
    expect(u.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(u.searchParams.get('X-Amz-Credential')).toBe('AKEXAMPLE/20261029/garage/s3/aws4_request');
    expect(u.searchParams.get('X-Amz-Date')).toBe('20261029T100000Z');
    expect(u.searchParams.get('X-Amz-Expires')).toBe(String(IMAGE_LINK_SECONDS));
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(u.searchParams.get('response-content-type')).toBe('image/jpeg');
    expect(expiresAt.toISOString()).toBe('2026-10-29T10:05:00.000Z');
  });

  it('signs uploads for the files host too, and talks to the store itself on the internal endpoint', async () => {
    const upload = new URL((await storage.uploadLink('pending/x/original', 'image/jpeg', 1234)).url);
    expect(upload.origin).toBe('https://files.rodokmen.dev');
    expect(upload.pathname).toBe('/rodokmen-images/pending/x/original');
    // No checksum of a body the signer never saw (Garage refuses such an upload).
    expect([...upload.searchParams.keys()].filter((k) => /checksum/i.test(k))).toEqual([]);
    sent.length = 0;
    await storage.put('pending/x/display.webp', Buffer.from('webp'), 'image/webp');
    await storage.delete('pending/x/original');
    expect(sent).toEqual([
      { protocol: 'http:', hostname: 'garage', port: 3900, method: 'PUT', path: '/rodokmen-images/pending/x/display.webp' },
      { protocol: 'http:', hostname: 'garage', port: 3900, method: 'DELETE', path: '/rodokmen-images/pending/x/original' },
    ]);
  });

  it('a shared image link is signed to expire within 10 minutes, long before 30 minutes have passed', async () => {
    const { url } = await storage.link('portraits/x.webp', 'image/webp');
    const u = new URL(url);
    const signed = u.searchParams.get('X-Amz-Date')!.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
    const validUntil = new Date(signed).getTime() + Number(u.searchParams.get('X-Amz-Expires')) * 1000;
    expect(validUntil - clock.now().getTime()).toBeLessThanOrEqual(10 * MINUTE);
    expect(clock.now().getTime() + 30 * MINUTE).toBeGreaterThan(validUntil);
  });

  it("names the origin of its links for the app's policy: the files host, with the bucket in it unless path-style", async () => {
    expect(await storage.linkOrigin()).toBe('https://files.rodokmen.dev');
    const virtualHosted = createImageStorage({ ...s3, forcePathStyle: false }, clock);
    expect(await virtualHosted.linkOrigin()).toBe('https://rodokmen-images.files.rodokmen.dev');
    expect(new URL((await virtualHosted.link('a.jpg', 'image/jpeg')).url).origin).toBe(await virtualHosted.linkOrigin());
  });

  it('signs differently for each key and each moment', async () => {
    const a = (await storage.link('a.jpg', 'image/jpeg')).url;
    const b = (await storage.link('b.jpg', 'image/jpeg')).url;
    clock.advance(1000);
    const a2 = (await storage.link('a.jpg', 'image/jpeg')).url;
    expect(new Set([a, b, a2]).size).toBe(3);
  });
});

describe('image storage in production', () => {
  const production = {
    NODE_ENV: 'production',
    PUBLIC_ORIGIN: 'https://rodokmen.dev',
    MAIL_TRANSPORT: 'smtp',
    SMTP_HOST: 'smtp.example.eu',
    ALERT_EMAIL: 'owner@example.eu',
    S3_ENDPOINT: 'http://garage:3900',
    S3_BUCKET: 'rodokmen-images',
    S3_ACCESS_KEY_ID: 'GK0123456789abcdef01234567',
    S3_SECRET_ACCESS_KEY: 'secret',
  };

  it('refuses to start when image links would not be https', () => {
    expect(() => loadConfig(production)).toThrow(/S3_PUBLIC_ENDPOINT: image links must be https:\/\//);
    expect(() => loadConfig({ ...production, S3_PUBLIC_ENDPOINT: 'http://files.rodokmen.dev' })).toThrow(/S3_PUBLIC_ENDPOINT/);
  });

  it('signs links for S3_PUBLIC_ENDPOINT and keeps S3_ENDPOINT for the server', () => {
    expect(loadConfig({ ...production, S3_PUBLIC_ENDPOINT: 'https://files.rodokmen.dev' }).s3).toMatchObject({
      endpoint: 'http://garage:3900',
      publicEndpoint: 'https://files.rodokmen.dev',
      configured: true,
    });
    // A store reached at a public https endpoint (as with a hosted bucket) needs no second one.
    expect(loadConfig({ ...production, S3_ENDPOINT: 'https://s3.example.eu' }).s3.publicEndpoint).toBe('https://s3.example.eu');
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
  const okBackup = (finishedAt: string, ok = true) => ({
    ok,
    startedAt: finishedAt,
    finishedAt,
    snapshot: ok ? 'abc123' : null,
    error: ok ? null : 'restic: wrong password',
  });

  it('alerts once when the health check fails for more than 5 minutes, and once on recovery', async () => {
    const { clock, alerts, watchdog } = setup([...Array<boolean>(13).fill(false), true]);
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

  it('an alert that could not be sent is sent on a later tick, once', async () => {
    const clock = new TestClock(new Date('2026-10-29T02:00:00Z'));
    const sent: string[] = [];
    const refused = new Set<string>();
    const watchdog = new Watchdog({
      clock,
      checkHealth: async () => ({ ok: false, detail: 'HTTP 502' }),
      readBackupStatus: async () => okBackup('2026-10-29T02:31:00Z', false),
      // The mail service refuses the first attempt of each alert.
      alert: async (subject) => {
        const kind = subject.split(' ')[0]!;
        if (!refused.has(kind)) {
          refused.add(kind);
          throw new Error('421 try again later');
        }
        sent.push(subject);
      },
    });
    // The Backup alert is due at once, the health alert after 5 minutes.
    await expect(watchdog.tick()).rejects.toThrow(AggregateError);
    expect(sent).toEqual([]);
    for (let i = 0; i < 12; i++) {
      clock.advance(30_000);
      await watchdog.tick().catch(() => undefined);
    }
    expect(sent).toEqual(['Nightly Backup failed', 'Health check failing for 6 minutes']);
  });

  it('a failing alert does not keep the other check from running', async () => {
    const { alerts, watchdog } = setup([true], [okBackup('2026-10-29T02:31:00Z', false)]);
    const failing = new Watchdog({
      clock: new TestClock(new Date('2026-10-29T02:00:00Z')),
      checkHealth: async () => {
        throw new Error('no answer');
      },
      readBackupStatus: async () => okBackup('2026-10-29T02:31:00Z', false),
      healthAlertAfterMs: 0,
      alert: async (subject) => {
        if (subject.startsWith('Health')) throw new Error('421');
        alerts.push({ subject, details: '', at: '' });
      },
    });
    await expect(failing.tick()).rejects.toThrow(AggregateError);
    expect(alerts.map((a) => a.subject)).toEqual(['Nightly Backup failed']);
    await watchdog.tick();
    expect(alerts.map((a) => a.subject)).toEqual(['Nightly Backup failed', 'Nightly Backup failed']);
  });

  it('a recovery alert that could not be sent is sent on a later tick', async () => {
    const clock = new TestClock(new Date('2026-10-29T02:00:00Z'));
    const sent: string[] = [];
    let healthy = false;
    let failNext = false;
    const watchdog = new Watchdog({
      clock,
      checkHealth: async () => ({ ok: healthy, detail: 'HTTP 502' }),
      healthAlertAfterMs: 0,
      alert: async (subject) => {
        if (failNext) {
          failNext = false;
          throw new Error('421');
        }
        sent.push(subject);
      },
    });
    await watchdog.tick();
    healthy = true;
    failNext = true;
    await expect(watchdog.tick()).rejects.toThrow(AggregateError);
    await watchdog.tick();
    await watchdog.tick();
    expect(sent).toEqual(['Health check failing for 0 minutes', 'Health check recovered']);
  });

  it('an unreadable or malformed status file alerts, and alerts again after a good read in between', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rdk-status-'));
    const file = join(dir, 'backup.json');
    const alerts: string[] = [];
    const clock = new TestClock(new Date('2026-10-29T08:00:00Z'));
    const watchdog = new Watchdog({
      clock,
      checkHealth: async () => ({ ok: true, detail: '' }),
      readBackupStatus: backupStatusReader(file),
      alert: async (subject) => void alerts.push(subject),
    });
    await writeFile(file, '{"ok": tru');
    await watchdog.tick();
    await watchdog.tick();
    await writeFile(file, JSON.stringify(okBackup('2026-10-29T02:31:00Z')));
    await watchdog.tick();
    // A status whose times are not times would otherwise never look stale.
    await writeFile(file, JSON.stringify({ ok: true, startedAt: 'yesterday', finishedAt: 'yesterday' }));
    await watchdog.tick();
    expect(alerts).toEqual(['Backup status unreadable', 'Backup status unreadable']);
    await rm(dir, { recursive: true });
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
          received.push({
            from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
            to: session.envelope.rcptTo.map((r) => r.address),
            data,
            secure: session.secure,
            user: typeof session.user === 'string' ? session.user : undefined,
          });
          cb();
        });
      },
      logger: false,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    port = portOf(server.server.address());
  });
  afterAll(async () => new Promise<void>((resolve) => server.close(() => resolve())));

  it('sends over STARTTLS with authentication, from the configured address', async () => {
    const mailer = new SmtpMailer(
      'Rodokmen <noreply@rodokmen.example>',
      { host: '127.0.0.1', port, secure: false, user: 'rodokmen', password: 'secret', insecureTls: true },
      { rejectUnauthorized: false },
    );
    await mailer.send(
      signInLinkEmail({ to: 'jana@example.test', language: 'cs', displayName: 'Jana', link: 'https://rodokmen.example/#link/abc', minutes: 15 }),
    );
    expect(received).toHaveLength(1);
    const m = received[0]!;
    expect(m).toMatchObject({ from: 'noreply@rodokmen.example', to: ['jana@example.test'], secure: true, user: 'rodokmen' });
    // Decode the (folded) RFC 2047 subject.
    const raw = /^Subject: (.*(?:\r?\n[ \t].*)*)/m.exec(m.data)![1]!;
    const subject = [...raw.matchAll(/=\?UTF-8\?Q\?([^?]*)\?=/g)]
      .map((x) =>
        Buffer.from(
          x[1]!.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/g, (_s, h: string) => String.fromCharCode(parseInt(h, 16))),
          'latin1',
        ).toString('utf8'),
      )
      .join('');
    expect(subject).toBe('Přihlášení do Rodokmenu');
    expect(m.data).toContain('multipart/alternative');
  });
});

describe('watchdog alerts over SMTP when the mail service refuses at first', () => {
  const accepted: string[] = [];
  let refusals = 1;
  let server: SMTPServer;
  let port: number;

  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: true,
      logger: false,
      onData: (stream, _session, cb) => {
        let data = '';
        stream.on('data', (chunk: Buffer) => (data += chunk.toString('utf8')));
        stream.on('end', () => {
          if (refusals > 0) {
            refusals--;
            cb(Object.assign(new Error('Service busy, try again later'), { responseCode: 421 }));
            return;
          }
          accepted.push(data);
          cb();
        });
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    port = portOf(server.server.address());
  });
  afterAll(async () => new Promise<void>((resolve) => server.close(() => resolve())));

  it('a failed Backup: the first send is refused with 421, the next tick delivers the alert, and only once', async () => {
    const config = loadConfig({ NODE_ENV: 'test', ALERT_EMAIL: 'owner@example.test', PUBLIC_ORIGIN: 'https://rodokmen.example' });
    const mailer = new SmtpMailer(
      'Rodokmen <noreply@rodokmen.example>',
      { host: '127.0.0.1', port, secure: false, user: undefined, password: undefined, insecureTls: true },
      { rejectUnauthorized: false },
    );
    const watchdog = new Watchdog({
      clock: new TestClock(new Date('2026-10-29T02:40:00Z')),
      checkHealth: async () => ({ ok: true, detail: 'HTTP 200' }),
      readBackupStatus: async () => ({ ok: false, startedAt: '2026-10-29T02:30:00Z', finishedAt: '2026-10-29T02:31:00Z', error: 'restic: wrong password' }),
      alert: (subject, details) => sendAlert(config, mailer, subject, details),
    });
    await expect(watchdog.tick()).rejects.toThrow(/could not be sent/);
    expect(accepted).toHaveLength(0);
    await watchdog.tick();
    await watchdog.tick();
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toContain('Nightly Backup failed');
    expect(accepted[0]).toContain('restic: wrong password');
  });
});
