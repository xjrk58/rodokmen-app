import { spawn } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { messageOf } from '../src/errors.js';
import { startWatchdog, STOP_TIMEOUT_MS } from '../src/ops/watchdog.js';
import { composeSetting, durationMs } from './deploy-files.js';
import { portOf } from './helpers.js';
import { deferred, pause } from './raw-http.js';

/**
 * The watchdog stops on SIGTERM (#122). It runs as PID 1 in its container, where a signal without
 * a handler is ignored, so every deploy (which replaces the container) waited 10 s for Docker's
 * SIGKILL.
 */

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));

/** Rounds of checks that count themselves; each waits for `gate` when one is set. */
function rounds() {
  const state: { started: number; finished: number; gate?: Promise<void> } = { started: 0, finished: 0 };
  const errors: unknown[] = [];
  const watchdog = {
    async tick() {
      state.started++;
      if (state.gate) await state.gate;
      state.finished++;
    },
  };
  return { state, errors, watchdog, onError: (error: unknown) => void errors.push(error) };
}

describe('stopping the watchdog', () => {
  it('runs a round at once and the next one an interval after it ends; stopped between rounds, it starts no other', async () => {
    const { state, errors, watchdog, onError } = rounds();
    const running = startWatchdog(watchdog, { intervalMs: 40, onError });
    expect(state.started).toBe(1);
    await pause(100);
    expect(state.started).toBeGreaterThanOrEqual(2);

    const t0 = Date.now();
    expect(await running.stop(10_000)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(50);
    const started = state.started;
    await pause(150);
    expect(state.started).toBe(started);
    expect(errors).toEqual([]);
  });

  it('waits for the round in flight, which may be sending an alert, and starts no other after it', async () => {
    const { state, watchdog, onError } = rounds();
    const release = deferred();
    state.gate = release.promise;
    const running = startWatchdog(watchdog, { intervalMs: 10, onError });

    let result: boolean | undefined;
    const stopped = running.stop(10_000).then((r) => (result = r));
    await pause(50);
    expect(result).toBeUndefined();
    release.resolve();
    await stopped;
    expect(result).toBe(true);
    expect(state.finished).toBe(1);
    await pause(50);
    expect(state.started).toBe(1);
  });

  it('gives up a round that is still running after the timeout', async () => {
    const { state, watchdog, onError } = rounds();
    state.gate = new Promise(() => undefined);
    const running = startWatchdog(watchdog, { intervalMs: 10, onError });
    const t0 = Date.now();
    expect(await running.stop(100)).toBe(false);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(95);
    expect(state.finished).toBe(0);
  });

  it('reports a round that throws and runs the next one', async () => {
    const errors: unknown[] = [];
    let ticks = 0;
    const running = startWatchdog(
      {
        async tick() {
          if (++ticks === 1) throw new Error('421 try again later');
        },
      },
      { intervalMs: 10, onError: (e) => errors.push(e) },
    );
    await pause(60);
    expect(await running.stop()).toBe(true);
    expect(errors.map(messageOf)).toEqual(['421 try again later']);
    expect(ticks).toBeGreaterThanOrEqual(2);
  });

  it('Docker sends the signal to the watchdog command itself, and waits for the stop longer than it can take', () => {
    // The command as an array: node is PID 1 and gets SIGTERM, not a shell in front of it.
    expect(composeSetting('watchdog', 'command')).toEqual(['node', 'dist/cli.js', 'watchdog']);
    expect(durationMs(String(composeSetting('watchdog', 'stop_grace_period')))).toBeGreaterThan(STOP_TIMEOUT_MS);
  });
});

describe('the watchdog command on a signal', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanup.splice(0)) fn();
  });

  /**
   * `src/cli.ts watchdog` in a process of its own, checking a local health URL that answers each
   * request with `answer` (which may hold it); resolves once the first health check arrives.
   */
  async function startCommand(answer: (res: ServerResponse) => void) {
    const health = createServer((_req, res) => answer(res));
    await new Promise<void>((resolve) => health.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => health.close());
    const firstCheck = new Promise<void>((resolve) => health.once('request', () => resolve()));
    const child = spawn(process.execPath, ['--import', 'tsx', '--conditions=@rodokmen/source', 'src/cli.ts', 'watchdog'], {
      cwd: SERVER_DIR,
      env: { PATH: process.env.PATH, NODE_ENV: 'test', WATCHDOG_URL: `http://127.0.0.1:${portOf(health.address())}/api/health` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    cleanup.push(() => child.kill('SIGKILL'));
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.on('close', (code, signal) => resolve({ code, signal })),
    );
    await Promise.race([
      firstCheck,
      closed.then((end) => {
        throw new Error(`the watchdog ended (${end.code ?? end.signal}) before its first check:\n${output}`);
      }),
    ]);
    return { child, closed, output: () => output };
  }

  it.each(['SIGTERM', 'SIGINT'] as const)('exits 0 at once on %s', async (signal) => {
    const { child, closed, output } = await startCommand((res) => res.end('{"status":"ok"}'));
    await pause(100);
    const t0 = Date.now();
    child.kill(signal);
    const end = await closed;
    expect(end, output()).toEqual({ code: 0, signal: null });
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(output()).toContain(`watchdog: ${signal}, stopping`);
  });

  it('on SIGTERM during a check, exits 0 once that check has its answer', async () => {
    const held: ServerResponse[] = [];
    const { child, closed, output } = await startCommand((res) => held.push(res));
    child.kill('SIGTERM');
    await pause(300);
    expect(child.exitCode, output()).toBeNull();
    for (const res of held) res.end('{"status":"ok"}');
    expect(await closed, output()).toEqual({ code: 0, signal: null });
  });
});
