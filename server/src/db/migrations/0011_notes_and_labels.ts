import { type Kysely, sql } from 'kysely';

/**
 * Research notes and Labels (tree-model spec, "Research notes on records" and "Labels on
 * Persons"; add-vault-import tasks 1.1 and 1.2).
 *
 * - notes: research notes in Markdown on every Person, Family, Event, Place, House, Parish, Estate
 *   and Source, set through Proposals like any other field (setNotes), so they are logged and
 *   undone with their record. The House keeps its short `note` beside them.
 * - person_label: the Labels of a Person, free words or short phrases such as a family line.
 *   One Label once per Person, compared ignoring case and diacritics (the folded column, the
 *   same fold as search). A Tree record: added and removed through Proposals, moved by a merge.
 *
 * Works with the previous release still running: it never reads the new columns or table.
 */
export const NOTES_TABLES = ['person', 'family', 'event', 'place', 'house', 'parish', 'estate', 'source'] as const;

/** The longest research note: about twenty pages of text. */
export const NOTES_MAX = 50_000;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
${NOTES_TABLES.map((t) => `alter table ${t} add column notes text check (length(notes) <= ${NOTES_MAX});`).join('\n')}

create table person_label (
  id uuid primary key default uuid_generate_v7(),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  person_id uuid not null references person (id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 200),
  folded text generated always as (rdk_fold(trim(label))) stored,
  unique (person_id, folded)
);
create index person_label_folded_idx on person_label (folded);
create trigger person_label_bump_version before update on person_label for each row execute function rdk_bump_version();
`,
    )
    .execute(db);
}

/** Drops the Labels and the notes columns; log snapshots keep them. */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
drop table person_label;
${NOTES_TABLES.map((t) => `alter table ${t} drop column notes;`).join('\n')}
`,
    )
    .execute(db);
}
