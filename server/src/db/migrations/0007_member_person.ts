import { type Kysely, sql } from 'kysely';

/**
 * The Member's own Person (family-tree spec, "The Member's own Person"): the Owner links a
 * Member's account to the Person who is that Member in the Tree, so their tree opens there. It
 * is a link to a Living person, kept with the account and never part of an Export. When the
 * Person is erased the link goes with it.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`alter table account add column person_id uuid references person (id) on delete set null;`).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`alter table account drop column person_id;`).execute(db);
}
