import { type Kysely, sql } from 'kysely';

/**
 * Correcting a Member's address (member-accounts spec, "The Owner corrects a Member's address",
 * add-address-correction).
 *
 * - email_change: one row per change the Owner asked for. The new address takes effect only once
 *   the link sent to it is confirmed; like every token, only its SHA-256 hash is stored. Rows are
 *   kept after use, as the record of who changed whose address and when.
 * - At most one open change (neither confirmed nor withdrawn) per Member: asking again withdraws
 *   the open one first.
 *
 * Works with the previous release still running: it reads none of these.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
create table email_change (
  id uuid primary key default uuid_generate_v7(),
  token_hash bytea not null unique,
  account_id uuid not null references account (id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  requested_by uuid not null references account (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  revoked_at timestamptz,
  constraint email_change_once check (confirmed_at is null or revoked_at is null)
);
create unique index email_change_open_idx on email_change (account_id) where confirmed_at is null and revoked_at is null;
`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`drop table email_change;`).execute(db);
}
