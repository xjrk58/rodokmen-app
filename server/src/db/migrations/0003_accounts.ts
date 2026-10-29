import { type Kysely, sql } from 'kysely';

/**
 * Member accounts (member-accounts spec). Tokens (sessions, sign-in links, invitations) are
 * stored only as SHA-256 hashes. `account.role` will gain `agent` in add-agent-access; the
 * check constraint is then replaced, which does not rewrite rows.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
create table account (
  id uuid primary key default uuid_generate_v7(),
  version integer not null default 1 check (version > 0),
  email text not null check (email = lower(email) and position('@' in email) > 1),
  display_name text not null check (length(trim(display_name)) > 0),
  language text not null default 'cs' check (language in ('cs', 'en')),
  role text not null default 'contributor' check (role in ('contributor', 'editor', 'owner')),
  disabled_at timestamptz,
  invited_by uuid references account (id),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_owner_enabled check (role <> 'owner' or disabled_at is null)
);
create unique index account_email_idx on account (email);
-- At most one Owner at any moment ...
create unique index account_one_owner_idx on account ((true)) where role = 'owner';
create trigger account_bump_version before update on account for each row execute function rdk_bump_version();

-- ... and exactly one once anyone has an account, checked at commit so ownership can be handed over.
create function rdk_check_one_owner() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from account) and (select count(*) from account where role = 'owner') <> 1 then
    raise exception 'there must be exactly one Owner' using errcode = 'check_violation';
  end if;
  return null;
end
$$;
create constraint trigger account_exactly_one_owner after insert or update or delete on account
  deferrable initially deferred for each row execute function rdk_check_one_owner();

create table session (
  id uuid primary key default uuid_generate_v7(),
  token_hash bytea not null unique,
  account_id uuid not null references account (id) on delete cascade,
  method text not null check (method in ('passkey', 'email_link', 'invitation')),
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz
);
create index session_account_idx on session (account_id) where ended_at is null;

create table passkey (
  id uuid primary key default uuid_generate_v7(),
  account_id uuid not null references account (id) on delete cascade,
  credential_id text not null unique,
  public_key bytea not null,
  counter bigint not null default 0,
  transports text[] not null default '{}',
  device_type text not null,
  backed_up boolean not null default false,
  name text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index passkey_account_idx on passkey (account_id);

create table webauthn_challenge (
  id uuid primary key default uuid_generate_v7(),
  challenge text not null,
  purpose text not null check (purpose in ('registration', 'authentication')),
  account_id uuid references account (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table invitation (
  id uuid primary key default uuid_generate_v7(),
  token_hash bytea not null unique,
  email text not null check (email = lower(email)),
  language text not null check (language in ('cs', 'en')),
  invited_by uuid not null references account (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_account_id uuid references account (id),
  revoked_at timestamptz
);
create index invitation_email_idx on invitation (email);

create table sign_in_link (
  id uuid primary key default uuid_generate_v7(),
  token_hash bytea not null unique,
  account_id uuid not null references account (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index sign_in_link_account_idx on sign_in_link (account_id, created_at);
`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `drop table sign_in_link; drop table invitation; drop table webauthn_challenge; drop table passkey; drop table session; drop table account; drop function rdk_check_one_owner();`,
    )
    .execute(db);
}
