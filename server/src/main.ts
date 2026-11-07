import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { CONNECTION_CLOSED, createDb, migrateToLatest, reportOnStderr } from './db/db.js';
import { reapplyErasures } from './erasure/service.js';
import { DailyScheduler } from './jobs/daily.js';
import { createMailer } from './mail/mailer.js';
import { shutDown, SHUTDOWN_TIMEOUT_MS } from './shutdown.js';
import { createImageStorage } from './storage/images.js';
import { systemClock } from './clock.js';

/**
 * Starts the API: migrates the database (each release's migrations must work with the
 * previous release still running, because the old container serves until the new one is
 * healthy), then listens. Exits non-zero on failure, which fails the deploy health check.
 */
async function main() {
  const config = loadConfig();
  // A connection PostgreSQL closed is reported on stderr until the app's logger exists (#96).
  let reportIdleError = reportOnStderr;
  const db = createDb(config.databaseUrl, { onIdleError: (error) => reportIdleError(error) });
  const applied = await migrateToLatest(db);
  const mailer = createMailer(config, (line) => console.log(line));
  const images = createImageStorage(config.s3, systemClock);
  // A restored Backup may hold people erased since: erase them again before any request (erasure
  // spec, "Restores keep erased people erased"). A failure stops the start, and so the deploy.
  const erasedAgain = await reapplyErasures({ db, clock: systemClock, images, log: (msg, err) => console.error(msg, err) });
  const app = await buildApp({
    config,
    db,
    mailer,
    images,
    logger: { level: config.env === 'production' ? 'info' : 'debug', redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'] },
  });
  reportIdleError = (error) => app.log.warn({ error }, CONNECTION_CLOSED);
  if (applied.length) app.log.info({ applied }, 'migrations applied');
  if (erasedAgain.length) app.log.warn({ count: erasedAgain.length }, 'erased again Persons a restored Backup still held');
  // Readings left in the queue by the previous process run now, one at a time.
  const resumed = await app.readingJobs.resume();
  if (resumed) app.log.info({ resumed }, 'scan readings queued again');
  // A reading left running by a process that stopped during a deploy is taken over once stale.
  const sweep = setInterval(() => void app.readingJobs.resume().catch((err: unknown) => app.log.error({ err }, 'could not requeue readings')), 10 * 60_000);
  if (config.env === 'production' && !config.s3.configured) app.log.warn('object storage is not configured; image links will not work');

  // Daily jobs (Editor digest at 18:00 Prague time, deleting images of rejected Proposals, and the
  // nightly Export once the Owner configured it).
  if (!config.export) app.log.info('the nightly Export is off (RODOKMEN_EXPORT_ENABLED)');
  const stopJobs = new DailyScheduler({
    db,
    clock: systemClock,
    mailer,
    images,
    publicOrigin: config.publicOrigin,
    exportRepo: config.export,
    log: (msg, err) => app.log.error({ err }, msg),
  }).start();

  // Docker sends SIGTERM when a deploy stops the old slot (after the switch) or the stack stops.
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    app.log.info({ signal }, 'shutting down: finishing the requests in flight');
    clearInterval(sweep);
    shutDown({ app, stopJobs, db }).then(
      (finished) => {
        if (finished) app.log.info('stopped');
        else app.log.error(`shutdown did not finish within ${SHUTDOWN_TIMEOUT_MS / 1000} s; the connections still open were cut off`);
        process.exit(finished ? 0 : 1);
      },
      (error: unknown) => {
        app.log.error({ err: error }, 'shutdown failed');
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
