import type { Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import { caddyBlock, caddySetting, composeSetting, durationMs } from '../../test/deploy-files.js';
import { portOf } from '../../test/helpers.js';
import { deferred, open, parse, pause, tryConnect } from '../../test/raw-http.js';
import { MCP_PATH } from '../src/http.js';
import { DRAIN_MS, SHUTDOWN_TIMEOUT_MS, stoppableServer } from '../src/shutdown.js';

/**
 * Replacing the MCP server's container during a deploy fails no request (#89): Caddy sends requests
 * until the old server fails its health check, then holds them until the new one passes it. The
 * tests speak HTTP/1.1 over plain sockets (server/test/raw-http.ts).
 */

/** A server with a request that runs until `release` and one answered at once, listening on a free port. */
async function slowServer() {
  const started = deferred();
  const release = deferred();
  const { server, shutDown } = stoppableServer(
    (req, res) => {
      if (req.url !== '/slow') return void res.end(`${req.method} answered`);
      started.resolve();
      void release.promise.then(() => res.end('slow done'));
    },
    { healthPath: '/mcp/health' },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: portOf(server.address()), started, release, shutDown };
}

/** The next answer on a connection that stays open. */
const nextAnswer = (socket: Socket) => new Promise<string>((resolve) => socket.once('data', (chunk: string) => resolve(chunk)));

/** One request on a new connection, and its answer. */
async function ask(port: number, request: string) {
  const { socket, received } = await open(port);
  socket.write(request);
  return parse(await received);
}

describe('stopping the MCP server', () => {
  it('first fails its health check for a while, still accepting and answering requests, and only then refuses new connections', async () => {
    const { port, shutDown } = await slowServer();
    expect((await ask(port, 'GET /mcp/health HTTP/1.1\r\nHost: mcp\r\nConnection: close\r\n\r\n')).status).toBe(200);

    const stopped = shutDown({ drainMs: 400, timeoutMs: 10_000 });
    await pause(50);
    const health = await ask(port, 'GET /mcp/health HTTP/1.1\r\nHost: mcp\r\n\r\n');
    expect(health.status).toBe(503);
    expect(health.headers.connection).toBe('close');
    const answer = await ask(port, 'POST /mcp HTTP/1.1\r\nHost: mcp\r\ncontent-length: 2\r\n\r\n{}');
    expect(answer.status).toBe(200);
    expect(answer.body).toBe('POST answered');
    expect(answer.headers.connection).toBe('close');

    expect(await stopped).toBe(true);
    expect(await tryConnect(port)).toBe('ECONNREFUSED');
  });

  it('answers a request in flight with Connection: close, refuses new connections, and finishes once it is answered', async () => {
    const { port, started, release, shutDown } = await slowServer();
    const { socket, received } = await open(port);
    socket.write('GET /slow HTTP/1.1\r\nHost: mcp\r\n\r\n');
    await started.promise;

    const t0 = Date.now();
    const stopped = shutDown({ drainMs: 0, timeoutMs: 10_000 });
    await pause(50);
    expect(await tryConnect(port)).toBe('ECONNREFUSED');

    release.resolve();
    const answer = parse(await received);
    expect(answer.status).toBe(200);
    expect(answer.body).toBe('slow done');
    expect(answer.headers.connection).toBe('close');
    expect(await stopped).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it('answers requests that arrive on connections that were idle when it began to stop, instead of closing those', async () => {
    const { port, shutDown } = await slowServer();
    // One connection kept alive after an earlier answer, and one that has sent nothing yet.
    const kept = await open(port);
    kept.socket.write('GET /mcp/health HTTP/1.1\r\nHost: mcp\r\n\r\n');
    const first = await nextAnswer(kept.socket);
    expect(parse(first).headers.connection).toBe('keep-alive');
    const fresh = await open(port);

    const stopped = shutDown({ drainMs: 0, timeoutMs: 10_000 });
    await pause(50);
    kept.socket.write('POST /mcp HTTP/1.1\r\nHost: mcp\r\ncontent-length: 2\r\n\r\n{}');
    fresh.socket.write('POST /mcp HTTP/1.1\r\nHost: mcp\r\ncontent-length: 2\r\n\r\n{}');

    for (const answer of [parse((await kept.received).slice(first.length)), parse(await fresh.received)]) {
      expect(answer.status).toBe(200);
      expect(answer.body).toBe('POST answered');
      expect(answer.headers.connection).toBe('close');
    }
    expect(await stopped).toBe(true);
  });

  it('gives up after the timeout and cuts the connections still open', async () => {
    const { port, started, release, shutDown } = await slowServer();
    const { socket, received } = await open(port);
    socket.write('GET /slow HTTP/1.1\r\nHost: mcp\r\n\r\n');
    await started.promise;

    const t0 = Date.now();
    expect(await shutDown({ drainMs: 0, timeoutMs: 300 })).toBe(false);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(await received).toBe('');
    release.resolve();
  });
});

describe('the MCP server in the production stack (deploy/)', () => {
  const caddy = caddyBlock('handle @mcp');

  it('Caddy opens a new connection for every request to it, so the server never closes one Caddy is about to reuse', () => {
    expect(caddySetting(caddy, 'keepalive')).toBe('off');
  });

  it('Caddy checks the health of the server often enough to stop sending it requests within the drain', () => {
    expect(caddySetting(caddy, 'health_uri')).toBe(`${MCP_PATH}/health`);
    expect(2 * durationMs(caddySetting(caddy, 'health_interval'))).toBeLessThanOrEqual(DRAIN_MS);
  });

  it('Caddy holds a request while the server restarts, for longer than a shutdown and a start take', () => {
    expect(durationMs(caddySetting(caddy, 'lb_try_duration'))).toBeGreaterThanOrEqual(DRAIN_MS + SHUTDOWN_TIMEOUT_MS + 10_000);
    expect(durationMs(caddySetting(caddy, 'lb_try_interval'))).toBeLessThanOrEqual(1_000);
  });

  it('Docker waits for the shutdown longer than it can take', () => {
    expect(durationMs(String(composeSetting('mcp', 'stop_grace_period')))).toBeGreaterThan(DRAIN_MS + SHUTDOWN_TIMEOUT_MS);
  });
});
