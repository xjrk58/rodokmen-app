import { RESTORABLE_TABLES, type RestorableTable } from '@rodokmen/shared';
import { sql } from 'kysely';
import { ApiProblem } from '../auth/problem.js';
import type { Db } from '../db/db.js';

/** A stored row as JSON (`to_jsonb(row)`): what the log keeps before and after each change. */
export type Snapshot = Record<string, unknown> & { id: string; version: number };

export interface Change {
  table: RestorableTable;
  id: string;
  before: Snapshot | null;
  after: Snapshot | null;
}

/**
 * Every record one Proposal touches, in the order first touched, with the snapshot before the
 * Proposal and after its last operation (tree-history spec, "Append-only log").
 */
export class ChangeSet {
  private readonly changes = new Map<string, Change>();

  record(table: RestorableTable, id: string, before: Snapshot | null, after: Snapshot | null): void {
    const key = `${table}:${id}`;
    const existing = this.changes.get(key);
    if (existing) existing.after = after;
    else this.changes.set(key, { table, id, before, after });
  }

  /** The version a record had before this Proposal touched it, if it touched it. */
  startVersion(table: RestorableTable, id: string): number | null | undefined {
    const c = this.changes.get(`${table}:${id}`);
    if (!c) return undefined;
    return c.before?.version ?? null;
  }

  list(): Change[] {
    // A record created and deleted again by the same Proposal leaves no trace.
    return [...this.changes.values()].filter((c) => c.before !== null || c.after !== null);
  }
}

const isTreeTable = (name: string): name is RestorableTable => (RESTORABLE_TABLES as readonly string[]).includes(name);

/** A table name checked against the closed list, safe to put into SQL. */
function table(name: string): RestorableTable {
  if (!isTreeTable(name)) throw new Error(`not a Tree table: ${name}`);
  return name;
}

export async function snapshot(db: Db, name: RestorableTable, id: string, lock = true): Promise<Snapshot | null> {
  const t = sql.table(table(name));
  const query = lock
    ? sql<{ row: Snapshot }>`select to_jsonb(t.*) as row from ${t} t where t.id = ${id} for update`
    : sql<{ row: Snapshot }>`select to_jsonb(t.*) as row from ${t} t where t.id = ${id}`;
  const { rows } = await query.execute(db);
  return rows[0]?.row ?? null;
}

const META_COLUMNS = new Set(['id', 'version', 'created_at', 'updated_at']);
const columnCache = new Map<string, string[]>();

/** Columns an undo writes back: everything except keys, versions, timestamps and generated columns. */
export async function restorableColumns(db: Db, name: RestorableTable): Promise<string[]> {
  const cached = columnCache.get(name);
  if (cached) return cached;
  const { rows } = await sql<{ column_name: string }>`
    select column_name from information_schema.columns
    where table_schema = current_schema() and table_name = ${table(name)} and is_generated = 'NEVER'
    order by ordinal_position`.execute(db);
  const columns = rows.map((r) => r.column_name).filter((c) => !META_COLUMNS.has(c));
  columnCache.set(name, columns);
  return columns;
}

export interface Rows {
  insert(name: RestorableTable, values: Record<string, unknown>): Promise<Snapshot>;
  update(name: RestorableTable, id: string, values: Record<string, unknown>): Promise<Snapshot>;
  remove(name: RestorableTable, id: string): Promise<void>;
  /** Writes columns of a logged snapshot back (re-inserting the record when it is gone). */
  restore(name: RestorableTable, id: string, values: Record<string, unknown>, columns?: readonly string[]): Promise<Snapshot>;
}

/** The snapshot of a row that was just written, which must exist. */
async function written(db: Db, name: RestorableTable, id: string): Promise<Snapshot> {
  const row = await snapshot(db, name, id);
  if (!row) throw new Error(`${name} ${id} vanished inside its own transaction`);
  return row;
}

/**
 * Row writes that record every change in the ChangeSet. The table is chosen at run time, which
 * Kysely's typed builders cannot express, so these are plain SQL; table and column names come
 * from the closed list of Tree tables and the operation schemas, values are parameters.
 */
