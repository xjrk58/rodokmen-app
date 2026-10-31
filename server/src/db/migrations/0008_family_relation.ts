import { type Kysely, sql } from 'kysely';

/**
 * Family roots and the relation to the family (tree-model spec, "Family roots", "Relation to
 * the family is computed", "Relation follows the evidence"; add-vault-import tasks 1.3 and 1.4).
 *
 * - family_root: the Persons the Owner marked as Family roots, one row each. A Tree record like
 *   a Family link, so marking one is logged, undone and moved by a merge like any other change,
 *   and a Person who is a Family root cannot be deleted by an undo without it.
 * - person.relation: the relation to the family, derived by the rule in shared/src/relation.ts
 *   and stored so that search and the map filter cheaply. The server recomputes it in the
 *   transaction of every accepted change (server/src/tree/relation.ts). Being derived, it is
 *   not a change of the Person: it bumps no version and is left out of the log's snapshots.
 *   Until the first Family root, everyone is unrelated.
 *
 * Works with the previous release still running: it never reads the new column or table.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
create table family_root (
  id uuid primary key default uuid_generate_v7(),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  person_id uuid not null unique references person (id) on delete cascade
);
create trigger family_root_bump_version before update on family_root for each row execute function rdk_bump_version();

alter table person add column relation text not null default 'unrelated' check (relation in ('relative', 'possible', 'unrelated'));
create index person_relation_idx on person (relation) where merged_into_id is null;

-- A Person's version changes with the Person, not with the derived relation.
create function rdk_bump_person_version() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'relation') is distinct from (to_jsonb(old) - 'relation') then
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end
$$;
drop trigger person_bump_version on person;
create trigger person_bump_version before update on person for each row execute function rdk_bump_person_version();
`,
    )
    .execute(db);
}

/** Drops the Family roots and the stored relation; log entries of Family roots stay, but can no longer be undone. */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
drop trigger person_bump_version on person;
create trigger person_bump_version before update on person for each row execute function rdk_bump_version();
drop function rdk_bump_person_version();
drop index person_relation_idx;
alter table person drop column relation;
drop table family_root;
`,
    )
    .execute(db);
}
