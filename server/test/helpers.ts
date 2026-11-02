import { ApiError, type MemberRole, type UiLanguage } from '@rodokmen/shared';
import { createServer, type AddressInfo } from 'node:net';
import { z } from 'zod';
import { buildApp, type RodokmenApp } from '../src/app.js';
import { createAgent } from '../src/auth/agents.js';
import { createSession, SESSION_COOKIE } from '../src/auth/sessions.js';
import { loadConfig, type Config } from '../src/config.js';
import type { Db } from '../src/db/db.js';
import type { Account } from '../src/db/types.js';
import { OutboxMailer } from '../src/mail/mailer.js';
import type { Reader } from '../src/readings/reader.js';
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
    // As in deploy/docker-compose.yml: Garage inside, links signed for the files host.
    S3_ENDPOINT: 'http://garage:3900',
    S3_PUBLIC_ENDPOINT: 'https://files.rodokmen.dev',
    S3_REGION: 'garage',
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
  options: {
    config?: Record<string, string>;
    extraRoutes?: Parameters<typeof buildApp>[0]['extraRoutes'];
    clock?: TestClock;
    images?: (clock: TestClock) => ImageStorage;
    reader?: Reader | null;
  } = {},
): Promise<TestApp> {
  const config = testConfig(t.url, options.config);
  const mailer = new OutboxMailer();
  const clock = options.clock ?? new TestClock();
  const app = await buildApp({
    config,
    db: t.db,
    mailer,
    clock,
    images: options.images?.(clock),
    extraRoutes: options.extraRoutes,
    reader: options.reader === undefined ? null : options.reader,
  });
  return { app, mailer, clock, config };
}

let counter = 0;

/** A Member's account: unlike an Agent's, it always has an email. */
export type MemberAccount = Account & { email: string };

export function asMember(a: Account): MemberAccount {
  if (a.email === null) throw new Error(`account ${a.id} is an Agent`);
  return { ...a, email: a.email };
}

/** Creates a Member directly in the database (the Owner first, if none exists). */
export async function createMember(
  db: Db,
  role: MemberRole = 'contributor',
  fields: { email?: string; displayName?: string; language?: UiLanguage } = {},
): Promise<MemberAccount> {
  counter += 1;
  const email = fields.email ?? `member${counter}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  return asMember(
    await db
      .insertInto('account')
      .values({ email, display_name: fields.displayName ?? `Member ${counter}`, language: fields.language ?? 'en', role })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
}

export async function ensureOwner(db: Db): Promise<MemberAccount> {
  const existing = await db.selectFrom('account').selectAll().where('role', '=', 'owner').executeTakeFirst();
  return existing ? asMember(existing) : createMember(db, 'owner', { displayName: 'Owner Example', language: 'cs' });
}

/** An Agent the Owner created, with its first token (as POST /api/agents does). */
export async function createAgentWithToken(db: Db, clock: Clock, name = 'Invented Agent'): Promise<{ agent: Account; token: string; tokenId: string }> {
  const owner = await ensureOwner(db);
  const { agent, token } = await createAgent({ db, clock }, owner, name, null);
  const account = await db.selectFrom('account').selectAll().where('id', '=', agent.id).executeTakeFirstOrThrow();
  return { agent: account, token: token.token, tokenId: token.id };
}

/** The Authorization header of an Agent token. */
export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

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

/** The token in a link of an email body (…/#invite/XYZ or …/#link/XYZ). */
export function tokenFromEmail(text: string): string {
  const m = /#(?:invite|link)\/([A-Za-z0-9_-]+)/.exec(text);
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

/** The port of a server listening on TCP. */
export function portOf(address: AddressInfo | string | null): number {
  if (address === null || typeof address === 'string') throw new Error('the server is not listening on a TCP port');
  return address.port;
}

/** A TCP port nothing listens on right now. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (address === null || typeof address === 'string') return reject(new Error('no TCP port'));
      srv.close(() => resolve(address.port));
    });
  });
}
