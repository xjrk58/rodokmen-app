import { type Kysely, sql } from 'kysely';

/**
 * The Tree (tree-model spec). Every table has a UUIDv7 `id`, an integer `version` bumped by
 * trigger on every change, and timestamps. Dates are stored as written (EDTF subset) plus
 * derived `*_earliest` / `*_latest` days; open ends are -infinity / infinity. Periods use
 * the same scheme with `valid_from` / `valid_to`. Locations are geography(Point, 4326).
 *
 * Room for later changes without rewriting data: Proposals and the log (ADR 0006) refer
 * to these ids and versions; merge, slugs and erasure add tables or nullable columns.
 */
export const TREE_TABLES = [
  'person',
  'name',
  'family',
  'family_child',
  'place',
  'place_name',
  'house',
  'house_number',
  'parish',
  'place_parish',
  'estate',
  'place_estate',
  'event',
  'event_role',
  'source',
  'citation',
  'event_citation',
  'name_citation',
  'image',
  'image_person',
] as const;

const record = `
  id uuid primary key default uuid_generate_v7(),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()`;

const period = (table: string) => `
  period_from text,
  period_to text,
  valid_from date not null default '-infinity',
  valid_to date not null default 'infinity',
  constraint ${table}_period_bounds check (valid_from <= valid_to)`;

const dated = (table: string) => `
  date text,
  date_earliest date,
  date_latest date,
  constraint ${table}_date_range check (
    (date is null and date_earliest is null and date_latest is null)
    or (date is not null and date_earliest is not null and date_latest is not null and date_earliest <= date_latest))`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
create table person (${record},
  sex text not null default 'unknown' check (sex in ('female', 'male', 'unknown'))
);

create table name (${record},
  person_id uuid not null references person (id) on delete cascade,
  given text not null default '',
  surname text not null default '',
  type text not null check (type in ('birth', 'married', 'latin', 'german', 'nickname', 'other')),
  as_found text not null check (length(trim(as_found)) > 0),
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  search_text text generated always as (rdk_fold(given || ' ' || surname || ' ' || as_found)) stored,
  constraint name_not_empty check (length(trim(given)) > 0 or length(trim(surname)) > 0)
);
create index name_person_idx on name (person_id);
create unique index name_one_primary_idx on name (person_id) where is_primary;
create index name_search_trgm_idx on name using gin (search_text gin_trgm_ops);

create table family (${record},
  partner1_id uuid references person (id) on delete set null,
  partner2_id uuid references person (id) on delete set null,
  constraint family_distinct_partners check (partner1_id is null or partner1_id <> partner2_id)
);
create index family_partner1_idx on family (partner1_id);
create index family_partner2_idx on family (partner2_id);

create table family_child (${record},
  family_id uuid not null references family (id) on delete cascade,
  child_id uuid not null references person (id) on delete cascade,
  link_type text not null check (link_type in ('birth', 'adoptive', 'foster', 'step')),
  sort_order integer not null default 0,
  unique (family_id, child_id)
);
create index family_child_child_idx on family_child (child_id);

create table place (${record},
  type text not null default 'village' check (type in ('village', 'town', 'hamlet', 'other')),
  location geography(Point, 4326),
  municipality_code text check (municipality_code ~ '^[0-9]{6}$'),
  municipality_name text,
  constraint place_municipality_pair check ((municipality_code is null) = (municipality_name is null))
);
create index place_location_idx on place using gist ((location::geometry));
create index place_municipality_idx on place (municipality_code);

