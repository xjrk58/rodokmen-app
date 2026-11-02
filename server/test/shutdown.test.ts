import { connect, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shutDown } from '../src/shutdown.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { makeApp, portOf } from './helpers.js';

/**
 * Stopping a slot fails no request (#71): what a deploy relies on once Caddy has switched to the
 * new slot (deploy/scripts/deploy.sh). The tests speak HTTP/1.1 over plain sockets, so they decide
 * exactly what reaches the server and when.
 */

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** An app with a request that runs until `release` and one that echoes its body, listening on a free port. */
async function slowApp() {
  const started = deferred();
  const release = deferred();
  const events: string[] = [];
  const { app } = await makeApp(t, {
    extraRoutes: (scope) => {
      scope.get('/test/slow', { config: { public: true }, schema: { hide: true } }, async () => {
        started.resolve();
        await release.promise;
        events.push('request finished');
        return { slow: 'done' };
      });
      scope.post('/test/echo', { config: { public: true }, schema: { hide: true } }, async (request) => ({ echo: request.body }));
    },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const parts = {
    app,
    stopJobs: async () => {
      events.push('jobs stopped');
    },
    db: {
      destroy: async () => {
        events.push('pool closed');
      },
    },
  };
  return { app, port: portOf(app.server.address()), started, release, events, parts };
}

/** A connection to the server, and everything the server sends on it until it closes it. */
async function open(port: number): Promise<{ socket: Socket; received: Promise<string> }> {
  const socket = connect(port, '127.0.0.1');
  socket.setEncoding('utf8');
  let data = '';
  socket.on('data', (chunk: string) => (data += chunk));
  socket.on('error', () => undefined);
  const received = new Promise<string>((resolve) => socket.on('close', () => resolve(data)));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return { socket, received };
}

/** Whether a new connection is accepted: 'connected', or the error code. */
const tryConnect = (port: number) =>
  new Promise<string>((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve('connected');
    });
    socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'error'));
  });

function parse(raw: string) {
  const [head = '', ...rest] = raw.split('\r\n\r\n');
  const [statusLine = '', ...lines] = head.split('\r\n');
  const headers = Object.fromEntries(lines.map((line) => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]));
  return { status: Number(statusLine.split(' ')[1]), headers, body: rest.join('\r\n\r\n') };
}

describe('stopping the server', () => {
  it('answers the requests in flight, closes their connections, then stops the jobs and the pool', async () => {
    const { port, started, release, events, parts } = await slowApp();
    const { socket, received } = await open(port);
    socket.write('GET /test/slow HTTP/1.1\r\nHost: api\r\n\r\n');
    await started.promise;

    const t0 = Date.now();
    const stopped = shutDown({ ...parts, timeoutMs: 10_000 });
    await pause(50);
    expect(await tryConnect(port)).toBe('ECONNREFUSED');
    expect(events).toEqual(['jobs stopped']);

    release.resolve();
    const answer = parse(await received);
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({ slow: 'done' });
    // A keep-alive client would otherwise send its next request on this connection, and close()
    // would wait for the idle connection to time out (72 s, beyond Docker's 20 s).
    expect(answer.headers.connection).toBe('close');

    expect(await stopped).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(events).toEqual(['jobs stopped', 'request finished', 'pool closed']);
  });

  it('answers a request that was still arriving when it began to stop, instead of refusing it with 503', async () => {
    const { port, parts } = await slowApp();
    const { socket, received } = await open(port);
    const body = JSON.stringify({ name: 'Invented Person' });
    socket.write('POST /test/echo HTTP/1.1\r\nHost: api\r\ncontent-type: application/json\r\n');
    await pause(50);

    const stopped = shutDown({ ...parts, timeoutMs: 10_000 });
    await pause(50);
    socket.write(`content-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);

    const answer = parse(await received);
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({ echo: { name: 'Invented Person' } });
    expect(answer.headers.connection).toBe('close');
    expect(await stopped).toBe(true);
  });

  it('gives up after the timeout and cuts the connections still open', async () => {
    const { port, started, release, parts } = await slowApp();
    const { socket, received } = await open(port);
    socket.write('GET /test/slow HTTP/1.1\r\nHost: api\r\n\r\n');
    await started.promise;

    const t0 = Date.now();
    expect(await shutDown({ ...parts, timeoutMs: 300 })).toBe(false);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(await received).toBe('');
    release.resolve();
  });
});
