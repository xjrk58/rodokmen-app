import { type Kysely, sql } from 'kysely';

/**
 * rdk_fold, the search normalisation behind name.search_text, place_name.search_text and the
 * Source title index, now treats no-break spaces (U+00A0, U+2007, U+202F) and U+FEFF as
 * whitespace. They arrive with text pasted from word processors, which put a no-break space
 * after Czech one-letter words ("Lhota u Kolína"); such a name was not found by a query typed
 * with ordinary spaces.
 *
 * The stored columns are recomputed by dropping and adding them again, which rewrites the table
 * without firing row triggers, so no record's version changes. shared/src/text.ts mirrors the
 * function (server/test/fold.test.ts compares them).
 */
const WHITESPACE = {
  before: '\\s+',
  after: '[\\s\\u00a0\\u2007\\u202f\\ufeff]+',
};

function fold(whitespace: string): string {
  return `
create or replace function rdk_fold(value text) returns text
language sql immutable parallel safe strict as $$
  select regexp_replace(lower(public.unaccent('public.unaccent'::regdictionary, value)), '${whitespace}', ' ', 'g')
$$;

alter table name drop column search_text;
alter table name add column search_text text generated always as (rdk_fold(given || ' ' || surname || ' ' || as_found)) stored;
create index name_search_trgm_idx on name using gin (search_text gin_trgm_ops);

alter table place_name drop column search_text;
alter table place_name add column search_text text generated always as (rdk_fold(name)) stored;
create index place_name_search_trgm_idx on place_name using gin (search_text gin_trgm_ops);

reindex index source_title_trgm_idx;
`;
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(fold(WHITESPACE.after)).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(fold(WHITESPACE.before)).execute(db);
}
