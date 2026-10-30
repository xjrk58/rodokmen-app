import { type Kysely, sql } from 'kysely';

/**
 * Proposals, the log and uploads (proposals, review, tree-history, evidence-media and
 * notifications specs).
 *
 * - proposal / proposal_operation: a Proposal and its ordered typed operations. The author's
 *   operation is kept; an Editor correction is stored next to it, with who made it.
 * - log_entry / log_change: append-only. One entry per accepted Proposal (contributions,
 *   direct Editor changes, merges, undos), with the before and after snapshot of every
 *   touched record. Updates and deletes are refused unless the transaction sets
 *   `rdk.erasure = 'on'` (the erasure capability, add-exports-and-erasure).
 * - upload: an image on its way in: presigned PUT into `pending/`, checked and given a WebP
 *   display copy, moved to `images/` when its Proposal is accepted.
 * - person.merged_into_id: a merged Person stays as a redirect to the kept one, so undo can
 *   restore it. A merged Person has no Names, so the one-primary-Name check skips it.
 * - account.outcome_emails: Members can mute outcome emails.
 * - job_run / job_delivery: which daily job ran on which Prague day, and to whom it sent email.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
alter table person add column merged_into_id uuid references person (id);
create index person_merged_into_idx on person (merged_into_id) where merged_into_id is not null;

create or replace function rdk_check_person_names() returns trigger
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
  if not exists (select 1 from person where id = pid and merged_into_id is null) then
    return null;
  end if;
  select count(*) filter (where is_primary) into primaries from name where person_id = pid;
  if primaries <> 1 then
    raise exception 'a Person has exactly one primary Name (person %, found %)', pid, primaries
      using errcode = 'check_violation';
  end if;
  if tg_table_name = 'name' and tg_op = 'UPDATE' then
    if old.person_id <> new.person_id
       and exists (select 1 from person where id = old.person_id and merged_into_id is null)
       and (select count(*) filter (where is_primary) from name where person_id = old.person_id) <> 1 then
      raise exception 'a Person has exactly one primary Name (person %)', old.person_id using errcode = 'check_violation';
    end if;
  end if;
  return null;
end
$$;
-- Merging or un-merging a Person must leave the right number of primary Names too.
create constraint trigger person_merge_names after update of merged_into_id on person
  deferrable initially deferred for each row execute function rdk_check_person_names();

alter table image add column display_key text;

alter table account add column outcome_emails boolean not null default true;

create table proposal (
  id uuid primary key default uuid_generate_v7(),
  version integer not null default 1 check (version > 0),
  kind text not null default 'contribution' check (kind in ('contribution', 'direct', 'undo')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  author_id uuid not null references account (id),
  note text,
  format_version integer not null,
  idempotency_key text not null,
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references account (id),
  decision_note text,
  undoes_proposal_id uuid references proposal (id),
  undone_by_proposal_id uuid references proposal (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (author_id, idempotency_key),
  constraint proposal_decided check ((status = 'pending') = (decided_at is null)),
  constraint proposal_undo check ((kind = 'undo') = (undoes_proposal_id is not null))
);
create index proposal_pending_idx on proposal (submitted_at) where status = 'pending';
create index proposal_author_idx on proposal (author_id, submitted_at desc);
create trigger proposal_bump_version before update on proposal for each row execute function rdk_bump_version();

create table proposal_operation (
  proposal_id uuid not null references proposal (id) on delete cascade,
  position integer not null check (position >= 0),
  op text not null,
  operation jsonb not null,
  target_table text,
  target_id uuid,
  base_version integer,
  corrected jsonb,
  corrected_by uuid references account (id),
  corrected_at timestamptz,
  primary key (proposal_id, position),
  constraint proposal_operation_correction check ((corrected is null) = (corrected_by is null))
);
create index proposal_operation_target_idx on proposal_operation (target_id) where target_id is not null;

create table log_entry (
  id uuid primary key default uuid_generate_v7(),
  proposal_id uuid not null unique references proposal (id),
  kind text not null check (kind in ('contribution', 'direct', 'undo')),
  author_id uuid not null references account (id),
  accepted_by uuid not null references account (id),
  accepted_at timestamptz not null,
  citation_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index log_entry_accepted_idx on log_entry (accepted_at desc);

create table log_change (
  id bigint generated always as identity primary key,
  log_entry_id uuid not null references log_entry (id),
  seq integer not null,
  record_table text not null,
  record_id uuid not null,
  before jsonb,
  after jsonb,
  unique (log_entry_id, seq),
  constraint log_change_something check (before is not null or after is not null)
);
create index log_change_record_idx on log_change (record_id);
create index log_change_entry_idx on log_change (log_entry_id);
create index log_change_person_idx on log_change using gin ((coalesce(before, '{}'::jsonb) || coalesce(after, '{}'::jsonb)) jsonb_path_ops);
create index log_change_before_idx on log_change using gin (before jsonb_path_ops);

create function rdk_log_append_only() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('rdk.erasure', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'the log is append-only (% on %)', tg_op, tg_table_name using errcode = 'insufficient_privilege';
end
$$;
create trigger log_entry_append_only before update or delete on log_entry for each row execute function rdk_log_append_only();
create trigger log_change_append_only before update or delete on log_change for each row execute function rdk_log_append_only();

create table upload (
  id uuid primary key default uuid_generate_v7(),
  version integer not null default 1 check (version > 0),
  author_id uuid not null references account (id),
  status text not null default 'waiting' check (status in ('waiting', 'ready', 'deleted')),
  storage_key text not null unique,
  display_key text not null unique,
  declared_type text not null,
  declared_size bigint not null,
  declared_sha256 text not null check (declared_sha256 ~ '^[0-9a-f]{64}$'),
  content_type text check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  byte_size bigint check (byte_size > 0 and byte_size <= 26214400),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  width integer,
  height integer,
  proposal_id uuid references proposal (id),
  image_id uuid references image (id) on delete set null,
  -- Set when an undo removed the accepted image; its files are kept 30 days in case the undo is undone.
  orphaned_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index upload_proposal_idx on upload (proposal_id);
create index upload_author_idx on upload (author_id);
create trigger upload_bump_version before update on upload for each row execute function rdk_bump_version();

-- A daily job's run for one Prague day: claimed while running (a stale claim, left by a crash,
-- may be taken over), done once it finished, failed to be retried a few times.
create table job_run (
  job text not null,
  day date not null,
  status text not null check (status in ('running', 'done', 'failed')),
  attempts integer not null default 1,
  claimed_at timestamptz not null,
  finished_at timestamptz,
  detail text,
  primary key (job, day)
);

-- One row per recipient of a daily email, so a retried job never sends twice.
create table job_delivery (
  job text not null,
  day date not null,
  account_id uuid not null references account (id) on delete cascade,
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  primary key (job, day, account_id)
);
`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
drop table job_delivery;
drop table job_run;
drop table upload;
drop table log_change;
drop table log_entry;
drop function rdk_log_append_only();
drop table proposal_operation;
drop table proposal;
alter table account drop column outcome_emails;
alter table image drop column display_key;
drop trigger person_merge_names on person;
-- The 0002 check, which does not know merged Persons.
create or replace function rdk_check_person_names() returns trigger
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
alter table person drop column merged_into_id;
`,
    )
    .execute(db);
}
