import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import { Migrator } from 'kysely/migration';
import { createDb, migrateToLatest, MIGRATIONS, type Db } from '../src/db/db.js';
import { TREE_TABLES } from '../src/db/migrations/0002_tree.js';
import { dropDatabase } from './db.js';
import { databaseUrl } from './global-setup.js';

/** Migrates a database created empty (no template), as a fresh deployment would. */
describe('migrations on an empty database', () => {
  const name = `${inject('templateDatabase').replace(/_tpl$/, '')}_empty_${randomBytes(3).toString('hex')}`;
  let admin: pg.Client;
  let db: Db;
  let applied: string[];

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: inject('adminDatabaseUrl') });
    await admin.connect();
    await admin.query(`create database ${name}`);
    db = createDb(databaseUrl(inject('adminDatabaseUrl'), name), { max: 2 });
    applied = await migrateToLatest(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await dropDatabase(admin, name);
    await admin.end();
  });

  it('applies every migration in order, and a second run applies none', async () => {
    expect(applied).toEqual(Object.keys(MIGRATIONS));
    expect(await migrateToLatest(db)).toEqual([]);
  });

  it('creates every Tree table with a uuid id defaulting to UUIDv7 and an integer version', async () => {
    const { rows } = await sql<{ table_name: string; column_name: string; data_type: string; column_default: string | null }>`
      select table_name, column_name, data_type, column_default from information_schema.columns
      where table_schema = 'public' and column_name in ('id', 'version')`.execute(db);
    for (const table of TREE_TABLES) {
      const id = rows.find((r) => r.table_name === table && r.column_name === 'id');
      const version = rows.find((r) => r.table_name === table && r.column_name === 'version');
      expect(id, `${table}.id`).toMatchObject({ data_type: 'uuid', column_default: 'uuid_generate_v7()' });
      expect(version, `${table}.version`).toMatchObject({ data_type: 'integer', column_default: '1' });
    }
  });

  it('generates time-ordered UUIDv7 ids', async () => {
    const { rows } = await sql<{ id: string }>`select uuid_generate_v7()::text as id from generate_series(1, 50)`.execute(db);
    for (const { id } of rows) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const first = rows[0]!.id.replace(/-/g, '').slice(0, 12);
    expect(Math.abs(parseInt(first, 16) - Date.now())).toBeLessThan(60_000);
  });

  it('stores Place and House locations as PostGIS geography points', async () => {
    const { rows } = await sql<{ f_table_name: string; type: string; srid: number }>`
      select f_table_name, type, srid from geography_columns where f_geography_column = 'location' order by f_table_name`.execute(db);
    expect(rows).toEqual([
      { f_table_name: 'house', type: 'Point', srid: 4326 },
      { f_table_name: 'place', type: 'Point', srid: 4326 },
    ]);
  });

  it('bumps the version in the same transaction as each change, and only when something changed', async () => {
    const person = await db.transaction().execute(async (tx) => {
      const p = await tx.insertInto('person').values({ sex: 'male' }).returning(['id', 'version']).executeTakeFirstOrThrow();
      await tx.insertInto('name').values({ person_id: p.id, given: 'Jan', surname: 'Novák', type: 'birth', as_found: 'Jan Novák', is_primary: true }).execute();
      return p;
    });
    expect(person.version).toBe(1);
    const changed = await db.updateTable('person').set({ sex: 'unknown' }).where('id', '=', person.id).returning('version').executeTakeFirstOrThrow();
    expect(changed.version).toBe(2);
    const unchanged = await db.updateTable('person').set({ sex: 'unknown' }).where('id', '=', person.id).returning('version').executeTakeFirstOrThrow();
    expect(unchanged.version).toBe(2);
  });

  it('requires exactly one primary Name per Person at commit', async () => {
    await expect(db.insertInto('person').values({ sex: 'female' }).execute()).rejects.toThrow(/exactly one primary Name/);
    await expect(
      db.transaction().execute(async (tx) => {
        const p = await tx.insertInto('person').values({ sex: 'female' }).returning('id').executeTakeFirstOrThrow();
        await tx.insertInto('name').values({ person_id: p.id, given: 'Anna', surname: 'A', type: 'birth', as_found: 'Anna A', is_primary: false }).execute();
      }),
    ).rejects.toThrow(/exactly one primary Name/);
  });

  it('enforces Family, Event and Source rules in the database too', async () => {
    const { id } = await db.transaction().execute(async (tx) => {
      const p = await tx.insertInto('person').values({ sex: 'male' }).returning('id').executeTakeFirstOrThrow();
      await tx.insertInto('name').values({ person_id: p.id, given: 'Petr', surname: 'B', type: 'birth', as_found: 'Petr B', is_primary: true }).execute();
      return p;
    });
    await expect(db.insertInto('family').values({ partner1_id: id, partner2_id: id }).execute()).rejects.toThrow(/family_distinct_partners/);
    await expect(
      db.insertInto('event').values({ type: 'birth', date: '1801', date_earliest: '1802-01-01', date_latest: '1801-12-31' }).execute(),
    ).rejects.toThrow(/event_date_range/);
    await expect(db.insertInto('source').values({ type: 'family_account', title: 'Oral history' }).execute()).rejects.toThrow(/source_family_account/);
  });

  it('allows at most one Owner, and exactly one once accounts exist', async () => {
    await expect(
      db.insertInto('account').values({ email: 'a@example.test', display_name: 'A', language: 'cs', role: 'contributor' }).execute(),
    ).rejects.toThrow(/exactly one Owner/);
    await db.insertInto('account').values({ email: 'owner@example.test', display_name: 'O', language: 'cs', role: 'owner' }).execute();
    await expect(db.insertInto('account').values({ email: 'b@example.test', display_name: 'B', language: 'en', role: 'owner' }).execute()).rejects.toThrow(
      /account_one_owner_idx/,
    );
  });

  it('the Proposals and fold migrations can be rolled back and applied again', async () => {
    const migrator = new Migrator({
      db,
      provider: { getMigrations: async () => MIGRATIONS },
      migrationTableName: 'schema_migration',
      migrationLockTableName: 'schema_migration_lock',
    });
    const down = await migrator.migrateTo('0003_accounts');
    expect(down.error).toBeUndefined();
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ['0005_fold_spaces', 'Success'],
      ['0004_proposals', 'Success'],
    ]);
    // The one-primary-Name check works again without merged_into_id.
    await db.transaction().execute(async (tx) => {
      const p = await tx.insertInto('person').values({ sex: 'female' }).returning('id').executeTakeFirstOrThrow();
      await tx.insertInto('name').values({ person_id: p.id, given: 'Dana', surname: 'Invented', type: 'birth', as_found: 'Dana', is_primary: true }).execute();
    });
    expect(await migrateToLatest(db)).toEqual(['0004_proposals', '0005_fold_spaces']);
  });
});
