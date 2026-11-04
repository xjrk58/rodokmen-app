import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CONNECTION_CLOSED, createDb, createPool, type IdleError } from '../src/db/db.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { freePort } from './helpers.js';

/**
 * PostgreSQL closes the pool's idle connections when it restarts (a deploy that changes the
 * settings of `db` recreates it), when it is stopped for memory, or when they are terminated by
 * hand. The pool reports it and opens new connections; the process carries on (#96).
 */

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
const TERMINATED = { code: '57P01', message: 'terminating connection due to administrator command' };

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

/** Terminates every client connection to the test database but its own; how many it ended. */
async function terminateConnections(url: string): Promise<number> {
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    const { rows } = await admin.query<{ ended: boolean }>(
      `select pg_terminate_backend(pid) as ended from pg_stat_activity
       where datname = current_database() and backend_type = 'client backend' and pid <> pg_backend_pid()`,
    );
    return rows.filter((r) => r.ended).length;
  } finally {
    await admin.end();
  }
}

const LogEntry = z.looseObject({ msg: z.string().optional(), error: z.unknown().optional() });
type LogEntry = z.infer<typeof LogEntry>;

function parseEntry(line: string): LogEntry | null {
  try {
    const parsed = LogEntry.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The API as a deploy starts it, `src/main.ts` in a process of its own, and what it logs. */
async function startApi(databaseUrl: string) {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', '--conditions=@rodokmen/source', 'src/main.ts'], {
    cwd: SERVER_DIR,
    env: { PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATABASE_URL: databaseUrl, RELEASE: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const entries: LogEntry[] = [];
  const logged = new EventEmitter();
  let output = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => (output += chunk));
  createInterface({ input: child.stdout }).on('line', (line) => {
    output += `${line}\n`;
    const entry = parseEntry(line);
    if (entry === null) return;
    entries.push(entry);
    logged.emit('entry');
  });
  const closed = new Promise<string>((resolve) => child.on('close', (code, signal) => resolve(String(code ?? signal))));
  const running = () => child.exitCode === null && child.signalCode === null;

  return {
    origin: `http://127.0.0.1:${port}`,
    output: () => output,
    running,
    /** The first `count` log entries with this message; fails if the process ends first. */
    async waitForLog(msg: string | RegExp, count = 1): Promise<LogEntry[]> {
      const matching = () => entries.filter((e) => e.msg !== undefined && (typeof msg === 'string' ? e.msg === msg : msg.test(e.msg)));
      const found = new Promise<LogEntry[]>((resolve) => {
        const check = () => {
          if (matching().length < count) return;
          logged.off('entry', check);
          resolve(matching().slice(0, count));
        };
        logged.on('entry', check);
        check();
      });
      const ended = closed.then((code) => {
        throw new Error(`the API exited (${code}) before logging "${String(msg)}":\n${output}`);
      });
      return Promise.race([found, ended]);
    },
    async stop() {
      if (!running()) return;
      child.kill('SIGTERM');
      await closed;
    },
  };
}

describe('the API when PostgreSQL closes its connections', () => {
  let api: Awaited<ReturnType<typeof startApi>>;
  beforeAll(async () => {
    api = await startApi(t.url);
    await api.waitForLog(/^Server listening/);
  });
  afterAll(async () => {
    await api.stop();
  });

  it('keeps running, logs each closed connection and answers the next request', async () => {
    expect((await fetch(`${api.origin}/api/health`)).status).toBe(200);

    const ended = await terminateConnections(t.url);
    expect(ended).toBeGreaterThan(0);
    const entries = await api.waitForLog(CONNECTION_CLOSED, ended);

    const res = await fetch(`${api.origin}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', database: 'ok' });
    expect(api.running()).toBe(true);
    // The error's code and message only: not the client pg-pool passes along, its connection
    // parameters or the stack.
    for (const entry of entries) expect(entry.error).toEqual(TERMINATED);
    expect(api.output()).not.toContain(t.url);
  });
});

describe('a pool outside the API (a CLI command, a test)', () => {
  it('reports a closed connection on stderr and opens a new one for the next query', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = createDb(t.url, { max: 2 });
    try {
      await sql`select 1`.execute(db);
      expect(await terminateConnections(t.url)).toBe(1);
      await vi.waitFor(() => expect(stderr).toHaveBeenCalledTimes(1));
      expect(stderr).toHaveBeenCalledWith(`${CONNECTION_CLOSED}: ${TERMINATED.message} (${TERMINATED.code})`);

      const { rows } = await sql<{ one: number }>`select 1 as one`.execute(db);
      expect(rows).toEqual([{ one: 1 }]);
    } finally {
      stderr.mockRestore();
      await db.destroy();
    }
  });

  it('never reports the connection string or the client', async () => {
    const url = 'postgres://invented:invented-password@db.invalid:5432/rodokmen';
    const reported: IdleError[] = [];
    const pool = createPool(url, { onIdleError: (error) => reported.push(error) });
    const client = new pg.Client({ connectionString: url });
    pool.emit('error', Object.assign(new Error(`lost the connection to ${url}`), { code: 'ECONNRESET', client }), client);

    expect(reported).toEqual([{ code: 'ECONNRESET', message: 'lost the connection to [URL]' }]);
    expect(JSON.stringify(reported)).not.toContain('invented-password');
    await pool.end();
  });
});
