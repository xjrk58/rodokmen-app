import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/**
 * Configuration from environment variables. Every variable is listed, with its meaning,
 * in deploy/README.md and deploy/.env.example.
 */
const Env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    /** The one origin app and API are served from, e.g. https://rodokmen.example (ADR 0007). */
    PUBLIC_ORIGIN: z.url().default('http://localhost:3000'),
    DATABASE_URL: z.string().min(1).default('postgres://rodokmen:rodokmen@localhost:5432/rodokmen_dev'),
    /** Static files of the map app; served at / when the directory exists. */
    APP_DIR: z.string().optional(),
    RELEASE: z.string().default('dev'),
    TRUST_PROXY: bool.default(false),
    SESSION_IDLE_DAYS: z.coerce.number().int().min(1).max(400).default(90),

    MAIL_TRANSPORT: z.enum(['outbox', 'smtp']).optional(),
    MAIL_FROM: z.string().default('Rodokmen <noreply@localhost>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().optional(),
    /** true for implicit TLS (port 465); otherwise STARTTLS is required. */
    SMTP_SECURE: bool.optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    /** Development only: accept a self-signed certificate from a local SMTP server. Ignored in production. */
    SMTP_INSECURE_TLS: bool.optional(),
    /** Where alerts go: the Owner's address. */
    ALERT_EMAIL: z.string().optional(),

    /** Where the server reaches the image store, e.g. http://garage:3900 on the Docker network. */
    S3_ENDPOINT: z.url().optional(),
    /** Where browsers reach it, if not at S3_ENDPOINT: the host image links are signed for (deploy/README.md, "Image links"). */
    S3_PUBLIC_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().default('garage'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool.default(true),

    /** Watchdog: URL to poll, and the backup status file written by deploy/backup/backup.sh. */
    WATCHDOG_URL: z.string().optional(),
    BACKUP_STATUS_FILE: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    const need = (key: keyof typeof env, why: string) => {
      if (env[key] === undefined || env[key] === '') ctx.addIssue({ code: 'custom', path: [key], message: `required in production: ${why}` });
    };
    if (!env.PUBLIC_ORIGIN.startsWith('https://')) ctx.addIssue({ code: 'custom', path: ['PUBLIC_ORIGIN'], message: 'must be https:// in production' });
    if (env.MAIL_TRANSPORT !== 'smtp') ctx.addIssue({ code: 'custom', path: ['MAIL_TRANSPORT'], message: 'must be smtp in production' });
    need('SMTP_HOST', 'email service host');
    need('ALERT_EMAIL', "the Owner's alert address");
    need('S3_ENDPOINT', 'object storage endpoint');
    need('S3_BUCKET', 'image bucket');
    need('S3_ACCESS_KEY_ID', 'object storage key');
    need('S3_SECRET_ACCESS_KEY', 'object storage secret');
    const linkEndpoint = env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT;
    if (linkEndpoint && !linkEndpoint.startsWith('https://'))
      ctx.addIssue({
        code: 'custom',
        path: ['S3_PUBLIC_ENDPOINT'],
        message: 'image links must be https:// in production; set S3_PUBLIC_ENDPOINT when S3_ENDPOINT is internal',
      });
  });

export interface Config {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  publicOrigin: string;
  /** WebAuthn relying party id: the host of the public origin. */
  rpId: string;
  databaseUrl: string;
  appDir: string | undefined;
  release: string;
  trustProxy: boolean;
  sessionIdleDays: number;
  mail: {
    transport: 'outbox' | 'smtp';
    from: string;
    smtp: { host: string; port: number; secure: boolean; user: string | undefined; password: string | undefined; insecureTls: boolean } | undefined;
    alertEmail: string | undefined;
  };
  s3: {
    endpoint: string;
    /** The endpoint presigned links point at; S3_PUBLIC_ENDPOINT, or else `endpoint`. */
    publicEndpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    configured: boolean;
  };
  watchdog: { url: string; backupStatusFile: string | undefined };
}

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const origin = new URL(e.PUBLIC_ORIGIN);
  const publicOrigin = origin.origin;
  const s3Configured = Boolean(e.S3_ENDPOINT && e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY);
  // Development and test fall back to placeholders: links have the right shape but lead nowhere.
  const s3Endpoint = e.S3_ENDPOINT ?? 'https://objectstorage.invalid';
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    publicOrigin,
    rpId: origin.hostname,
    databaseUrl: e.DATABASE_URL,
    appDir: e.APP_DIR,
    release: e.RELEASE,
    trustProxy: e.TRUST_PROXY,
    sessionIdleDays: e.SESSION_IDLE_DAYS,
    mail: {
      transport: e.MAIL_TRANSPORT ?? 'outbox',
      from: e.MAIL_FROM,
      smtp: e.SMTP_HOST
        ? {
            host: e.SMTP_HOST,
            port: e.SMTP_PORT ?? (e.SMTP_SECURE ? 465 : 587),
            secure: e.SMTP_SECURE ?? false,
            user: e.SMTP_USER,
            password: e.SMTP_PASSWORD,
            insecureTls: e.NODE_ENV !== 'production' && e.SMTP_INSECURE_TLS === true,
          }
        : undefined,
      alertEmail: e.ALERT_EMAIL,
    },
    s3: {
      endpoint: s3Endpoint,
      publicEndpoint: e.S3_PUBLIC_ENDPOINT ?? s3Endpoint,
      region: e.S3_REGION,
      bucket: e.S3_BUCKET ?? 'rodokmen-images-dev',
      accessKeyId: e.S3_ACCESS_KEY_ID ?? 'dev-access-key',
      secretAccessKey: e.S3_SECRET_ACCESS_KEY ?? 'dev-secret-key',
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      configured: s3Configured,
    },
    watchdog: { url: e.WATCHDOG_URL ?? `${publicOrigin}/api/health`, backupStatusFile: e.BACKUP_STATUS_FILE },
  };
}
