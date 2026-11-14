import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { UiLanguage } from '@rodokmen/shared';
import { createOwner, requestEmailLink } from './auth/accounts.js';
import { loadConfig } from './config.js';
import { createDb, migrateToLatest } from './db/db.js';
import { importErasures, reapplyErasures } from './erasure/service.js';
import { gedcomOfTree, runExport } from './export/run.js';
import { loadFixture } from './fixture/load.js';
import { pragueTime } from './jobs/daily.js';
import { createImageStorage } from './storage/images.js';
import { createMailer } from './mail/mailer.js';
import { sendAlert } from './ops/alerts.js';
import { OPENAPI_FILE, openApiJson } from './ops/openapi-file.js';
import { backupStatusReader, CHECK_INTERVAL_MS, httpHealthCheck, startWatchdog, STOP_TIMEOUT_MS, Watchdog } from './ops/watchdog.js';
import { systemClock } from './clock.js';
import { messageOf } from './errors.js';
import { vaultImportCommand } from './vault-import/command.js';

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
  export run                      run the nightly Export now (only when RODOKMEN_EXPORT_ENABLED is true)
  export gedcom [file]            write the GEDCOM file of the Tree (default: standard output)
  erasures list                   print the erased Persons' ids and when, one per line
  erasures reapply [--list FILE]  add the ids in FILE (from a newer Backup's erasures.tsv) to the
                                  list of erasures, and erase again every listed Person the
                                  database still holds (the API does this too when it starts)
  vault-import --vault DIR [--dry-run] [--report FILE] [--name N] [--given-by N] [--root ID]…
                                  import the Vault through the API as one Import batch, with
                                  RODOKMEN_URL and an Agent token in RODOKMEN_TOKEN (see
                                  server/src/vault-import/README.md)
`;

type Config = ReturnType<typeof loadConfig>;
/** A command: its exit code, or null for a wrong use (the usage is printed). */
type Command = (config: Config, args: string[]) => Promise<number | null>;

const COMMANDS: Record<string, Command> = {
  async migrate(config) {
    const db = createDb(config.databaseUrl);
    const applied = await migrateToLatest(db);
    console.log(applied.length ? `applied: ${applied.join(', ')}` : 'database is up to date');
    await db.destroy();
    return 0;
  },

  async fixture(config, [sub]) {
    if (sub !== 'load') return null;
    if (config.env === 'production') throw new Error('the fixture Tree is for development and tests only');
    const db = createDb(config.databaseUrl);
    await migrateToLatest(db);
    const model = await loadFixture(db);
    console.log(`loaded ${model.persons.length} invented Persons, ${model.events.length} Events`);
    await db.destroy();
    return 0;
  },

  async 'create-owner'(config, args) {
    const { values } = parseArgs({ args, options: { email: { type: 'string' }, name: { type: 'string' }, language: { type: 'string', default: 'cs' } } });
    if (!values.email || !values.name) return null;
    const db = createDb(config.databaseUrl);
    await migrateToLatest(db);
    const mailer = createMailer(config, (line) => console.log(line));
    const deps = { db, clock: systemClock, mailer, publicOrigin: config.publicOrigin, session: { idleDays: config.sessionIdleDays } };
    const owner = await createOwner(deps, values.email, values.name, UiLanguage.parse(values.language));
    const email = owner.email ?? values.email;
    await requestEmailLink(deps, email);
    console.log(`Owner ${email} created; a sign-in link was emailed. After signing in, register a passkey.`);
    await db.destroy();
    return 0;
  },

  async openapi(config, [sub, file = OPENAPI_FILE]) {
    if (sub !== 'write' && sub !== 'check') return null;
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
    const committed = await readFile(file, 'utf8').catch(() => '');
    if (committed !== json) {
      console.error(`${file} is stale. Run: pnpm --filter @rodokmen/server openapi`);
      return 1;
    }
    console.log('OpenAPI description matches the routes');
    return 0;
  },

  async export(config, [sub, file]) {
    if (sub !== 'run' && sub !== 'gedcom') return null;
    const db = createDb(config.databaseUrl);
    try {
      await migrateToLatest(db);
      if (sub === 'gedcom') {
        const text = await gedcomOfTree(db, systemClock);
        if (file) await writeFile(file, text);
        else process.stdout.write(text);
        return 0;
      }
      if (!config.export) {
        console.error('The nightly Export is off: set RODOKMEN_EXPORT_ENABLED=true and RODOKMEN_EXPORT_REPO (deploy/README.md, "Nightly Export").');
        return 1;
      }
      const { day } = pragueTime(systemClock.now());
      console.log((await runExport({ db, clock: systemClock, repo: config.export }, day)).detail);
      return 0;
    } finally {
      await db.destroy();
    }
  },

  async erasures(config, [sub, ...args]) {
    if (sub !== 'list' && sub !== 'reapply') return null;
    const { values } = parseArgs({ args, options: { list: { type: 'string' } } });
    const db = createDb(config.databaseUrl);
    try {
      await migrateToLatest(db);
      if (sub === 'list') {
        for (const e of await db.selectFrom('erasure').select(['person_id', 'erased_at']).orderBy('erased_at').orderBy('person_id').execute())
          console.log(`${e.person_id}\t${new Date(e.erased_at).toISOString()}`);
        return 0;
      }
      if (values.list) console.log(`added ${await importErasures(db, await readFile(values.list, 'utf8'), systemClock.now())} erased ids from ${values.list}`);
      const again = await reapplyErasures({
        db,
        clock: systemClock,
        images: createImageStorage(config.s3, systemClock),
        log: (msg, err) => console.error(msg, err),
      });
      console.log(again.length ? `erased again ${again.length} Persons` : 'no erased Person remains');
      return 0;
    } finally {
      await db.destroy();
    }
  },

  async alert(config, args) {
    const { values } = parseArgs({ args, options: { subject: { type: 'string' }, details: { type: 'string', default: '' } } });
    if (!values.subject) return null;
    await sendAlert(config, createMailer(config), values.subject, values.details);
    return 0;
  },

  async health(config, [url]) {
    const result = await httpHealthCheck(url ?? `http://127.0.0.1:${config.port}/api/health`, 5_000);
    if (!result.ok) console.error(result.detail);
    return result.ok ? 0 : 1;
  },

  async watchdog(config) {
    const mailer = createMailer(config);
    const watchdog = new Watchdog({
      checkHealth: () => httpHealthCheck(config.watchdog.url),
      readBackupStatus: config.watchdog.backupStatusFile ? backupStatusReader(config.watchdog.backupStatusFile) : undefined,
      alert: (subject, details) => sendAlert(config, mailer, subject, details),
      clock: systemClock,
    });
    console.log(
      `watchdog: checking ${config.watchdog.url} every ${CHECK_INTERVAL_MS / 1000} s${config.watchdog.backupStatusFile ? ` and ${config.watchdog.backupStatusFile}` : ''}`,
    );
    const running = startWatchdog(watchdog, { onError: (error) => console.error('watchdog tick failed', error) });
    // Docker sends SIGTERM when a deploy replaces the container or the stack stops (#122).
    const signal = await new Promise<NodeJS.Signals>((resolve) => {
      process.on('SIGTERM', resolve);
      process.on('SIGINT', resolve);
    });
    console.log(`watchdog: ${signal}, stopping`);
    if (await running.stop()) return 0;
    console.error(`watchdog: a round of checks was still running after ${STOP_TIMEOUT_MS / 1000} s; it was given up`);
    return 1;
  },
};

/** Commands that are clients of a running server: they need no server configuration. */
const CLIENT_COMMANDS: Record<string, (args: string[]) => Promise<number | null>> = { 'vault-import': vaultImportCommand };

async function run([name, ...args]: string[]): Promise<number> {
  if (name !== undefined && Object.hasOwn(CLIENT_COMMANDS, name)) return (await CLIENT_COMMANDS[name]!(args)) ?? (console.error(USAGE), 2);
  const command = name !== undefined && Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  const code = command ? await command(loadConfig(), args) : null;
  if (code !== null) return code;
  console.error(USAGE);
  return 2;
}

run(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(messageOf(error));
    process.exit(1);
  },
);
