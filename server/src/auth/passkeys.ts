import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { Db } from '../db/db.js';
import type { Account } from '../db/types.js';
import type { Clock } from '../tree/summaries.js';
import { ApiProblem } from './problem.js';
import { messageOf } from '../errors.js';

/**
 * Passkeys through WebAuthn (@simplewebauthn/server). The relying party is the domain the
 * app and API share (ADR 0007). Challenges are stored server-side for 5 minutes and used once;
 * the browser holds only the challenge id in a short-lived HttpOnly cookie.
 */
export const CHALLENGE_COOKIE = 'rdk_webauthn';
export const CHALLENGE_SECONDS = 300;

export interface PasskeyDeps {
  db: Db;
  clock: Clock;
  rpId: string;
  rpName: string;
  origin: string;
}

async function storeChallenge(deps: PasskeyDeps, challenge: string, purpose: 'registration' | 'authentication', accountId: string | null): Promise<string> {
  const now = deps.clock.now();
  // Housekeeping: expired challenges are useless.
  await deps.db.deleteFrom('webauthn_challenge').where('expires_at', '<', now).execute();
  const row = await deps.db
    .insertInto('webauthn_challenge')
    .values({ challenge, purpose, account_id: accountId, created_at: now, expires_at: new Date(now.getTime() + CHALLENGE_SECONDS * 1000) })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function takeChallenge(deps: PasskeyDeps, id: string | undefined, purpose: 'registration' | 'authentication', accountId: string | null): Promise<string> {
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new ApiProblem(400, 'challenge_missing', 'Start again: the passkey request has expired.');
  const row = await deps.db
    .deleteFrom('webauthn_challenge')
    .where('id', '=', id)
    .where('purpose', '=', purpose)
    .where('expires_at', '>', deps.clock.now())
    .returning(['challenge', 'account_id'])
    .executeTakeFirst();
  if (!row || (accountId !== null && row.account_id !== accountId)) throw new ApiProblem(400, 'challenge_missing', 'Start again: the passkey request has expired.');
  return row.challenge;
}

export async function registrationOptions(deps: PasskeyDeps, account: Account) {
  const existing = await deps.db.selectFrom('passkey').select(['credential_id', 'transports']).where('account_id', '=', account.id).execute();
  const options = await generateRegistrationOptions({
    rpName: deps.rpName,
    rpID: deps.rpId,
    userName: account.email,
    userDisplayName: account.display_name,
    userID: new TextEncoder().encode(account.id),
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    timeout: CHALLENGE_SECONDS * 1000,
  });
  const challengeId = await storeChallenge(deps, options.challenge, 'registration', account.id);
  return { options, challengeId };
}

export async function verifyRegistration(deps: PasskeyDeps, account: Account, challengeId: string | undefined, response: unknown, name: string | undefined) {
  const expectedChallenge = await takeChallenge(deps, challengeId, 'registration', account.id);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: deps.origin,
      expectedRPID: deps.rpId,
      requireUserVerification: false,
    });
  } catch (error) {
    throw new ApiProblem(400, 'passkey_invalid', `The passkey could not be registered: ${messageOf(error)}`);
  }
  if (!verification.verified) throw new ApiProblem(400, 'passkey_invalid', 'The passkey could not be registered.');
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const row = await deps.db
    .insertInto('passkey')
    .values({
      account_id: account.id,
      credential_id: credential.id,
      public_key: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      device_type: credentialDeviceType,
      backed_up: credentialBackedUp,
      name: name ?? 'Passkey',
      created_at: deps.clock.now(),
    })
    .onConflict((oc) => oc.column('credential_id').doNothing())
    .returning(['id'])
    .executeTakeFirst();
  if (!row) throw new ApiProblem(409, 'passkey_exists', 'This passkey is already registered.');
  return row.id;
}

/** Options for signing in with any passkey on the device (discoverable credentials). */
export async function authenticationOptions(deps: PasskeyDeps) {
  const options = await generateAuthenticationOptions({ rpID: deps.rpId, userVerification: 'preferred', timeout: CHALLENGE_SECONDS * 1000 });
  const challengeId = await storeChallenge(deps, options.challenge, 'authentication', null);
  return { options, challengeId };
}

export async function verifyAuthentication(deps: PasskeyDeps, challengeId: string | undefined, response: unknown): Promise<Account> {
  const expectedChallenge = await takeChallenge(deps, challengeId, 'authentication', null);
  const body = response as AuthenticationResponseJSON;
  const refuse = () => new ApiProblem(401, 'passkey_unknown', 'This passkey is not known here. Sign in with an emailed link instead.');
  if (typeof body?.id !== 'string') throw refuse();
  const stored = await deps.db
    .selectFrom('passkey as k')
    .innerJoin('account as a', 'a.id', 'k.account_id')
    .select(['k.id as passkey_id', 'k.credential_id', 'k.public_key', 'k.counter', 'k.transports', 'a.id as account_id', 'a.disabled_at'])
    .where('k.credential_id', '=', body.id)
    .executeTakeFirst();
  if (!stored || stored.disabled_at) throw refuse();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: deps.origin,
      expectedRPID: deps.rpId,
      credential: { id: stored.credential_id, publicKey: new Uint8Array(stored.public_key), counter: stored.counter, transports: stored.transports },
      requireUserVerification: false,
    });
  } catch {
    throw refuse();
  }
  if (!verification.verified) throw refuse();
  await deps.db
    .updateTable('passkey')
    .set({ counter: verification.authenticationInfo.newCounter, last_used_at: deps.clock.now(), backed_up: verification.authenticationInfo.credentialBackedUp })
    .where('id', '=', stored.passkey_id)
    .execute();
  return deps.db.selectFrom('account').selectAll().where('id', '=', stored.account_id).executeTakeFirstOrThrow();
}
