import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { UiLanguage } from '@rodokmen/shared';
import { createOwner, requestEmailLink } from './auth/accounts.js';
import { loadConfig } from './config.js';
import { createDb, migrateToLatest } from './db/db.js';
import { loadFixture } from './fixture/load.js';
import { createMailer } from './mail/mailer.js';
import { sendAlert } from './ops/alerts.js';
import { OPENAPI_FILE, openApiJson } from './ops/openapi-file.js';
import { backupStatusReader, httpHealthCheck, Watchdog } from './ops/watchdog.js';
import { systemClock } from './clock.js';

const USAGE = `Usage: node dist/cli.js <command>

  migrate                         apply database migrations
  fixture load                    load the invented fixture Tree (not in production)
  create-owner --email E --name N [--language cs|en]
                                  create the first account, the Owner, and email a sign-in link
  openapi write [file]            write the OpenAPI description (default server/openapi.json)
  openapi check [file]            fail if the description is stale or a route lacks a schema
  alert --subject S [--details D] email the Owner an alert
  health [url]                    exit 0 when the health check passes
  watchdog                        alert the Owner on failing health checks and Backups
`;

async function run(argv: string[]): Promise<number> {
  const [command, sub, ...rest] = argv;
  const config = loadConfig();
  switch (command) {
    case 'migrate': {
      const db = createDb(config.databaseUrl);
      const applied = await migrateToLatest(db);
      console.log(applied.length ? `applied: ${applied.join(', ')}` : 'database is up to date');
      await db.destroy();
      return 0;
    }
    case 'fixture': {
      if (sub !== 'load') break;
      if (config.env === 'production') throw new Error('the fixture Tree is for development and tests only');
      const db = createDb(config.databaseUrl);
      await migrateToLatest(db);
      const model = await loadFixture(db);
      console.log(`loaded ${model.persons.length} invented Persons, ${model.events.length} Events`);
      await db.destroy();
      return 0;
    }
    case 'create-owner': {
      const { values } = parseArgs({ args: [sub, ...rest].filter((x): x is string => x !== undefined), options: { email: { type: 'string' }, name: { type: 'string' }, language: { type: 'string', default: 'cs' } } });
      if (!values.email || !values.name) break;
      const db = createDb(config.databaseUrl);
      await migrateToLatest(db);
      const mailer = createMailer(config, (line) => console.log(line));
      const deps = { db, clock: systemClock, mailer, publicOrigin: config.publicOrigin, session: { idleDays: config.sessionIdleDays } };
      const owner = await createOwner(deps, values.email, values.name, UiLanguage.parse(values.language));
      await requestEmailLink(deps, owner.email);
      console.log(`Owner ${owner.email} created; a sign-in link was emailed. After signing in, register a passkey.`);
      await db.destroy();
      return 0;
    }
    case 'openapi': {
      const file = rest[0] ?? OPENAPI_FILE;
      const { json, problems } = await openApiJson(config);
      if (problems.length) {
        console.error(`Routes and OpenAPI description disagree:\n  ${problems.join('\n  ')}`);
        return 1;
      }
      if (sub === 'write') {
        await writeFile(file, json);
        console.log(`wrote ${file}`);
        return 0;
      }
      if (sub === 'check') {
        const committed = await readFile(file, 'utf8').catch(() => '');
        if (committed !== json) {
          console.error(`${file} is stale. Run: pnpm --filter @rodokmen/server openapi`);
          return 1;
        }
        console.log('OpenAPI description matches the routes');
        return 0;
      }
      break;
    }
    case 'alert': {
      const { values } = parseArgs({ args: [sub, ...rest].filter((x): x is string => x !== undefined), options: { subject: { type: 'string' }, details: { type: 'string', default: '' } } });
      if (!values.subject) break;
      await sendAlert(config, createMailer(config), values.subject, values.details ?? '');
      return 0;
    }
    case 'health': {
      const result = await httpHealthCheck(sub ?? `http://127.0.0.1:${config.port}/api/health`, 5_000);
      if (!result.ok) console.error(result.detail);
      return result.ok ? 0 : 1;
    }
    case 'watchdog': {
      const mailer = createMailer(config);
      const watchdog = new Watchdog({
        checkHealth: () => httpHealthCheck(config.watchdog.url),
        readBackupStatus: config.watchdog.backupStatusFile ? backupStatusReader(config.watchdog.backupStatusFile) : undefined,
        alert: (subject, details) => sendAlert(config, mailer, subject, details),
        clock: systemClock,
      });
      console.log(`watchdog: checking ${config.watchdog.url} every 30 s${config.watchdog.backupStatusFile ? ` and ${config.watchdog.backupStatusFile}` : ''}`);
      for (;;) {
        await watchdog.tick().catch((error) => console.error('watchdog tick failed', error));
        await new Promise((r) => setTimeout(r, 30_000));
      }
    }
  }
  console.error(USAGE);
  return 2;
}

run(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
