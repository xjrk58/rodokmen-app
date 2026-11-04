import { createServer, type RequestListener, type Server, type ServerResponse } from 'node:http';
import { Server as NetServer } from 'node:net';

/**
 * How long a stopping server goes on accepting connections while it fails its health check.
 * Caddy checks every 250 ms (deploy/caddy/Caddyfile) and sends no more requests to a server that
 * fails; only then may the server close its listening socket, as the kernel resets every
 * connection still waiting to be accepted, and Caddy would answer that request with 502.
 */
export const DRAIN_MS = 1_000;

/**
 * After the drain, how long the server waits for the requests it has. Docker stops the container
 * with SIGKILL 20 s after SIGTERM (stop_grace_period of the mcp service in
 * deploy/docker-compose.yml); drain and wait end a little before that.
 */
export const SHUTDOWN_TIMEOUT_MS = 15_000;

export interface StoppableServer {
  server: Server;
  /**
   * Stops the server without failing a request (#89): first it answers its health check with 503
   * for `drainMs` while it still accepts and answers requests, then it stops accepting connections.
   * Every answer from the start closes its connection (`Connection: close`), so no client sends
   * another request on it. It resolves true once the last connection has closed; after
   * `timeoutMs` more it cuts the connections still open and resolves false.
   */
  shutDown: (options?: { drainMs?: number; timeoutMs?: number }) => Promise<boolean>;
}

/**
 * An HTTP server for the MCP server that can stop while Caddy still sends it requests: each deploy
 * replaces its container (deploy/scripts/deploy.sh), and requests keep arriving until Caddy sees
 * the health check at `healthPath` fail.
 *
 * It never closes an idle connection itself, as http.Server's own close() would: a client may be
 * sending its next request on that connection at that very moment, and the request would fail
 * without an answer. Caddy opens a new connection for every request (deploy/caddy/Caddyfile), so it
 * leaves none idle; another client's idle connection closes when the client closes it, or at the
 * server's keep-alive timeout.
 */
export function stoppableServer(listener: RequestListener, { healthPath }: { healthPath: string }): StoppableServer {
  let stopping = false;
  const unanswered = new Set<ServerResponse>();
  const server = createServer((req, res) => {
    if (stopping) {
      res.setHeader('connection', 'close');
      if (req.method === 'GET' && new URL(req.url ?? '/', 'http://localhost').pathname === healthPath) {
        res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        return void res.end(JSON.stringify({ status: 'stopping' }));
      }
    } else {
      unanswered.add(res);
      res.once('close', () => unanswered.delete(res));
    }
    listener(req, res);
  });

  async function shutDown({ drainMs = DRAIN_MS, timeoutMs = SHUTDOWN_TIMEOUT_MS } = {}): Promise<boolean> {
    stopping = true;
    // Answers that have not started yet close their connection; one already streaming cannot say
    // so any more, and its connection closes when its client or the keep-alive timeout ends it.
    for (const res of unanswered) if (!res.headersSent) res.setHeader('connection', 'close');
    await new Promise((resolve) => setTimeout(resolve, drainMs));
    // net.Server's close() only stops accepting, and calls back once every connection has closed.
    const closed = new Promise<true>((resolve) => NetServer.prototype.close.call(server, () => resolve(true)));
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    try {
      const done = await Promise.race([closed, timedOut]);
      if (!done) server.closeAllConnections();
      return done;
    } finally {
      clearTimeout(timer);
    }
  }

  return { server, shutDown };
}
