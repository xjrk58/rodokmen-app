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

const TABLES = new Set<string>(RESTORABLE_TABLES);

function table(name: string): RestorableTable {
  if (!TABLES.has(name)) throw new Error(`not a Tree table: ${name}`);
  return name as RestorableTable;
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
  restore(name: RestorableTable, id: string, values: Snapshot, columns?: readonly string[]): Promise<Snapshot>;
}

/** Row writes that record every change in the ChangeSet. */
export function trackedRows(db: Db, changes: ChangeSet): Rows {
  return {
    async insert(name, values) {
      const { id } = await db
        .insertInto(table(name) as 'person')
        .values(values as never)
        .returning('id')
        .executeTakeFirstOrThrow();
      const after = (await snapshot(db, name, id))!;
      changes.record(name, id, null, after);
      return after;
    },
    async update(name, id, values) {
      const before = await snapshot(db, name, id);
      if (!before) throw new ApiProblem(409, 'record_missing', `The ${name.replace('_', ' ')} record ${id} no longer exists.`);
      await db
        .updateTable(table(name) as 'person')
        .set(values as never)
        .where('id', '=', id)
        .execute();
      const after = (await snapshot(db, name, id))!;
      changes.record(name, id, before, after);
      return after;
    },
    async remove(name, id) {
      const before = await snapshot(db, name, id);
      if (!before) return;
      await db.deleteFrom(table(name) as 'person').where('id', '=', id).execute();
      changes.record(name, id, before, null);
    },
    async restore(name, id, values, only) {
      const all = await restorableColumns(db, name);
      const columns = only ? all.filter((c) => only.includes(c)) : all;
      const before = await snapshot(db, name, id);
      // Schema-qualified: the table "name" would otherwise mean PostgreSQL's own type "name".
      const t = sql.table(`public.${name}`);
      const json = JSON.stringify(values);
      const list = sql.join(columns.map((c) => sql.ref(c)));
      if (before === null) {
        await sql`insert into ${t} (id, version, ${list})
          select ${id}::uuid, ${values.version + 1}, ${list} from jsonb_populate_record(null::${t}, ${json}::jsonb)`.execute(db);
      } else if (columns.length > 0) {
        await sql`update ${t} set (${list}) = (select ${list} from jsonb_populate_record(null::${t}, ${json}::jsonb)) where id = ${id}`.execute(db);
      }
      const after = (await snapshot(db, name, id))!;
      changes.record(name, id, before, after);
      return after;
    },
  };
}
