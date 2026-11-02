import { type Kysely, sql } from 'kysely';

/**
 * Import batches (review spec, "Proposals in an Import batch build on each other", "Accept a
 * whole Import batch", "Batch view in the review queue"; vault-import spec, "Re-runs submit only
 * what is new"; add-vault-import tasks 2.1–2.4 and 3.6).
 *
 * - import_batch: the Proposals one run of the Vault importer submits together, named after the
 *   run, with the Vault commit it read.
 * - proposal.batch_id / batch_position: a Proposal's batch and its place in batch order.
 * - proposal_dependency: the earlier Proposals of its batch a Proposal builds on (its batch
 *   references); it is accepted only after them, and is blocked while one is rejected.
 * - proposal_temp: the records an accepted batch Proposal created, by the temporary ids it gave
 *   them, so that the batch references of later Proposals resolve to them.
 * - agent_rate_window.kind 'batch': an Agent's requests to its Import batches count against a
 *   window of their own (agent-access spec, "Import batches have their own limit").
 * - vault_import_map: the importer's map from Vault keys (a note, or a record derived from one)
 *   to what it submitted and, once accepted, the record in the Tree, with the hash of the note,
 *   so that a re-run submits only what is new or changed.
 *
 * Works with the previous release still running: it never reads the new tables and columns.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
create table import_batch (
  id uuid primary key default uuid_generate_v7(),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null check (length(trim(name)) > 0),
  author_id uuid not null references account (id),
  vault_commit text,
  note text
);
create trigger import_batch_bump_version before update on import_batch for each row execute function rdk_bump_version();

alter table proposal add column batch_id uuid references import_batch (id);
alter table proposal add column batch_position integer check (batch_position >= 0);
alter table proposal add constraint proposal_batch check ((batch_id is null) = (batch_position is null));
create unique index proposal_batch_position_idx on proposal (batch_id, batch_position) where batch_id is not null;

create table proposal_dependency (
  proposal_id uuid not null references proposal (id) on delete cascade,
  depends_on_id uuid not null references proposal (id),
  primary key (proposal_id, depends_on_id),
  constraint proposal_dependency_not_self check (proposal_id <> depends_on_id)
);
create index proposal_dependency_on_idx on proposal_dependency (depends_on_id);

create table proposal_temp (
  proposal_id uuid not null references proposal (id),
  temp_id text not null,
  record_id uuid not null,
  primary key (proposal_id, temp_id)
);

create table vault_import_map (
  key text primary key check (length(key) between 1 and 400),
  kind text not null check (length(kind) between 1 and 40),
  note_hash text,
  batch_id uuid not null references import_batch (id),
  proposal_id uuid references proposal (id),
  temp_id text,
  record_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vault_import_map_proposal_idx on vault_import_map (proposal_id) where proposal_id is not null;

alter table agent_rate_window drop constraint agent_rate_window_kind_check;
alter table agent_rate_window add constraint agent_rate_window_kind_check check (kind in ('proposal', 'read', 'batch'));
`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
delete from agent_rate_window where kind = 'batch';
alter table agent_rate_window drop constraint agent_rate_window_kind_check;
alter table agent_rate_window add constraint agent_rate_window_kind_check check (kind in ('proposal', 'read'));
drop table vault_import_map;
drop table proposal_temp;
drop table proposal_dependency;
drop index proposal_batch_position_idx;
alter table proposal drop constraint proposal_batch;
alter table proposal drop column batch_position;
alter table proposal drop column batch_id;
drop table import_batch;
`,
    )
    .execute(db);
}
