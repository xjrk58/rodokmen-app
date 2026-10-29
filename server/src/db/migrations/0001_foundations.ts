import { type Kysely, sql } from 'kysely';

/**
 * Extensions and helper functions used by every later migration:
 * - uuid_generate_v7(): UUIDv7 defaults for every primary key (PostgreSQL 16 has no built-in).
 * - rdk_fold(text): lower case without diacritics, IMMUTABLE so it can back generated columns
 *   and indexes (unaccent itself is only STABLE).
 * - rdk_bump_version(): BEFORE UPDATE trigger that increments `version` whenever a row
 *   actually changes, in the same transaction as the change.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
create extension if not exists postgis;
create extension if not exists unaccent;
create extension if not exists pg_trgm;

create function uuid_generate_v7() returns uuid
language sql volatile parallel safe as $$
  select encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid())
                placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
                from 1 for 6),
        52, 1),
      53, 1),
    'hex')::uuid
$$;

create function rdk_fold(value text) returns text
language sql immutable parallel safe strict as $$
  select regexp_replace(lower(public.unaccent('public.unaccent'::regdictionary, value)), '\\s+', ' ', 'g')
$$;

create function rdk_bump_version() returns trigger
language plpgsql as $$
begin
  if row(new.*) is distinct from row(old.*) then
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end
$$;
`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`drop function rdk_bump_version(); drop function rdk_fold(text); drop function uuid_generate_v7();`).execute(db);
}
