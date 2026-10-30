import {
  INVITATION_DAYS,
  SIGN_IN_LINK_MINUTES,
  type InvitationStatus,
  type InvitationView,
  type MemberRole,
  type MemberView,
  type UiLanguage,
} from '@rodokmen/shared';
import { sql } from 'kysely';
import type { Db } from '../db/db.js';
import type { Account } from '../db/types.js';
import type { Mailer } from '../mail/mailer.js';
import { invitationEmail, signInLinkEmail } from '../mail/templates.js';
import type { Clock } from '../clock.js';
import { ApiProblem } from './problem.js';
import { createSession, endAllSessions, hashToken, newToken, type SessionOptions } from './sessions.js';

export interface AccountDeps {
  db: Db;
  clock: Clock;
  mailer: Mailer;
  publicOrigin: string;
  session: SessionOptions;
}

/** Sign-in link requests allowed per Member per hour; more are dropped silently. */
export const SIGN_IN_LINKS_PER_HOUR = 5;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function memberView(a: Account): MemberView {
  return {
    id: a.id,
    version: a.version,
    email: a.email,
    displayName: a.display_name,
    language: a.language,
    role: a.role,
    disabled: a.disabled_at !== null,
    createdAt: new Date(a.created_at).toISOString(),
    lastSeenAt: a.last_seen_at ? new Date(a.last_seen_at).toISOString() : null,
  };
}

function invitationStatus(i: { accepted_at: Date | null; revoked_at: Date | null; expires_at: Date }, now: Date): InvitationStatus {
  if (i.accepted_at) return 'accepted';
  if (i.revoked_at) return 'revoked';
  if (new Date(i.expires_at) <= now) return 'expired';
  return 'pending';
}

export function invitationView(
  i: { id: string; email: string; language: UiLanguage; created_at: Date; expires_at: Date; accepted_at: Date | null; revoked_at: Date | null },
  now: Date,
): InvitationView {
  return {
    id: i.id,
    email: i.email,
    language: i.language,
    status: invitationStatus(i, now),
    createdAt: new Date(i.created_at).toISOString(),
    expiresAt: new Date(i.expires_at).toISOString(),
    acceptedAt: i.accepted_at ? new Date(i.accepted_at).toISOString() : null,
  };
}

// ---------------------------------------------------------------- invitations

/** Only the Owner invites. The link works once and expires after INVITATION_DAYS. */
export async function createInvitation(deps: AccountDeps, owner: Account, emailInput: string, language: UiLanguage): Promise<InvitationView> {
  const email = normaliseEmail(emailInput);
  const existing = await deps.db.selectFrom('account').select('id').where('email', '=', email).executeTakeFirst();
  if (existing) throw new ApiProblem(409, 'already_member', 'This address already belongs to a Member.');
  const { token, hash } = newToken();
  const now = deps.clock.now();
  const expiresAt = new Date(now.getTime() + INVITATION_DAYS * 86_400_000);
  // Sent inside the transaction: if the email cannot go out, no invitation is left that nobody has the link to.
  const row = await deps.db.transaction().execute(async (tx) => {
    const inserted = await tx
      .insertInto('invitation')
      .values({ token_hash: hash, email, language, invited_by: owner.id, created_at: now, expires_at: expiresAt })
      .returningAll()
      .executeTakeFirstOrThrow();
    await deps.mailer.send(
      invitationEmail({ to: email, language, inviterName: owner.display_name, link: `${deps.publicOrigin}/auth/invite#token=${token}`, days: INVITATION_DAYS }),
    );
    return inserted;
  });
  return invitationView(row, now);
}

export async function listInvitations(deps: AccountDeps): Promise<InvitationView[]> {
  const now = deps.clock.now();
  const rows = await deps.db.selectFrom('invitation').selectAll().orderBy('created_at', 'desc').execute();
  return rows.map((r) => invitationView(r, now));
}

export async function revokeInvitation(deps: AccountDeps, id: string): Promise<void> {
  const result = await deps.db
    .updateTable('invitation')
    .set({ revoked_at: deps.clock.now() })
    .where('id', '=', id)
    .where('accepted_at', 'is', null)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) throw new ApiProblem(404, 'not_found', 'No open invitation with this id.');
}

