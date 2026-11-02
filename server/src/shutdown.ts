import type { FastifyInstance } from 'fastify';

/**
 * Docker stops a container with SIGKILL 20 s after SIGTERM (stop_grace_period in
 * deploy/docker-compose.yml); the server gives up waiting a little before that.
 */
export const SHUTDOWN_TIMEOUT_MS = 15_000;

export interface ShutdownParts {
  app: Pick<FastifyInstance, 'close' | 'server'>;
  /** Stops the daily jobs and waits for a running one. */
  stopJobs: () => Promise<void>;
  db: { destroy(): Promise<void> };
  timeoutMs?: number;
}

/**
 * Stops the API without failing a request (#71). By the time a deploy stops a slot, Caddy sends
 * new requests to the other one (deploy/scripts/deploy.sh), so this: stops accepting connections,
 * lets the requests in flight finish (each answer closes its connection, app.ts), stops the daily
 * jobs, and only then closes the database pool, which those requests still use.
 *
 * Resolves true when all of it finished within the timeout. Otherwise the remaining connections
 * are cut, and it resolves false without waiting further.
 */
export async function shutDown({ app, stopJobs, db, timeoutMs = SHUTDOWN_TIMEOUT_MS }: ShutdownParts): Promise<boolean> {
  const finished = (async () => {
    await Promise.all([app.close(), stopJobs()]);
    await db.destroy();
    return true;
  })();
  // After a timeout nobody waits for it any more; its failure must not end the process early.
  finished.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    const done = await Promise.race([finished, timedOut]);
    if (!done) app.server.closeAllConnections();
    return done;
  } finally {
    clearTimeout(timer);
  }
}