create table place_name (${record},
  place_id uuid not null references place (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  language text not null check (language in ('cs', 'de', 'la')),
  is_primary boolean not null default false,
  ${period('place_name')},
  search_text text generated always as (rdk_fold(name)) stored
);
create index place_name_place_idx on place_name (place_id);
create unique index place_name_one_primary_idx on place_name (place_id) where is_primary;
create index place_name_search_trgm_idx on place_name using gin (search_text gin_trgm_ops);

create table house (${record},
  place_id uuid not null references place (id),
  location geography(Point, 4326),
  note text
);
create index house_place_idx on house (place_id);
create index house_location_idx on house using gist ((location::geometry));

create table house_number (${record},
  house_id uuid not null references house (id) on delete cascade,
  number text not null check (number ~ '^[0-9]{1,5}[a-z]?$'),
  ${period('house_number')}
);
create index house_number_house_idx on house_number (house_id);
create index house_number_number_idx on house_number (number);

create table parish (${record},
  name text not null check (length(trim(name)) > 0),
  seat_place_id uuid references place (id)
);

create table place_parish (${record},
  place_id uuid not null references place (id) on delete cascade,
  parish_id uuid not null references parish (id) on delete cascade,
  ${period('place_parish')}
);
create index place_parish_place_idx on place_parish (place_id);
create index place_parish_parish_idx on place_parish (parish_id);

create table estate (${record},
  name text not null check (length(trim(name)) > 0)
);

create table place_estate (${record},
  place_id uuid not null references place (id) on delete cascade,
  estate_id uuid not null references estate (id) on delete cascade,
  ${period('place_estate')}
);
create index place_estate_place_idx on place_estate (place_id);
create index place_estate_estate_idx on place_estate (estate_id);

create table event (${record},
  type text not null check (type in ('birth', 'baptism', 'marriage', 'death', 'burial', 'residence', 'census', 'other')),
  type_detail text,
  ${dated('event')},
  place_id uuid references place (id),
  house_id uuid references house (id),
  description text,
  constraint event_place_or_house check (num_nonnulls(place_id, house_id) <= 1),
  constraint event_other_detail check (type <> 'other' or length(trim(coalesce(type_detail, ''))) > 0)
);
create index event_earliest_idx on event (date_earliest);
create index event_place_idx on event (place_id);
create index event_house_idx on event (house_id);

create table event_role (${record},
  event_id uuid not null references event (id) on delete cascade,
  person_id uuid not null references person (id) on delete cascade,
  role text not null check (role in ('child', 'father', 'mother', 'partner', 'godparent', 'witness', 'priest', 'deceased', 'informant', 'other')),
  role_detail text,
  sort_order integer not null default 0,
  unique (event_id, person_id, role)
);
create index event_role_person_idx on event_role (person_id);

create table source (${record},
  type text not null check (type in ('parish_register', 'census', 'land_book', 'family_account', 'other')),
  title text not null check (length(trim(title)) > 0),
  repository text,
  reference text,
  url text,
  account_given_by text,
  account_given_by_person_id uuid references person (id) on delete set null,
  account_given_on text,
  constraint source_family_account check (
    (type = 'family_account') = (account_given_by is not null and account_given_on is not null)),
  constraint source_account_person check (type = 'family_account' or account_given_by_person_id is null)
);
create index source_title_trgm_idx on source using gin (rdk_fold(title) gin_trgm_ops);

create table citation (${record},
  source_id uuid not null references source (id),
  page text,
  transcription text not null check (length(trim(transcription)) > 0),
  read_on date not null,
  confidence text not null check (confidence in ('very_low', 'low', 'normal', 'high', 'very_high')),
  note text
);
create index citation_source_idx on citation (source_id);

create table event_citation (${record},
  event_id uuid not null references event (id) on delete cascade,
  citation_id uuid not null references citation (id) on delete cascade,
  unique (event_id, citation_id)
);
create index event_citation_citation_idx on event_citation (citation_id);

create table name_citation (${record},
  name_id uuid not null references name (id) on delete cascade,
  citation_id uuid not null references citation (id) on delete cascade,
  unique (name_id, citation_id)
);
create index name_citation_citation_idx on name_citation (citation_id);

create table image (${record},
  kind text not null check (kind in ('page', 'photo', 'portrait')),
  citation_id uuid references citation (id) on delete cascade,
  storage_key text not null unique,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 26214400),
  width integer check (width > 0),
  height integer check (height > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  caption text,
  constraint image_evidence_has_citation check (kind = 'portrait' or citation_id is not null)
);
create index image_citation_idx on image (citation_id);

create table image_person (${record},
  image_id uuid not null references image (id) on delete cascade,
  person_id uuid not null references person (id) on delete cascade,
  unique (image_id, person_id)
);
create index image_person_person_idx on image_person (person_id);

-- Exactly one primary Name per Person, checked at commit so a transaction may reorder Names.
create function rdk_check_person_names() returns trigger
language plpgsql as $$
declare
  pid uuid;
  primaries integer;
begin
  if tg_table_name = 'person' then
    pid := new.id;
  elsif tg_op = 'DELETE' then
    pid := old.person_id;
  else
    pid := new.person_id;
  end if;
  if not exists (select 1 from person where id = pid) then
    return null;
  end if;
  select count(*) filter (where is_primary) into primaries from name where person_id = pid;
  if primaries <> 1 then
    raise exception 'a Person has exactly one primary Name (person %, found %)', pid, primaries
      using errcode = 'check_violation';
  end if;
  -- A Name moved to another Person: the Person it left must still have one primary Name.
  if tg_table_name = 'name' and tg_op = 'UPDATE' then
    if old.person_id <> new.person_id
       and exists (select 1 from person where id = old.person_id)
       and (select count(*) filter (where is_primary) from name where person_id = old.person_id) <> 1 then
      raise exception 'a Person has exactly one primary Name (person %)', old.person_id using errcode = 'check_violation';
    end if;
  end if;
  return null;
end
$$;
create constraint trigger person_has_one_primary_name after insert on person
  deferrable initially deferred for each row execute function rdk_check_person_names();
create constraint trigger name_one_primary after insert or update or delete on name
  deferrable initially deferred for each row execute function rdk_check_person_names();

-- Exactly one primary name per Place, likewise.
create function rdk_check_place_names() returns trigger
language plpgsql as $$
declare
  pid uuid;
  primaries integer;
begin
  if tg_table_name = 'place' then
    pid := new.id;
  elsif tg_op = 'DELETE' then
    pid := old.place_id;
  else
    pid := new.place_id;
  end if;
  if not exists (select 1 from place where id = pid) then
    return null;
  end if;
  select count(*) filter (where is_primary) into primaries from place_name where place_id = pid;
  if primaries <> 1 then
    raise exception 'a Place has exactly one primary name (place %, found %)', pid, primaries
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;
create constraint trigger place_has_one_primary_name after insert on place
  deferrable initially deferred for each row execute function rdk_check_place_names();
create constraint trigger place_name_one_primary after insert or update or delete on place_name
  deferrable initially deferred for each row execute function rdk_check_place_names();
`,
    )
    .execute(db);

  for (const table of TREE_TABLES) {
    await sql.raw(`create trigger ${table}_bump_version before update on ${table} for each row execute function rdk_bump_version();`).execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      [...TREE_TABLES]
        .reverse()
        .map((t) => `drop table if exists ${t} cascade;`)
        .join('\n'),
    )
    .execute(db);
  await sql.raw(`drop function if exists rdk_check_person_names(); drop function if exists rdk_check_place_names();`).execute(db);
}
