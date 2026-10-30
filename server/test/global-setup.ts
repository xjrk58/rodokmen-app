import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { createDb, migrateToLatest } from '../src/db/db.js';
import { loadFixture } from '../src/fixture/load.js';
import { messageOf } from '../src/errors.js';

declare module 'vitest' {
  export interface ProvidedContext {
    adminDatabaseUrl: string;
    templateDatabase: string;
  }
}

/** Admin connection used to create throwaway databases. The role must be allowed to create databases. */
export function adminDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://rodokmen:rodokmen@localhost:5432/rodokmen_dev';
}

export function databaseUrl(adminUrl: string, database: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

async function connectAdmin(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    return client;
  } catch (error) {
    const safe = url.replace(/\/\/([^:@/]+):[^@/]*@/, '//$1:***@');
    const message =
      `PostgreSQL is not reachable at ${safe} (${messageOf(error)}).\n` +
      'The server tests need PostgreSQL 16 with PostGIS, unaccent and pg_trgm, and a role that can create databases.\n' +
      'Start it, or point TEST_DATABASE_URL at one.';
    // Printed as well as thrown: some Vitest versions fail to print errors thrown from global setup.
    console.error(`\n${message}\n`);
    throw new Error(message, { cause: error });
  }
}

/**
 * Creates one template database per test run: migrated from empty and loaded with the
 * invented fixture Tree. Each test file clones it (see test/db.ts), and teardown drops all.
 */
export default async function setup(project: TestProject) {
  const adminUrl = adminDatabaseUrl();
  const prefix = `rdk_test_${randomBytes(4).toString('hex')}`;
  const template = `${prefix}_tpl`;
  const admin = await connectAdmin(adminUrl);
  await admin.query(`create database ${template}`);

  const db = createDb(databaseUrl(adminUrl, template), { max: 4 });
  try {
    await migrateToLatest(db);
    await loadFixture(db);
  } catch (error) {
    await db.destroy();
    await admin.query(`drop database if exists ${template} with (force)`);
    await admin.end();
    throw error;
  }
  await db.destroy();

  project.provide('adminDatabaseUrl', adminUrl);
  project.provide('templateDatabase', template);

  return async () => {
    const { rows } = await admin.query<{ datname: string }>(`select datname from pg_database where datname like $1`, [`${prefix}%`]);
    for (const { datname } of rows) await admin.query(`drop database if exists ${datname} with (force)`);
    await admin.end();
  };
}
