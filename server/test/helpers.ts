import { ApiError, type MemberRole, type UiLanguage } from '@rodokmen/shared';
import { z } from 'zod';
import { buildApp, type RodokmenApp } from '../src/app.js';
import { createSession, SESSION_COOKIE } from '../src/auth/sessions.js';
import { loadConfig, type Config } from '../src/config.js';
import type { Db } from '../src/db/db.js';
import type { Account } from '../src/db/types.js';
import { OutboxMailer } from '../src/mail/mailer.js';
import type { ImageStorage } from '../src/storage/images.js';
import type { Clock } from '../src/clock.js';
import type { TestDatabase } from './db.js';

/** A clock tests can move. */
export class TestClock implements Clock {
  constructor(public current: Date = new Date('2026-10-29T10:00:00Z')) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export const MINUTE = 60_000;
export const DAY = 86_400_000;

export function testConfig(databaseUrl: string, overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    PUBLIC_ORIGIN: 'http://localhost:3000',
    DATABASE_URL: databaseUrl,
    RELEASE: 'test',
    APP_DIR: '/nonexistent-app-dir',
    S3_ENDPOINT: 'https://fsn1.your-objectstorage.com',
    S3_REGION: 'fsn1',
    S3_BUCKET: 'rodokmen-images-test',
    S3_ACCESS_KEY_ID: 'TESTKEY',
    S3_SECRET_ACCESS_KEY: 'test-secret',
    ...overrides,
  });
}

export interface TestApp {
  app: RodokmenApp;
  mailer: OutboxMailer;
  clock: TestClock;
  config: Config;
}

export async function makeApp(
  t: TestDatabase,
  options: { config?: Record<string, string>; extraRoutes?: Parameters<typeof buildApp>[0]['extraRoutes']; clock?: TestClock; images?: (clock: TestClock) => ImageStorage } = {},
): Promise<TestApp> {
  const config = testConfig(t.url, options.config);
  const mailer = new OutboxMailer();
  const clock = options.clock ?? new TestClock();
  const app = await buildApp({ config, db: t.db, mailer, clock, images: options.images?.(clock), extraRoutes: options.extraRoutes });
  return { app, mailer, clock, config };
}

let counter = 0;

/** Creates a Member directly in the database (the Owner first, if none exists). */
export async function createMember(db: Db, role: MemberRole = 'contributor', fields: { email?: string; displayName?: string; language?: UiLanguage } = {}): Promise<Account> {
  counter += 1;
  const email = fields.email ?? `member${counter}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  return db
    .insertInto('account')
    .values({ email, display_name: fields.displayName ?? `Member ${counter}`, language: fields.language ?? 'en', role })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function ensureOwner(db: Db): Promise<Account> {
  const existing = await db.selectFrom('account').selectAll().where('role', '=', 'owner').executeTakeFirst();
  return existing ?? createMember(db, 'owner', { displayName: 'Owner Example', language: 'cs' });
}

/** A session cookie header for a Member, as if they had signed in. */
export async function signIn(db: Db, clock: Clock, account: Account): Promise<string> {
  const { token } = await createSession(db, clock, { idleDays: 90 }, account.id, 'passkey', 'vitest');
  return `${SESSION_COOKIE}=${token}`;
}

/** The session cookie a response set, as a request Cookie header. */
export function cookieFrom(response: { cookies: Array<{ name: string; value: string }> }): string {
  const c = response.cookies.find((x) => x.name === SESSION_COOKIE);
  if (!c) throw new Error('no session cookie in response');
  return `${SESSION_COOKIE}=${c.value}`;
}

/** The token in a link of an email body (…#token=XYZ). */
export function tokenFromEmail(text: string): string {
  const m = /#token=([A-Za-z0-9_-]+)/.exec(text);
  if (!m) throw new Error(`no token link in email:\n${text}`);
  return m[1]!;
}

/** The error an API answer carries, parsed. */
export function errorOf(res: { json(): unknown }): ApiError {
  return ApiError.parse(res.json());
}

/** The id of the record an API answer describes. */
export function idOf(res: { json(): unknown }): string {
  return z.object({ id: z.string() }).parse(res.json()).id;
}
