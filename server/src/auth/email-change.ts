import { EMAIL_CHANGE_DAYS, type UiLanguage } from '@rodokmen/shared';
import type { Db } from '../db/db.js';
import type { Account } from '../db/types.js';
import { addressChangedEmail, addressConfirmEmail } from '../mail/templates.js';
import { normaliseEmail, type AccountDeps } from './accounts.js';
import { ApiProblem } from './problem.js';
import { hashToken, newToken } from './sessions.js';

/**
 * Correcting a Member's address (member-accounts spec, "The Owner corrects a Member's address"):
 * the Owner asks for a new address, and it takes effect only once the link sent to it is
 * confirmed. Until then sign-in links go to the old address. Only the Owner reaches these
 * (action `manageAccounts`, see routes/accounts.ts); confirming is a public sign-in step.
 */

const LINK_INVALID = 'This link has expired, was already used, or was replaced by a newer one. Ask the Owner to send a new one.';

/** The open change of each of these Members: neither confirmed nor withdrawn, and not expired. */
export async function pendingEmails(db: Db, accountIds: readonly string[], now: Date): Promise<Map<string, string>> {
  if (accountIds.length === 0) return new Map();
  const rows = await db
    .selectFrom('email_change')
    .select(['account_id', 'email'])
    .where('account_id', 'in', accountIds)
    .where('confirmed_at', 'is', null)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', now)
    .execute();
  return new Map(rows.map((r) => [r.account_id, r.email]));
}

/**
 * Asks for a new address for a Member and emails the confirmation link to it, in the Member's
 * language. A change already waiting is withdrawn, so its link stops working. Refuses the
 * Member's own address, another Member's, and one with a pending invitation ("An address belongs
 * to one Member").
 */
export async function requestEmailChange(deps: AccountDeps, owner: Account, targetId: string, emailInput: string): Promise<Account> {
  const email = normaliseEmail(emailInput);
  const now = deps.clock.now();
  const { token, hash } = newToken();
  // The token stays in the fragment, which no browser, mail scanner or link preview sends to a server.
  const link = `${deps.publicOrigin}/#address/${token}`;
  return deps.db.transaction().execute(async (tx) => {
    // Locked, so that two requests for one Member cannot both leave a change open.
    const member = await tx.selectFrom('account').selectAll().where('id', '=', targetId).where('role', '<>', 'agent').forUpdate().executeTakeFirst();
    if (!member?.email) throw new ApiProblem(404, 'not_found', 'No Member with this id.');
    if (member.email === email) throw new ApiProblem(409, 'email_unchanged', "This is already the Member's address.");
    const taken = await tx.selectFrom('account').select('id').where('email', '=', email).executeTakeFirst();
    if (taken) throw new ApiProblem(409, 'already_member', 'This address already belongs to a Member.');
    const invited = await tx
      .selectFrom('invitation')
      .select('id')
      .where('email', '=', email)
      .where('accepted_at', 'is', null)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', now)
      .executeTakeFirst();
    if (invited) throw new ApiProblem(409, 'invitation_pending', 'An invitation to this address is pending. Withdraw it first.');
    await tx
      .updateTable('email_change')
      .set({ revoked_at: now })
      .where('account_id', '=', member.id)
      .where('confirmed_at', 'is', null)
      .where('revoked_at', 'is', null)
      .execute();
    await tx
      .insertInto('email_change')
      .values({
        token_hash: hash,
        account_id: member.id,
        email,
        requested_by: owner.id,
        created_at: now,
        expires_at: new Date(now.getTime() + EMAIL_CHANGE_DAYS * 86_400_000),
      })
      .execute();
    // Sent inside the transaction: if the email cannot go out, no change is left waiting whose link nobody has.
    await deps.mailer.send(
      addressConfirmEmail({
        to: email,
        language: member.language,
        displayName: member.display_name,
        ownerName: owner.display_name,
        link,
        days: EMAIL_CHANGE_DAYS,
      }),
    );
    return member;
  });
}

/** Withdraws the change waiting for a Member: its link stops working. */
export async function withdrawEmailChange(deps: AccountDeps, targetId: string): Promise<void> {
  const now = deps.clock.now();
  const result = await deps.db
    .updateTable('email_change')
    .set({ revoked_at: now })
    .where('account_id', '=', targetId)
    .where('confirmed_at', 'is', null)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', now)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) throw new ApiProblem(404, 'not_found', 'No new address of this Member waits for confirmation.');
}

/**
 * Confirms a new address with the token from its link ("Confirming a new address"). In one
 * transaction the address changes and the Member's unused sign-in links, which went to the old
 * address, are used up; sessions and passkeys stay. Then the old address is told ("After an
 * address is corrected"). Confirming signs nobody in.
 */
export async function confirmEmailChange(deps: AccountDeps, token: string): Promise<{ email: string }> {
  const now = deps.clock.now();
  const done = await deps.db.transaction().execute(async (tx) => {
    const change = await tx.selectFrom('email_change').selectAll().where('token_hash', '=', hashToken(token)).forUpdate().executeTakeFirst();
    if (!change || change.confirmed_at || change.revoked_at || new Date(change.expires_at) <= now) {
      throw new ApiProblem(410, 'address_link_invalid', LINK_INVALID);
    }
    const member = await tx.selectFrom('account').selectAll().where('id', '=', change.account_id).forUpdate().executeTakeFirstOrThrow();
    const taken = await tx.selectFrom('account').select('id').where('email', '=', change.email).where('id', '<>', member.id).executeTakeFirst();
    if (taken) throw new ApiProblem(409, 'already_member', 'This address already belongs to another Member. Ask the Owner.');
    await tx.updateTable('account').set({ email: change.email, updated_at: now }).where('id', '=', member.id).execute();
    await tx.updateTable('email_change').set({ confirmed_at: now }).where('id', '=', change.id).execute();
    await tx.updateTable('sign_in_link').set({ used_at: now }).where('account_id', '=', member.id).where('used_at', 'is', null).execute();
    const owner = await tx.selectFrom('account').select('display_name').where('id', '=', change.requested_by).executeTakeFirstOrThrow();
    return { oldEmail: member.email, newEmail: change.email, language: member.language, ownerName: owner.display_name };
  });
  await tellOldAddress(deps, done);
  return { email: done.newEmail };
}

/**
 * The notice to the old address, after the commit: a failure is logged and never undoes the
 * confirmed change. It names neither the Member nor the new address.
 */
async function tellOldAddress(deps: AccountDeps, d: { oldEmail: string | null; language: UiLanguage; ownerName: string }): Promise<void> {
  if (!d.oldEmail) return;
  try {
    await deps.mailer.send(addressChangedEmail({ to: d.oldEmail, language: d.language, ownerName: d.ownerName }));
  } catch (error) {
    deps.log?.('could not tell the old address that Rodokmen no longer uses it', error);
  }
}
