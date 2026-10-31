import { type Kysely, sql } from 'kysely';

/**
 * Agent accounts (agent-access spec). An Agent is an account with role `agent`: it has a name
 * but no email, and never a session, passkey or sign-in link. It authenticates with tokens the
 * Owner issues; only a token's SHA-256 hash is stored, next to a short prefix the Owner can
 * read in the token list.
 *
 * agent_rate_window holds one fixed window per Agent and kind of request (`proposal` for
 * submitted Proposals, `read` for every other request), checked by fixedWindow in
 * shared/src/rules.ts.
 *
 * Works with the previous release still running: that release never sees an Agent account
 * (it refuses every bearer token), and the replaced role check accepts every existing row.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
alter table account drop constraint account_role_check;
alter table account add constraint account_role_check check (role in ('contributor', 'editor', 'owner', 'agent'));
alter table account alter column email drop not null;
-- Members have an email; Agents have none.
alter table account add constraint account_agent_no_email check ((role = 'agent') = (email is null));

-- An Agent account never has a session, passkey or sign-in link.
create function rdk_check_not_agent() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from account where id = new.account_id and role = 'agent') then
    raise exception 'an Agent signs in only with a token' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger session_not_agent before insert on session for each row execute function rdk_check_not_agent();
create trigger passkey_not_agent before insert on passkey for each row execute function rdk_check_not_agent();
create trigger sign_in_link_not_agent before insert on sign_in_link for each row execute function rdk_check_not_agent();

create table agent_token (
  id uuid primary key default uuid_generate_v7(),
  account_id uuid not null references account (id) on delete cascade,
  token_hash bytea not null unique,
  prefix text not null,
  label text,
  created_by uuid not null references account (id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index agent_token_account_idx on agent_token (account_id);

create table agent_rate_window (
  account_id uuid not null references account (id) on delete cascade,
  kind text not null check (kind in ('proposal', 'read')),
  window_start timestamptz not null,
  count integer not null check (count >= 0),
  primary key (account_id, kind)
);
`,
    )
    .execute(db);
}

/** Fails while Agent accounts exist: their Proposals and log entries refer to them. */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
drop table agent_rate_window;
drop table agent_token;
drop trigger sign_in_link_not_agent on sign_in_link;
drop trigger passkey_not_agent on passkey;
drop trigger session_not_agent on session;
drop function rdk_check_not_agent();
alter table account drop constraint account_agent_no_email;
alter table account alter column email set not null;
alter table account drop constraint account_role_check;
alter table account add constraint account_role_check check (role in ('contributor', 'editor', 'owner'));
`,
    )
    .execute(db);
}
