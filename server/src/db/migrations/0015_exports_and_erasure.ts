import { type Kysely, sql } from 'kysely';

/**
 * Exports and erasure (exports and erasure specs, add-exports-and-erasure).
 *
 * - erasure: the ids of erased Persons and when, without any other data (erasure spec, "Restores
 *   keep erased people erased"). Erasing again after a restore reads it; `export_replaced_at` is
 *   set once the Export's history was replaced after the erasure ("Erasure reaches Exports").
 * - export_slug: the slug of each exported record, kept once given so that links between the
 *   Export's notes do not churn from night to night (design, "Export layout"). Unique across
 *   kinds, so that a `[[slug]]` link names one note.
 * - proposal.erased_at: a Proposal whose entry in the log involved an erased Person. Its note,
 *   decision note, reader marks and operations are gone; it shows "erased record".
 * - log_change.erased_refs: the ids of records that stay which an erased change pointed at (a
 *   Family, an Event), so that their history still lists the entry as an erased record.
 *
 * Works with the previous release still running: it reads none of these.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
create table erasure (
  person_id uuid primary key,
  erased_at timestamptz not null,
  export_replaced_at timestamptz
);

create table export_slug (
  record_id uuid primary key,
  kind text not null check (kind in ('person', 'family', 'place', 'house', 'parish', 'estate', 'source', 'lead')),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz not null default now()
);

alter table proposal add column erased_at timestamptz;
alter table log_change add column erased_refs uuid[] not null default '{}';
create index log_change_erased_refs_idx on log_change using gin (erased_refs) where cardinality(erased_refs) > 0;
`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
drop index log_change_erased_refs_idx;
alter table log_change drop column erased_refs;
alter table proposal drop column erased_at;
drop table export_slug;
drop table erasure;
`,
    )
    .execute(db);
}