export function trackedRows(db: Db, changes: ChangeSet): Rows {
  const t = (name: RestorableTable) => sql.table(`public.${table(name)}`);
  // Like Kysely's builders: an undefined value leaves the column to its default.
  const defined = (values: Record<string, unknown>) => Object.entries(values).filter(([, v]) => v !== undefined);
  return {
    async insert(name, values) {
      const entries = defined(values);
      const { rows } = await sql<{ id: string }>`insert into ${t(name)} (${sql.join(entries.map(([c]) => sql.ref(c)))})
        values (${sql.join(entries.map(([, v]) => v))}) returning id`.execute(db);
      const id = rows[0]?.id;
      if (!id) throw new Error(`insert into ${name} returned no id`);
      const after = await written(db, name, id);
      changes.record(name, id, null, after);
      return after;
    },
    async update(name, id, values) {
      const before = await snapshot(db, name, id);
      if (!before) throw new ApiProblem(409, 'record_missing', `The ${name.replace('_', ' ')} record ${id} no longer exists.`);
      const assignments = defined(values).map(([c, v]) => sql`${sql.ref(c)} = ${v}`);
      if (assignments.length > 0) await sql`update ${t(name)} set ${sql.join(assignments)} where id = ${id}`.execute(db);
      const after = await written(db, name, id);
      changes.record(name, id, before, after);
      return after;
    },
    async remove(name, id) {
      const before = await snapshot(db, name, id);
      if (!before) return;
      // Never let ON DELETE CASCADE / SET NULL change other records unseen and unlogged.
      const dependents = await dependentsOf(db, name, id);
      if (dependents.length) throw new DependentsProblem(name, id, dependents);
      await sql`delete from ${t(name)} where id = ${id}`.execute(db);
      changes.record(name, id, before, null);
    },
    async restore(name, id, values, only) {
      const all = await restorableColumns(db, name);
      const columns = only ? all.filter((c) => only.includes(c)) : all;
      const before = await snapshot(db, name, id);
      // Schema-qualified (see t): the table "name" would otherwise mean PostgreSQL's own type "name".
      const json = JSON.stringify(values);
      const list = sql.join(columns.map((c) => sql.ref(c)));
      if (before === null) {
        const version = typeof values.version === 'number' ? values.version + 1 : 1;
        await sql`insert into ${t(name)} (id, version, ${list})
          select ${id}::uuid, ${version}, ${list} from jsonb_populate_record(null::${t(name)}, ${json}::jsonb)`.execute(db);
      } else if (columns.length > 0) {
        await sql`update ${t(name)} set (${list}) = (select ${list} from jsonb_populate_record(null::${t(name)}, ${json}::jsonb)) where id = ${id}`.execute(db);
      }
      const after = await written(db, name, id);
      changes.record(name, id, before, after);
      return after;
    },
  };
}

/** Snapshots of many records of one table in one query, keyed by id (no lock). */
export async function snapshotsMany(db: Db, name: RestorableTable, ids: readonly string[]): Promise<Map<string, Snapshot>> {
  if (ids.length === 0) return new Map();
  const { rows } = await sql<{
    row: Snapshot;
  }>`select to_jsonb(t.*) as row from ${sql.table(table(name))} t where t.id = any(${[...new Set(ids)]}::uuid[])`.execute(db);
  return new Map(rows.map((r) => [r.row.id, r.row]));
}

export interface Dependent {
  table: RestorableTable;
  id: string;
}

/** A record cannot be deleted while other Tree records refer to it. */
export class DependentsProblem extends ApiProblem {
  constructor(
    readonly table: RestorableTable,
    readonly recordId: string,
    readonly dependents: Dependent[],
  ) {
    super(409, 'has_dependents', `The ${table.replace('_', ' ')} record ${recordId} is still referred to by ${dependents.length} other record(s).`);
  }
}

const fkCache = new Map<string, Array<{ table: RestorableTable; column: string }>>();

/** Foreign keys from Tree tables that point at a table, read from the catalog once. */
async function referencesTo(db: Db, name: RestorableTable): Promise<Array<{ table: RestorableTable; column: string }>> {
  const cached = fkCache.get(name);
  if (cached) return cached;
  const { rows } = await sql<{ table_name: string; column_name: string }>`
    select c.conrelid::regclass::text as table_name, a.attname as column_name
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f' and c.confrelid = ${`public.${table(name)}`}::regclass`.execute(db);
  const refs = rows.flatMap((r) => (isTreeTable(r.table_name) ? [{ table: r.table_name, column: r.column_name }] : []));
  fkCache.set(name, refs);
  return refs;
}

/** Tree records that refer to a record (and would be removed or changed by deleting it). */
export async function dependentsOf(db: Db, name: RestorableTable, id: string): Promise<Dependent[]> {
  const out: Dependent[] = [];
  for (const ref of await referencesTo(db, name)) {
    const { rows } = await sql<{ id: string }>`select id from ${sql.table(ref.table)} where ${sql.ref(ref.column)} = ${id}`.execute(db);
    for (const r of rows) out.push({ table: ref.table, id: r.id });
  }
  return out;
}
