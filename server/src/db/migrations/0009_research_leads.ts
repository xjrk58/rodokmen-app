import { type Kysely, sql } from 'kysely';

/**
 * Research leads (research-leads spec; add-research-leads design). Leads are plans, not facts:
 * they sit beside the Tree, not in it, change without review, and keep their own history instead
 * of the log of accepted Proposals.
 *
 * - lead: a question, its reason, where to look (archive, register Source, years, pages), its
 *   status, who is working on it, the outcome, and the accepted Proposal that answered it.
 * - lead_link: the Persons and Places a lead concerns. A link goes with its Person or Place, so
 *   an undo that removes a Person, and an erasure, take the link with it.
 * - lead_search: one search record per attempt: the Source (and its title as it was, so the
 *   record keeps saying what was searched if the Source goes) or the archive, the years and
 *   pages, the date, who looked, and what was found.
 * - lead_event: every change of a lead, with author and time.
 * - proposal_lead: the leads a Proposal answers (`answersLeads`).
 * - lead_suggestion: the gap finder's suggested leads, by a stable key (kind of gap, Person or
 *   Family, register Source). A dismissed or accepted suggestion keeps its row, so its key is
 *   never suggested again; its references are set null when their records go, never cascaded.
 * - source.register_*: what a register book covers (its Parish, kinds of entries and years), so
 *   that the gap finder can name the register to check. A Tree field like any other: set through
 *   Proposals, logged and undone with the Source.
 *
 * Works with the previous release still running: it never reads the new tables, and the new
 * Source columns have defaults that its inserts leave as they are.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
alter table source add column register_parish_id uuid references parish (id);
alter table source add column register_kinds text[] not null default '{}'
  check (register_kinds <@ array['birth', 'marriage', 'death']::text[]);
alter table source add column register_from integer check (register_from between 1 and 9999);
alter table source add column register_to integer check (register_to between 1 and 9999);
alter table source add constraint source_register check (
  (register_parish_id is null) = (cardinality(register_kinds) = 0)
  and (register_parish_id is not null or (register_from is null and register_to is null))
  and (register_from is null or register_to is null or register_from <= register_to)
  and (register_parish_id is null or type = 'parish_register'));
create index source_register_parish_idx on source (register_parish_id) where register_parish_id is not null;

create table lead (
  id uuid primary key default uuid_generate_v7(),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  question text not null check (length(trim(question)) > 0),
  reason text not null check (length(trim(reason)) > 0),
  archive text,
  source_id uuid references source (id) on delete set null,
  years_from integer,
  years_to integer,
  pages text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'found', 'not_found')),
  outcome text,
  assignee_id uuid references account (id),
  author_id uuid not null references account (id),
  found_by_proposal_id uuid references proposal (id),
  suggestion_key text,
  constraint lead_years check ((years_from is null) = (years_to is null) and (years_from is null or years_from <= years_to)),
  constraint lead_found_by check (found_by_proposal_id is null or status = 'found')
);
create index lead_status_idx on lead (status, updated_at desc);
create index lead_assignee_idx on lead (assignee_id) where assignee_id is not null;
create index lead_source_idx on lead (source_id) where source_id is not null;
create index lead_found_by_idx on lead (found_by_proposal_id) where found_by_proposal_id is not null;
create trigger lead_bump_version before update on lead for each row execute function rdk_bump_version();

create table lead_link (
  id uuid primary key default uuid_generate_v7(),
  lead_id uuid not null references lead (id) on delete cascade,
  person_id uuid references person (id) on delete cascade,
  place_id uuid references place (id) on delete cascade,
  sort_order integer not null default 0,
  constraint lead_link_one check (num_nonnulls(person_id, place_id) = 1),
  unique (lead_id, person_id),
  unique (lead_id, place_id)
);
create index lead_link_person_idx on lead_link (person_id) where person_id is not null;
create index lead_link_place_idx on lead_link (place_id) where place_id is not null;

create table lead_search (
  id uuid primary key default uuid_generate_v7(),
  lead_id uuid not null references lead (id) on delete cascade,
  source_id uuid references source (id) on delete set null,
  source_title text,
  archive text,
  years_from integer,
  years_to integer,
  pages text,
  searched_on text not null,
  searched_by text not null check (length(trim(searched_by)) > 0),
  found boolean not null,
  note text,
  author_id uuid not null references account (id),
  created_at timestamptz not null default now(),
  constraint lead_search_where check (source_title is not null or archive is not null),
  constraint lead_search_years check ((years_from is null) = (years_to is null) and (years_from is null or years_from <= years_to))
);
create index lead_search_lead_idx on lead_search (lead_id, created_at desc);

create table lead_event (
  id bigint generated always as identity primary key,
  lead_id uuid not null references lead (id) on delete cascade,
  at timestamptz not null,
  author_id uuid not null references account (id),
  kind text not null check (kind in ('created', 'edited', 'searched', 'closed', 'answered', 'reopened')),
  proposal_id uuid references proposal (id),
  fields jsonb not null default '[]'
);
create index lead_event_lead_idx on lead_event (lead_id, id desc);

create table proposal_lead (
  proposal_id uuid not null references proposal (id) on delete cascade,
  lead_id uuid not null references lead (id) on delete cascade,
  primary key (proposal_id, lead_id)
);
create index proposal_lead_lead_idx on proposal_lead (lead_id);

create table lead_suggestion (
  id uuid primary key default uuid_generate_v7(),
  key text not null unique,
  kind text not null check (kind in ('birth', 'parents', 'marriage')),
  person_id uuid references person (id) on delete set null,
  family_id uuid references family (id) on delete set null,
  source_id uuid references source (id) on delete set null,
  place_id uuid references place (id) on delete set null,
  archive text,
  years_from integer,
  years_to integer,
  status text not null default 'open' check (status in ('open', 'accepted', 'dismissed')),
  lead_id uuid references lead (id) on delete set null,
  decided_by uuid references account (id),
  decided_at timestamptz,
  computed_at timestamptz not null,
  constraint lead_suggestion_decided check ((status = 'open') = (decided_at is null))
);
create index lead_suggestion_person_idx on lead_suggestion (person_id) where person_id is not null;
create index lead_suggestion_family_idx on lead_suggestion (family_id) where family_id is not null;
create index lead_suggestion_open_idx on lead_suggestion (computed_at) where status = 'open';
`,
    )
    .execute(db);
}

/** Drops the leads with their history and suggestions, and the register fields of Sources (log snapshots keep them). */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
drop table lead_suggestion;
drop table proposal_lead;
drop table lead_event;
drop table lead_search;
drop table lead_link;
drop table lead;
alter table source drop constraint source_register;
alter table source drop column register_to;
alter table source drop column register_from;
alter table source drop column register_kinds;
alter table source drop column register_parish_id;
`,
    )
    .execute(db);
}
