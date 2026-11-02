import { type Kysely, sql } from 'kysely';

/**
 * Scan reading (scan-reading spec, ADR 0011).
 *
 * - scan_reading_setting: the Owner's switch and the daily limit per Member, one row. Off until
 *   the Owner switches it on.
 * - reading: one reading of one or more uploads: what the Member asked (uploads, crops, context),
 *   its status in the queue (queued, running, done, failed), and its result or why it failed. The
 *   result is stored with the uploads it read. `day` is the Prague day it was asked for, which
 *   the daily limit counts.
 * - proposal.reader: for a Proposal drafted from readings, which readings, and which values are
 *   still as the reader produced them ("read by AI").
 *
 * Works with the previous release still running: it reads none of these.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
create table scan_reading_setting (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  daily_limit integer not null default 10 check (daily_limit between 1 and 200),
  changed_by uuid references account (id),
  changed_at timestamptz
);
insert into scan_reading_setting (id) values (true);

create table reading (
  id uuid primary key default uuid_generate_v7(),
  author_id uuid not null references account (id),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  upload_ids uuid[] not null check (cardinality(upload_ids) between 1 and 5),
  crops jsonb not null default '[]',
  context jsonb not null default '{}',
  day date not null,
  model text,
  result jsonb,
  error_code text,
  error_message text,
  usage jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  check ((status = 'done') = (result is not null)),
  check ((status = 'failed') = (error_code is not null))
);
create index reading_author_day_idx on reading (author_id, day);
create index reading_queue_idx on reading (created_at) where status in ('queued', 'running');
create index reading_upload_idx on reading using gin (upload_ids);

alter table proposal add column reader jsonb;
`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
alter table proposal drop column reader;
drop table reading;
drop table scan_reading_setting;
`,
    )
    .execute(db);
}
