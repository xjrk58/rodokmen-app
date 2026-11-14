import { type Kysely, sql } from 'kysely';

/**
 * Asking to be linked to one's own Person (add-kinship; family-tree spec, "Asking to be linked to
 * one's own Person"): a Member who is not linked asks the Owner, from a person page, to link
 * their account to that Person. The Owner confirms (the existing link) or refuses; either clears
 * the request. Kept with the account and never part of an Export. When the Person is erased the
 * request goes with it; a merged Person is read as the one kept, as the link is.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
alter table account add column person_request_id uuid references person (id) on delete set null;
alter table account add column person_request_at timestamptz;
`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`alter table account drop column person_request_at; alter table account drop column person_request_id;`).execute(db);
}
