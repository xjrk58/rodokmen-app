import { Kysely, PostgresDialect } from 'kysely';
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';
import pg from 'pg';
import * as m0001 from './migrations/0001_foundations.js';
import * as m0002 from './migrations/0002_tree.js';
import * as m0003 from './migrations/0003_accounts.js';
import * as m0004 from './migrations/0004_proposals.js';
import * as m0005 from './migrations/0005_fold_spaces.js';
import * as m0006 from './migrations/0006_agents.js';
import * as m0007 from './migrations/0007_member_person.js';
import * as m0008 from './migrations/0008_family_relation.js';
import * as m0009 from './migrations/0009_scan_reading.js';
import { messageOf } from '../errors.js';
import type { Database } from './types.js';

// Return `date` columns as written ('1801-03-12', 'infinity', '-infinity') instead of JS Dates,
// and counts (int8) as numbers: the Tree stays far below 2^53 rows.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export type Db = Kysely<Database>;

export interface DbOptions {
  max?: number;
  connectionTimeoutMillis?: number;
}

export function createPool(connectionString: string, options: DbOptions = {}): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 10_000,
    idleTimeoutMillis: 30_000,
  });
}

export function createDb(connectionString: string, options: DbOptions = {}): Db {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: createPool(connectionString, options) }) });
}

/** Migrations are listed here, in order, so the built server needs no migration folder scan. */
export const MIGRATIONS: Record<string, Migration> = {
  '0001_foundations': m0001,
  '0002_tree': m0002,
  '0003_accounts': m0003,
  '0004_proposals': m0004,
  '0005_fold_spaces': m0005,
  '0006_agents': m0006,
  '0007_member_person': m0007,
  '0008_family_relation': m0008,
  '0009_scan_reading': m0009,
};

const provider: MigrationProvider = { getMigrations: async () => MIGRATIONS };

export async function migrateToLatest(db: Db): Promise<string[]> {
  const migrator = new Migrator({ db, provider, migrationTableName: 'schema_migration', migrationLockTableName: 'schema_migration_lock' });
  const { error, results } = await migrator.migrateToLatest();
  const failed = results?.find((r) => r.status === 'Error');
  if (error || failed) {
    const reason = error === undefined ? 'unknown error' : messageOf(error);
    throw new Error(`Migration ${failed?.migrationName ?? ''} failed: ${reason}`);
  }
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}