const INVITATION_MESSAGES: Record<InvitationStatus, Record<UiLanguage, string>> = {
  pending: {
    cs: 'Pozvánka platí. Zvolte si jméno a jazyk a uložte si přístupový klíč.',
    en: 'The invitation is valid. Choose your name and language, then save a passkey.',
  },
  accepted: {
    cs: 'Tato pozvánka už byla použita. Přihlaste se, nebo požádejte správce Rodokmenu o novou.',
    en: 'This invitation has already been used. Sign in, or ask the Owner for a new one.',
  },
  expired: {
    cs: 'Platnost pozvánky vypršela. Požádejte správce Rodokmenu o novou.',
    en: 'This invitation has expired. Ask the Owner for a new one.',
  },
  revoked: {
    cs: 'Tato pozvánka byla zrušena. Požádejte správce Rodokmenu o novou.',
    en: 'This invitation was withdrawn. Ask the Owner for a new one.',
  },
};

export function invitationMessage(status: InvitationStatus, language: UiLanguage): string {
  return INVITATION_MESSAGES[status][language];
}

export async function checkInvitation(deps: AccountDeps, token: string) {
  const row = await deps.db.selectFrom('invitation').selectAll().where('token_hash', '=', hashToken(token)).executeTakeFirst();
  if (!row) throw new ApiProblem(404, 'invitation_unknown', 'This invitation link is not valid. Ask the Owner for a new one.');
  const status = invitationStatus(row, deps.clock.now());
  return { status, language: row.language, message: invitationMessage(status, row.language) };
}

/**
 * Accepting creates a Contributor with the chosen display name and language and signs them
 * in; registering the passkey follows on the same page. The invitation is consumed in the
 * same transaction, so it works exactly once.
 */
export async function acceptInvitation(deps: AccountDeps, token: string, displayName: string, language: UiLanguage, userAgent: string | undefined) {
  const now = deps.clock.now();
  const result = await deps.db.transaction().execute(async (tx) => {
    const invitation = await tx.selectFrom('invitation').selectAll().where('token_hash', '=', hashToken(token)).forUpdate().executeTakeFirst();
    if (!invitation) throw new ApiProblem(404, 'invitation_unknown', 'This invitation link is not valid. Ask the Owner for a new one.');
    const status = invitationStatus(invitation, now);
    if (status !== 'pending') throw new ApiProblem(410, `invitation_${status}`, invitationMessage(status, invitation.language));
    const taken = await tx.selectFrom('account').select('id').where('email', '=', invitation.email).executeTakeFirst();
    if (taken) throw new ApiProblem(409, 'already_member', 'This address already belongs to a Member. Sign in instead.');
    const account = await tx
      .insertInto('account')
      .values({ email: invitation.email, display_name: displayName.trim(), language, role: 'contributor', invited_by: invitation.invited_by, created_at: now })
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx.updateTable('invitation').set({ accepted_at: now, accepted_account_id: account.id }).where('id', '=', invitation.id).execute();
    return account;
  });
  const session = await createSession(deps.db, deps.clock, deps.session, result.id, 'invitation', userAgent);
  return { account: result, session };
}

// ---------------------------------------------------------------- emailed sign-in links

/**
 * Sends a sign-in link valid once for SIGN_IN_LINK_MINUTES, in the Member's language. The
 * answer is the same whether or not the address belongs to a Member.
 */
export async function requestEmailLink(deps: AccountDeps, emailInput: string): Promise<void> {
  const email = normaliseEmail(emailInput);
  const account = await deps.db.selectFrom('account').selectAll().where('email', '=', email).where('disabled_at', 'is', null).executeTakeFirst();
  if (!account) return;
  const now = deps.clock.now();
  const { token, hash } = newToken();
  // Counting and inserting under a lock per Member, so that simultaneous requests cannot all
  // see room under the limit.
  const issued = await deps.db.transaction().execute(async (tx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`sign-in-link:${account.id}`}))`.execute(tx);
    const recent = await tx
      .selectFrom('sign_in_link')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('account_id', '=', account.id)
      .where('created_at', '>', new Date(now.getTime() - 3_600_000))
      .executeTakeFirstOrThrow();
    if (recent.n >= SIGN_IN_LINKS_PER_HOUR) return false;
    await tx
      .insertInto('sign_in_link')
      .values({ token_hash: hash, account_id: account.id, created_at: now, expires_at: new Date(now.getTime() + SIGN_IN_LINK_MINUTES * 60_000) })
      .execute();
    return true;
  });
  if (!issued) return;
  await deps.mailer.send(
    signInLinkEmail({
      to: account.email,
      language: account.language,
      displayName: account.display_name,
      link: `${deps.publicOrigin}/auth/link#token=${token}`,
      minutes: SIGN_IN_LINK_MINUTES,
    }),
  );
}

