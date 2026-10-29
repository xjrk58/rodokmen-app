import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb, migrateToLatest } from './db/db.js';
import { createMailer } from './mail/mailer.js';

/**
 * Starts the API: migrates the database (each release's migrations must work with the
 * previous release still running, because the old container serves until the new one is
 * healthy), then listens. Exits non-zero on failure, which fails the deploy health check.
 */
async function main() {
  const config = loadConfig();
  const db = createDb(config.databaseUrl);
  const applied = await migrateToLatest(db);
  const app = await buildApp({
    config,
    db,
    mailer: createMailer(config, (line) => console.log(line)),
    logger: { level: config.env === 'production' ? 'info' : 'debug', redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'] },
  });
  if (applied.length) app.log.info({ applied }, 'migrations applied');
  if (config.env === 'production' && !config.s3.configured) app.log.warn('object storage is not configured; image links will not work');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
