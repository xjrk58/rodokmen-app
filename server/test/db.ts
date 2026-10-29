import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { createDb, type Db } from '../src/db/db.js';
import { databaseUrl } from './global-setup.js';

export interface TestDatabase {
  url: string;
  db: Db;
  drop(): Promise<void>;
}

/** A fresh copy of the migrated fixture database, for one test file. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = inject('adminDatabaseUrl');
  const template = inject('templateDatabase');
  const name = `${template.replace(/_tpl$/, '')}_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5_000 });
  await admin.connect();
  // Cloning fails while another session is connected to the template; retry briefly.
  for (let attempt = 0; ; attempt++) {
    try {
      await admin.query(`create database ${name} template ${template}`);
      break;
    } catch (error) {
      if (attempt >= 20 || !/being accessed by other users/.test((error as Error).message)) throw error;
      await new Promise((r) => setTimeout(r, 100 + attempt * 50));
    }
  }
  const url = databaseUrl(adminUrl, name);
  const db = createDb(url, { max: 5, connectionTimeoutMillis: 5_000 });
  return {
    url,
    db,
    async drop() {
      await db.destroy();
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}