export async function consumeEmailLink(deps: AccountDeps, token: string, userAgent: string | undefined) {
  const now = deps.clock.now();
  const link = await deps.db
    .updateTable('sign_in_link')
    .set({ used_at: now })
    .where('token_hash', '=', hashToken(token))
    .where('used_at', 'is', null)
    .where('expires_at', '>', now)
    .returning(['account_id'])
    .executeTakeFirst();
  if (!link) throw new ApiProblem(410, 'link_invalid', 'This sign-in link has expired or was already used. Request a new one.');
  const account = await deps.db.selectFrom('account').selectAll().where('id', '=', link.account_id).where('disabled_at', 'is', null).executeTakeFirst();
  if (!account) throw new ApiProblem(410, 'link_invalid', 'This sign-in link has expired or was already used. Request a new one.');
  const session = await createSession(deps.db, deps.clock, deps.session, account.id, 'email_link', userAgent);
  return { account, session };
}

// ---------------------------------------------------------------- roles and disabling

export async function listMembers(deps: AccountDeps): Promise<MemberView[]> {
  const rows = await deps.db.selectFrom('account').selectAll().orderBy('display_name').orderBy('id').execute();
  return rows.map(memberView);
}

async function loadMember(db: Db, id: string): Promise<Account> {
  const a = await db.selectFrom('account').selectAll().where('id', '=', id).executeTakeFirst();
  if (!a) throw new ApiProblem(404, 'not_found', 'No Member with this id.');
  return a;
}

/**
 * Only the Owner changes roles, and there is always exactly one Owner. Making another Member
 * the Owner hands ownership over: the current Owner becomes an Editor in the same transaction.
 * The new role applies from the Member's next request, since roles are read on every request.
 */
export async function changeRole(deps: AccountDeps, owner: Account, targetId: string, role: MemberRole): Promise<MemberView> {
  if (targetId === owner.id) throw new ApiProblem(409, 'owner_role', 'The Owner keeps the Owner role until handing it to another Member.');
  return deps.db.transaction().execute(async (tx) => {
    const target = await loadMember(tx, targetId);
    if (role === 'owner') {
      if (target.disabled_at) throw new ApiProblem(409, 'member_disabled', 'A disabled Member cannot become the Owner.');
      await tx.updateTable('account').set({ role: 'editor' }).where('id', '=', owner.id).execute();
    }
    const updated = await tx.updateTable('account').set({ role }).where('id', '=', target.id).returningAll().executeTakeFirstOrThrow();
    return memberView(updated);
  });
}

/** Disabling ends all of the Member's sessions at once; their next request answers 401. */
export async function disableMember(deps: AccountDeps, owner: Account, targetId: string): Promise<MemberView> {
  if (targetId === owner.id) throw new ApiProblem(409, 'owner_disable', 'The Owner cannot be disabled.');
  return deps.db.transaction().execute(async (tx) => {
    const target = await loadMember(tx, targetId);
    const now = deps.clock.now();
    const updated = await tx
      .updateTable('account')
      .set({ disabled_at: target.disabled_at ?? now })
      .where('id', '=', target.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await endAllSessions(tx, deps.clock, target.id);
    await tx.updateTable('sign_in_link').set({ used_at: now }).where('account_id', '=', target.id).where('used_at', 'is', null).execute();
    return memberView(updated);
  });
}

export async function enableMember(deps: AccountDeps, targetId: string): Promise<MemberView> {
  await loadMember(deps.db, targetId);
  const updated = await deps.db.updateTable('account').set({ disabled_at: null }).where('id', '=', targetId).returningAll().executeTakeFirstOrThrow();
  return memberView(updated);
}

/** Creates the first account, the Owner. Refuses when any account exists. */
export async function createOwner(deps: AccountDeps, emailInput: string, displayName: string, language: UiLanguage): Promise<Account> {
  return deps.db.transaction().execute(async (tx) => {
    const any = await tx.selectFrom('account').select('id').limit(1).executeTakeFirst();
    if (any) throw new ApiProblem(409, 'owner_exists', 'Accounts already exist; the Owner invites everyone else.');
    return tx
      .insertInto('account')
      .values({ email: normaliseEmail(emailInput), display_name: displayName, language, role: 'owner', created_at: deps.clock.now() })
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}
