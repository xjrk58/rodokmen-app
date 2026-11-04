import { createHttpHandler, MCP_PATH } from './http.js';
import { DRAIN_MS, SHUTDOWN_TIMEOUT_MS, stoppableServer } from './shutdown.js';

/**
 * Serves the MCP server over streamable HTTP (deploy/docker-compose.yml, service `mcp`; Caddy
 * forwards /mcp to it). Configuration:
 *
 *   RODOKMEN_API_URL  where the API is reached, default http://127.0.0.1:3000
 *   PUBLIC_ORIGIN     the public origin; its host name is the one the server answers to
 *   HOST, PORT        where to listen, default 127.0.0.1:3001
 */
const apiUrl = process.env.RODOKMEN_API_URL ?? 'http://127.0.0.1:3000';
const publicHost = new URL(process.env.PUBLIC_ORIGIN ?? 'http://localhost:3001').hostname;
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3001);

const handle = createHttpHandler({
  apiUrl,
  allowedHosts: [...new Set([publicHost, 'localhost', '127.0.0.1'])],
  onerror: (error) => console.error(error),
});
const { server, shutDown } = stoppableServer(
  (req, res) => {
    handle(req, res).catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal', message: 'Something went wrong.' }));
    });
  },
  { healthPath: `${MCP_PATH}/health` },
);
server.listen(port, host, () => console.log(`Rodokmen MCP server on http://${host}:${port}${MCP_PATH}, API at ${apiUrl}`));

// Docker sends SIGTERM when a deploy replaces the container or the stack stops. Caddy stops sending
// requests here once the health check fails, and holds them until the new container passes it
// (deploy/caddy/Caddyfile); this one answers what it already has.
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: finishing the requests in flight`);
    void shutDown().then((finished) => {
      if (finished) console.log('stopped');
      else console.error(`shutdown did not finish within ${(DRAIN_MS + SHUTDOWN_TIMEOUT_MS) / 1000} s; the connections still open were cut off`);
      process.exit(finished ? 0 : 1);
    });
  });
}
